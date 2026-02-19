// Midiocre — Public API facade

import { parseMidi } from '../midi/MidiParser.js';
import { buildTimeline, tickToTime, timeToTick } from '../midi/TempoMap.js';
import { MidiFile, MidiTimeline } from '../midi/MidiTypes.js';
import { parseSF2 } from '../sf2/SF2Parser.js';
import { SF2File } from '../sf2/SF2Types.js';
import { Synthesizer } from '../synth/Synthesizer.js';
import { Scheduler } from '../engine/Scheduler.js';
import { Transport, TransportState } from '../engine/Transport.js';

export interface MidiocreConfig {
  sf2Path?: string;
  midiPath?: string;
  sf2Files?: string[];
  midiFiles?: string[];
  defaultSF2?: string;
  defaultMIDI?: string;
  autoplay?: boolean;
  loop?: boolean;
  volume?: number;
  tempo?: number;
}

export interface MidiocreState {
  playing: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  tempo: number;
  loop: boolean;
  currentSF2: string | null;
  currentMIDI: string | null;
  forcedPreset: number;
}

const DEFAULT_CONFIG: MidiocreConfig = {
  sf2Path: 'SoundFonts',
  midiPath: 'DemoMidiFiles',
  sf2Files: [],
  midiFiles: [],
  autoplay: false,
  loop: false,
  volume: 0.8,
  tempo: 1.0,
};

export class Midiocre {
  private ctx: AudioContext;
  private synth: Synthesizer;
  private scheduler: Scheduler;
  private transport: Transport;
  private config: MidiocreConfig;
  private currentSF2Name: string | null = null;
  private currentMIDIName: string | null = null;
  private loadedSF2: SF2File | null = null;
  private loadedMidi: MidiFile | null = null;
  private timeline: MidiTimeline | null = null;
  private forcedPreset = -1;

  constructor(config?: Partial<MidiocreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ctx = new AudioContext();
    this.synth = new Synthesizer(this.ctx);
    this.scheduler = new Scheduler(this.synth);
    this.transport = new Transport(this.scheduler);

    if (this.config.volume !== undefined) {
      this.synth.masterVolume = this.config.volume;
    }
    if (this.config.tempo !== undefined) {
      this.transport.tempoMultiplier = this.config.tempo;
    }
    if (this.config.loop !== undefined) {
      this.transport.loop = this.config.loop;
    }
  }

  /** The underlying AudioContext — for attaching AnalyserNodes, etc. */
  get audioContext(): AudioContext {
    return this.ctx;
  }

  /** The master output GainNode — splice visualizers between this and destination */
  get outputNode(): GainNode {
    return this.synth.output;
  }

  // -- Config API ------------------------------------------------------------

  getConfig(): MidiocreConfig {
    return { ...this.config };
  }

  configure(partial: Partial<MidiocreConfig>): void {
    Object.assign(this.config, partial);
    if (partial.volume !== undefined) this.synth.masterVolume = partial.volume;
    if (partial.tempo !== undefined) this.transport.tempoMultiplier = partial.tempo;
    if (partial.loop !== undefined) this.transport.loop = partial.loop;
  }

  // -- Discovery API ---------------------------------------------------------

  listSF2Files(): string[] {
    return this.config.sf2Files ?? [];
  }

  listMIDIFiles(): string[] {
    return this.config.midiFiles ?? [];
  }

  listPresets(): { index: number; bank: number; preset: number; name: string }[] {
    return this.synth.getPresets();
  }

  // -- Loading API -----------------------------------------------------------

  async loadSF2(source: string | ArrayBuffer | File): Promise<void> {
    let buffer: ArrayBuffer;
    let name: string | null = null;

    if (typeof source === 'string') {
      name = source;
      const url = source.startsWith('http') || source.startsWith('/')
        ? source
        : `${this.config.sf2Path}/${source}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to load SF2: ${resp.status} ${url}`);
      buffer = await resp.arrayBuffer();
    } else if (source instanceof File) {
      name = source.name;
      buffer = await source.arrayBuffer();
    } else {
      buffer = source;
    }

    const newSF2 = parseSF2(buffer);

    // If playback is active, do a non-destructive hot swap
    if (this.transport.state === 'playing' || this.transport.state === 'paused') {
      // Build instrument match key from current forced preset
      let matchKey: string | undefined;
      if (this.forcedPreset >= 0 && this.loadedSF2) {
        const oldPreset = this.loadedSF2.presets[this.forcedPreset];
        if (oldPreset) matchKey = `${oldPreset.bank}:${oldPreset.preset}`;
      }
      const matched = this.synth.hotSwapSF2(newSF2, matchKey);
      this.loadedSF2 = newSF2;
      this.currentSF2Name = name;
      // Update forced preset to matched one (or clear to auto)
      if (this.forcedPreset >= 0) {
        this.forcedPreset = matched;
      }
    } else {
      this.loadedSF2 = newSF2;
      this.synth.loadSF2(newSF2);
      this.currentSF2Name = name;
    }
  }

  async loadMIDI(source: string | ArrayBuffer | File): Promise<void> {
    let buffer: ArrayBuffer;
    let name: string | null = null;

    if (typeof source === 'string') {
      name = source;
      const url = source.startsWith('http') || source.startsWith('/')
        ? source
        : `${this.config.midiPath}/${source}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to load MIDI: ${resp.status} ${url}`);
      buffer = await resp.arrayBuffer();
    } else if (source instanceof File) {
      name = source.name;
      buffer = await source.arrayBuffer();
    } else {
      buffer = source;
    }

    this.loadedMidi = parseMidi(buffer);
    this.timeline = buildTimeline(this.loadedMidi);
    this.transport.setTimeline(this.timeline);
    this.currentMIDIName = name;
  }

  // -- Transport API ---------------------------------------------------------

  async play(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      // On iOS Safari, resume() returns a Promise that must be awaited
      try {
        await this.ctx.resume();
      } catch (err) {
        console.warn('AudioContext resume failed:', err);
      }
    }
    this.transport.play();
  }

  pause(): void {
    this.transport.pause();
  }

  stop(): void {
    this.transport.stop();
  }

  seek(timeSeconds: number): void {
    this.transport.seek(timeSeconds);
  }

  // -- Property accessors ----------------------------------------------------

  get volume(): number {
    return this.synth.masterVolume;
  }

  set volume(v: number) {
    this.synth.masterVolume = v;
  }

  get tempo(): number {
    return this.transport.tempoMultiplier;
  }

  set tempo(v: number) {
    this.transport.tempoMultiplier = v;
  }

  get loop(): boolean {
    return this.transport.loop;
  }

  set loop(v: boolean) {
    this.transport.loop = v;
  }

  get currentTime(): number {
    return this.transport.currentTime;
  }

  get duration(): number {
    return this.transport.duration;
  }

  get state(): TransportState {
    return this.transport.state;
  }

  // -- Instrument selection --------------------------------------------------

  setInstrument(presetIndex: number): void {
    this.forcedPreset = presetIndex;
    if (presetIndex >= 0) {
      this.synth.setForcedPreset(presetIndex);
    } else {
      this.synth.clearForcedPreset();
    }
  }

  // -- State serialization ---------------------------------------------------

  getState(): MidiocreState {
    return {
      playing: this.transport.state === 'playing',
      paused: this.transport.state === 'paused',
      currentTime: this.transport.currentTime,
      duration: this.transport.duration,
      volume: this.synth.masterVolume,
      tempo: this.transport.tempoMultiplier,
      loop: this.transport.loop,
      currentSF2: this.currentSF2Name,
      currentMIDI: this.currentMIDIName,
      forcedPreset: this.forcedPreset,
    };
  }

  restoreState(state: MidiocreState): void {
    this.synth.masterVolume = state.volume;
    this.transport.tempoMultiplier = state.tempo;
    this.transport.loop = state.loop;
    if (state.forcedPreset >= 0) {
      this.synth.setForcedPreset(state.forcedPreset);
    } else {
      this.synth.clearForcedPreset();
    }
    this.forcedPreset = state.forcedPreset;

    if (state.playing || state.paused) {
      this.transport.seek(state.currentTime);
      if (state.playing) {
        this.transport.play();
      }
    }
  }

  // -- Callbacks -------------------------------------------------------------

  onStateChange(cb: (state: TransportState) => void): void {
    this.transport.onStateChange(cb);
  }

  onProgress(cb: (time: number, duration: number) => void): void {
    this.transport.onProgress(cb);
  }

  onEvent(cb: (event: any) => void): void {
    this.transport.onEvent(cb);
  }

  // -- Cleanup ---------------------------------------------------------------

  destroy(): void {
    this.transport.stop();
    this.ctx.close();
  }
}
