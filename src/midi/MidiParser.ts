// Midiocre — MIDI parser (SMF format 0/1/2, spec-compliant)

import {
  MidiFile, MidiHeader, MidiTrack, MidiEvent, MidiEventKind, MetaType,
} from './MidiTypes.js';

// -- Binary helpers ----------------------------------------------------------

function readString(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function readVLQ(data: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let bytesRead = 0;
  let b: number;
  do {
    if (offset + bytesRead >= data.length) throw new Error('VLQ overrun');
    b = data[offset + bytesRead];
    value = (value << 7) | (b & 0x7F);
    bytesRead++;
    if (bytesRead > 4) throw new Error('VLQ too long');
  } while (b & 0x80);
  return [value, bytesRead];
}

function textDecoder(data: Uint8Array): string {
  try { return new TextDecoder('utf-8').decode(data); }
  catch { return Array.from(data).map(b => String.fromCharCode(b)).join(''); }
}

// -- Event size helpers ------------------------------------------------------

function channelMessageLength(status: number): number {
  const hi = status & 0xF0;
  if (hi === 0xC0 || hi === 0xD0) return 1; // program change, channel pressure
  return 2; // note on/off, poly pressure, CC, pitch bend
}

// -- Track parser ------------------------------------------------------------

function parseTrack(data: Uint8Array): MidiTrack {
  const events: MidiEvent[] = [];
  let offset = 0;
  let runningStatus = 0;
  let absoluteTicks = 0;
  let trackName: string | undefined;

  while (offset < data.length) {
    // Delta time
    const [deltaTicks, vlqLen] = readVLQ(data, offset);
    offset += vlqLen;
    absoluteTicks += deltaTicks;

    if (offset >= data.length) break;
    let statusByte = data[offset];

    // Determine if this is a status byte or running status
    if (statusByte & 0x80) {
      offset++;
    } else {
      // Running status — reuse previous status byte
      statusByte = runningStatus;
    }

    const event: MidiEvent = {
      deltaTicks,
      absoluteTicks,
      absoluteTime: 0,
      type: MidiEventKind.NoteOn,
      status: statusByte,
      channel: -1,
      data1: 0,
      data2: 0,
      metaType: 0,
      rawData: new Uint8Array(0),
    };

    if (statusByte === 0xFF) {
      // Meta event
      event.type = MidiEventKind.Meta;
      event.metaType = data[offset++];
      const [len, vl] = readVLQ(data, offset);
      offset += vl;
      event.rawData = data.slice(offset, offset + len);
      offset += len;

      // Parse well-known meta types
      if (event.metaType === MetaType.SetTempo && event.rawData.length >= 3) {
        event.data1 = (event.rawData[0] << 16) | (event.rawData[1] << 8) | event.rawData[2];
      } else if (event.metaType === MetaType.TrackName) {
        trackName = textDecoder(event.rawData);
      } else if (event.metaType === MetaType.TimeSignature && event.rawData.length >= 4) {
        event.data1 = event.rawData[0]; // numerator
        event.data2 = event.rawData[1]; // denominator power
      } else if (event.metaType === MetaType.KeySignature && event.rawData.length >= 2) {
        event.data1 = (event.rawData[0] << 24) >> 24; // signed
        event.data2 = event.rawData[1];
      }
      // Running status is cancelled by meta events
      runningStatus = 0;
    } else if (statusByte === 0xF0) {
      // SysEx
      event.type = MidiEventKind.SysEx;
      const [len, vl] = readVLQ(data, offset);
      offset += vl;
      event.rawData = data.slice(offset, offset + len);
      offset += len;
      runningStatus = 0;
    } else if (statusByte === 0xF7) {
      // SysEx continuation / escape
      event.type = MidiEventKind.SysExContinue;
      const [len, vl] = readVLQ(data, offset);
      offset += vl;
      event.rawData = data.slice(offset, offset + len);
      offset += len;
      runningStatus = 0;
    } else if (statusByte >= 0x80 && statusByte <= 0xEF) {
      // Channel message
      const hi = statusByte & 0xF0;
      event.type = hi as MidiEventKind;
      event.channel = statusByte & 0x0F;
      const msgLen = channelMessageLength(statusByte);
      event.data1 = data[offset++];
      if (msgLen === 2) {
        event.data2 = data[offset++];
      }
      // Pitch bend: combine to signed 14-bit
      if (hi === MidiEventKind.PitchBend) {
        event.data1 = event.data1 | (event.data2 << 7); // 14-bit unsigned
      }
      runningStatus = statusByte;
    } else {
      // Unknown status, skip
      offset++;
    }

    events.push(event);
  }

  return { events, name: trackName };
}

// -- Main parser -------------------------------------------------------------

export function parseMidi(buffer: ArrayBuffer): MidiFile {
  const view = new DataView(buffer);
  const data = new Uint8Array(buffer);
  let offset = 0;

  // Read MThd
  const chunkType = readString(view, offset, 4);
  if (chunkType !== 'MThd') throw new Error('Not a Standard MIDI file (missing MThd)');
  offset += 4;

  const headerLen = view.getUint32(offset);
  offset += 4;

  if (headerLen < 6) throw new Error('MThd chunk too short');

  const format = view.getUint16(offset); offset += 2;
  const numTracks = view.getUint16(offset); offset += 2;
  const division = view.getUint16(offset); offset += 2;

  // Skip extra header bytes
  offset = 8 + headerLen;

  const header: MidiHeader = {
    format,
    numTracks,
    ticksPerQuarterNote: 0,
  };

  if (division & 0x8000) {
    // SMPTE-based timing
    const fps = -((division >> 8) << 24 >> 24); // sign-extend
    const tpf = division & 0xFF;
    header.smpte = { framesPerSecond: fps, ticksPerFrame: tpf };
    header.ticksPerQuarterNote = fps * tpf; // approximate fallback
  } else {
    header.ticksPerQuarterNote = division;
  }

  // Read tracks, skipping unknown chunks
  const tracks: MidiTrack[] = [];
  for (let i = 0; i < numTracks && offset < data.length; i++) {
    while (offset + 8 <= data.length) {
      const cType = readString(view, offset, 4);
      const cLen = view.getUint32(offset + 4);
      if (cType === 'MTrk') {
        offset += 8;
        const end = Math.min(offset + cLen, data.length);
        const trackData = data.slice(offset, end);
        tracks.push(parseTrack(trackData));
        offset = end;
        break;
      }
      // Skip unknown chunk
      offset += 8 + cLen;
    }
  }

  return { header, tracks };
}
