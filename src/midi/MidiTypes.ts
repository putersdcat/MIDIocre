// Midiocre — MIDI type definitions (spec-compliant per MIDI 1.0 & SMF)

/** Parsed Standard MIDI File */
export interface MidiFile {
  header: MidiHeader;
  tracks: MidiTrack[];
}

export interface MidiHeader {
  format: number;             // 0, 1, or 2
  numTracks: number;
  ticksPerQuarterNote: number; // valid when bit 15 of division is 0
  smpte?: { framesPerSecond: number; ticksPerFrame: number };
}

export interface MidiTrack {
  events: MidiEvent[];
  name?: string;
}

/** Unified event structure for all MIDI event types */
export interface MidiEvent {
  deltaTicks: number;
  absoluteTicks: number;
  absoluteTime: number;   // seconds, resolved from tempo map
  type: MidiEventKind;
  status: number;         // full status byte
  channel: number;        // 0-15 for channel msgs, -1 otherwise
  data1: number;          // first data byte (note, CC #, program, etc.)
  data2: number;          // second data byte (velocity, CC value, etc.)
  metaType: number;       // meta sub-type if type === Meta
  rawData: Uint8Array;    // raw payload for meta/sysex
}

export enum MidiEventKind {
  NoteOff          = 0x80,
  NoteOn           = 0x90,
  PolyPressure     = 0xA0,
  ControlChange    = 0xB0,
  ProgramChange    = 0xC0,
  ChannelPressure  = 0xD0,
  PitchBend        = 0xE0,
  SysEx            = 0xF0,
  SysExContinue    = 0xF7,
  Meta             = 0xFF,
}

export enum MetaType {
  SequenceNumber   = 0x00,
  TextEvent        = 0x01,
  Copyright        = 0x02,
  TrackName        = 0x03,
  InstrumentName   = 0x04,
  Lyric            = 0x05,
  Marker           = 0x06,
  CuePoint         = 0x07,
  ChannelPrefix    = 0x20,
  EndOfTrack       = 0x2F,
  SetTempo         = 0x51,
  SMPTEOffset      = 0x54,
  TimeSignature    = 0x58,
  KeySignature     = 0x59,
  SequencerSpecific = 0x7F,
}

/** Tempo change entry in the tempo map */
export interface TempoEntry {
  tick: number;
  tempo: number;       // microseconds per quarter note
  timeSeconds: number; // absolute time at this tick
}

/** Time signature entry */
export interface TimeSignatureEntry {
  tick: number;
  numerator: number;
  denominator: number; // as power of 2: 2=quarter, 3=eighth
  clocksPerClick: number;
  notated32ndPerQuarter: number;
}

/** Key signature entry */
export interface KeySignatureEntry {
  tick: number;
  key: number;   // -7..7 (flats..sharps)
  scale: number; // 0=major, 1=minor
}

/** Merged + time-resolved timeline for playback */
export interface MidiTimeline {
  events: MidiEvent[];
  tempoMap: TempoEntry[];
  timeSignatures: TimeSignatureEntry[];
  keySignatures: KeySignatureEntry[];
  durationTicks: number;
  durationSeconds: number;
  ticksPerQuarterNote: number;
}
