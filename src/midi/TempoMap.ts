// Midiocre — Tempo map construction + tick↔time conversion

import {
  MidiFile, MidiEvent, MidiEventKind, MetaType,
  MidiTimeline, TempoEntry, TimeSignatureEntry, KeySignatureEntry,
} from './MidiTypes.js';

const DEFAULT_TEMPO = 500000; // 120 BPM in µs per quarter note

/** Build a unified, time-resolved, seek-safe timeline from a parsed MidiFile */
export function buildTimeline(midi: MidiFile): MidiTimeline {
  const tpq = midi.header.ticksPerQuarterNote;

  // Merge all tracks into a single event list with absolute ticks
  let merged: MidiEvent[] = [];
  for (const track of midi.tracks) {
    for (const ev of track.events) {
      merged.push(ev);
    }
  }

  // Sort by absolute tick (stable: preserve track-internal order)
  merged.sort((a, b) => a.absoluteTicks - b.absoluteTicks);

  // Extract tempo map first pass
  const tempoMap: TempoEntry[] = [{ tick: 0, tempo: DEFAULT_TEMPO, timeSeconds: 0 }];
  const timeSignatures: TimeSignatureEntry[] = [];
  const keySignatures: KeySignatureEntry[] = [];

  for (const ev of merged) {
    if (ev.type === MidiEventKind.Meta) {
      if (ev.metaType === MetaType.SetTempo && ev.rawData.length >= 3) {
        const tempo = (ev.rawData[0] << 16) | (ev.rawData[1] << 8) | ev.rawData[2];
        // Only add if tick advanced or replace tempo at same tick
        const last = tempoMap[tempoMap.length - 1];
        if (ev.absoluteTicks === last.tick) {
          last.tempo = tempo;
        } else {
          const dt = ev.absoluteTicks - last.tick;
          const seconds = last.timeSeconds + (dt / tpq) * (last.tempo / 1_000_000);
          tempoMap.push({ tick: ev.absoluteTicks, tempo, timeSeconds: seconds });
        }
      } else if (ev.metaType === MetaType.TimeSignature && ev.rawData.length >= 4) {
        timeSignatures.push({
          tick: ev.absoluteTicks,
          numerator: ev.rawData[0],
          denominator: ev.rawData[1],
          clocksPerClick: ev.rawData[2],
          notated32ndPerQuarter: ev.rawData[3],
        });
      } else if (ev.metaType === MetaType.KeySignature && ev.rawData.length >= 2) {
        keySignatures.push({
          tick: ev.absoluteTicks,
          key: (ev.rawData[0] << 24) >> 24,
          scale: ev.rawData[1],
        });
      }
    }
  }

  // Assign absolute time to every event using the tempo map
  let tmIdx = 0;
  for (const ev of merged) {
    while (tmIdx + 1 < tempoMap.length && tempoMap[tmIdx + 1].tick <= ev.absoluteTicks) {
      tmIdx++;
    }
    const tm = tempoMap[tmIdx];
    const dtick = ev.absoluteTicks - tm.tick;
    ev.absoluteTime = tm.timeSeconds + (dtick / tpq) * (tm.tempo / 1_000_000);
  }

  // Compute total duration
  const lastEvent = merged[merged.length - 1];
  const durationTicks = lastEvent ? lastEvent.absoluteTicks : 0;
  const durationSeconds = lastEvent ? lastEvent.absoluteTime : 0;

  return {
    events: merged,
    tempoMap,
    timeSignatures,
    keySignatures,
    durationTicks,
    durationSeconds,
    ticksPerQuarterNote: tpq,
  };
}

/** Convert tick to seconds using a tempo map */
export function tickToTime(tick: number, tempoMap: TempoEntry[], tpq: number): number {
  let tmIdx = 0;
  while (tmIdx + 1 < tempoMap.length && tempoMap[tmIdx + 1].tick <= tick) {
    tmIdx++;
  }
  const tm = tempoMap[tmIdx];
  const dtick = tick - tm.tick;
  return tm.timeSeconds + (dtick / tpq) * (tm.tempo / 1_000_000);
}

/** Convert time (seconds) to tick using a tempo map */
export function timeToTick(time: number, tempoMap: TempoEntry[], tpq: number): number {
  // Find the tempo entry active at `time`
  let tmIdx = 0;
  while (tmIdx + 1 < tempoMap.length && tempoMap[tmIdx + 1].timeSeconds <= time) {
    tmIdx++;
  }
  const tm = tempoMap[tmIdx];
  const dt = time - tm.timeSeconds;
  const ticksPerSecond = tpq / (tm.tempo / 1_000_000);
  return tm.tick + dt * ticksPerSecond;
}
