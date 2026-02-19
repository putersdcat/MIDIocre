// Midiocre — Event scheduler (Web Audio timebase, lookahead pattern)

import { MidiTimeline, MidiEvent, MidiEventKind } from '../midi/MidiTypes.js';
import { Synthesizer } from '../synth/Synthesizer.js';

const SCHEDULE_AHEAD = 0.1;  // schedule events 100ms ahead
const TIMER_INTERVAL = 25;   // check every 25ms

export class Scheduler {
  private timeline: MidiTimeline | null = null;
  private synth: Synthesizer;
  private cursor = 0;            // index into timeline.events
  private startAudioTime = 0;    // ctx.currentTime when playback started
  private startTimelineTime = 0; // timeline seconds offset when started
  private tempoMultiplier = 1.0;
  private timerId: number | null = null;
  private playing = false;
  private onEventCallback?: (event: MidiEvent) => void;
  private onEndCallback?: () => void;

  constructor(synth: Synthesizer) {
    this.synth = synth;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTime(): number {
    if (!this.playing || !this.timeline) return this.startTimelineTime;
    const ctx = this.synth.audioContext;
    const elapsed = (ctx.currentTime - this.startAudioTime) * this.tempoMultiplier;
    return this.startTimelineTime + elapsed;
  }

  set tempo(multiplier: number) {
    if (this.playing) {
      // Recalculate start time to maintain current position
      const pos = this.currentTime;
      this.startTimelineTime = pos;
      this.startAudioTime = this.synth.audioContext.currentTime;
    }
    this.tempoMultiplier = Math.max(0.1, Math.min(4, multiplier));
  }

  get tempo(): number {
    return this.tempoMultiplier;
  }

  setTimeline(timeline: MidiTimeline): void {
    this.timeline = timeline;
    this.cursor = 0;
    this.startTimelineTime = 0;
  }

  start(fromTime?: number): void {
    if (!this.timeline) return;
    const ctx = this.synth.audioContext;

    if (fromTime !== undefined) {
      this.startTimelineTime = fromTime;
      // Find cursor position for this time
      this.cursor = 0;
      for (let i = 0; i < this.timeline.events.length; i++) {
        if (this.timeline.events[i].absoluteTime >= fromTime) {
          this.cursor = i;
          break;
        }
        if (i === this.timeline.events.length - 1) {
          this.cursor = this.timeline.events.length;
        }
      }
    }

    this.startAudioTime = ctx.currentTime;
    this.playing = true;
    this.scheduleLoop();
  }

  stop(): void {
    this.playing = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.synth.allSoundOff();
  }

  pause(): void {
    if (!this.playing) return;
    this.startTimelineTime = this.currentTime;
    this.playing = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.synth.allSoundOff();
  }

  resume(): void {
    if (this.playing) return;
    this.start(this.startTimelineTime);
  }

  seekTo(timeSeconds: number): void {
    const wasPlaying = this.playing;
    this.stop();

    if (!this.timeline) return;

    // Rebuild channel state up to the seek position
    this.synth.resetAllChannels();
    for (let i = 0; i < this.timeline.events.length; i++) {
      const ev = this.timeline.events[i];
      if (ev.absoluteTime > timeSeconds) break;

      // Replay control events (not notes)
      if (ev.type === MidiEventKind.ProgramChange) {
        this.synth.programChange(ev.channel, ev.data1);
      } else if (ev.type === MidiEventKind.ControlChange) {
        this.synth.controlChange(ev.channel, ev.data1, ev.data2);
      } else if (ev.type === MidiEventKind.PitchBend) {
        this.synth.pitchBend(ev.channel, ev.data1);
      }
    }

    if (wasPlaying) {
      this.start(timeSeconds);
    } else {
      this.startTimelineTime = timeSeconds;
      // Position cursor
      this.cursor = 0;
      if (this.timeline) {
        for (let i = 0; i < this.timeline.events.length; i++) {
          if (this.timeline.events[i].absoluteTime >= timeSeconds) {
            this.cursor = i;
            break;
          }
          if (i === this.timeline.events.length - 1) {
            this.cursor = this.timeline.events.length;
          }
        }
      }
    }
  }

  onEvent(cb: (event: MidiEvent) => void): void {
    this.onEventCallback = cb;
  }

  onEnd(cb: () => void): void {
    this.onEndCallback = cb;
  }

  private scheduleLoop = (): void => {
    if (!this.playing || !this.timeline) return;

    const ctx = this.synth.audioContext;
    const now = ctx.currentTime;
    const lookAheadEnd = now + SCHEDULE_AHEAD;

    while (this.cursor < this.timeline.events.length) {
      const ev = this.timeline.events[this.cursor];
      const eventTimelineTime = ev.absoluteTime;

      // Convert timeline time to audio time
      const elapsedTimeline = eventTimelineTime - this.startTimelineTime;
      const audioTime = this.startAudioTime + elapsedTimeline / this.tempoMultiplier;

      if (audioTime > lookAheadEnd) break;

      // Dispatch event
      this.dispatchEvent(ev, Math.max(audioTime, now));
      this.onEventCallback?.(ev);
      this.cursor++;
    }

    // Check for end
    if (this.cursor >= this.timeline.events.length) {
      this.onEndCallback?.();
      return;
    }

    this.timerId = window.setTimeout(this.scheduleLoop, TIMER_INTERVAL);
  };

  private dispatchEvent(ev: MidiEvent, audioTime: number): void {
    switch (ev.type) {
      case MidiEventKind.NoteOn:
        this.synth.noteOn(ev.channel, ev.data1, ev.data2, audioTime);
        break;
      case MidiEventKind.NoteOff:
        this.synth.noteOff(ev.channel, ev.data1, audioTime);
        break;
      case MidiEventKind.ControlChange:
        this.synth.controlChange(ev.channel, ev.data1, ev.data2);
        break;
      case MidiEventKind.ProgramChange:
        this.synth.programChange(ev.channel, ev.data1);
        break;
      case MidiEventKind.PitchBend:
        this.synth.pitchBend(ev.channel, ev.data1);
        break;
      // SysEx and meta events: handled at timeline/transport level
    }
  }
}
