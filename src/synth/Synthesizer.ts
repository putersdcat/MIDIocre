// Midiocre — Web Audio synthesizer backed by SF2 data

import {
  SF2File, SF2Preset, SF2Zone, SF2Gen, SF2SampleHeader,
  GENERATOR_DEFAULTS, SAMPLE_GENERATORS,
} from '../sf2/SF2Types.js';
import { Channel } from './Channel.js';
import { Voice, VoiceParams } from './Voice.js';
import { resolveVolEnvelope } from './Envelope.js';

const MAX_VOICES = 128;

export class Synthesizer {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private channels: Channel[] = [];
  private voices: Voice[] = [];
  private sf2: SF2File | null = null;
  private presetMap = new Map<string, SF2Preset>(); // "bank:program" → preset
  private sampleBuffers = new Map<number, AudioBuffer>(); // sample index → AudioBuffer
  private forcedPresetIndex: number = -1; // -1 = normal, ≥0 = forced for all channels

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.connect(ctx.destination);

    for (let i = 0; i < 16; i++) {
      this.channels.push(new Channel());
    }
    // Channel 10 (index 9) defaults to percussion bank
    this.channels[9].bank = 128;
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }

  /** The master gain node — connect an AnalyserNode here for visualization */
  get output(): GainNode {
    return this.masterGain;
  }

  get masterVolume(): number {
    return this.masterGain.gain.value;
  }

  set masterVolume(v: number) {
    this.masterGain.gain.setValueAtTime(Math.max(0, Math.min(2, v)), this.ctx.currentTime);
  }

  /** Load a parsed SF2 file, building AudioBuffers for all samples */
  loadSF2(sf2: SF2File): void {
    this.sf2 = sf2;
    this.presetMap.clear();
    this.sampleBuffers.clear();
    this.forcedPresetIndex = -1;
    this.buildPresetMap(sf2);
    this.buildSampleBuffers(sf2);
  }

  /**
   * Hot-swap SF2 without interrupting playback.
   * Active voices continue using old AudioBuffers until they finish.
   * New voices will use the new SF2 data immediately.
   * If matchInstrument is provided (bank:program string), attempts to find matching preset.
   */
  hotSwapSF2(sf2: SF2File, matchInstrument?: string): number {
    // Build new lookup tables in temp vars so the swap is near-atomic
    const newPresetMap = new Map<string, SF2Preset>();
    for (const preset of sf2.presets) {
      const key = `${preset.bank}:${preset.preset}`;
      if (!newPresetMap.has(key)) newPresetMap.set(key, preset);
    }

    const newSampleBuffers = new Map<number, AudioBuffer>();
    for (let i = 0; i < sf2.samples.length; i++) {
      const sh = sf2.samples[i];
      if (sh.sampleType & 0x8000) continue;
      const length = sh.end - sh.start;
      if (length <= 0) continue;

      const audioBuffer = this.ctx.createBuffer(1, length, sh.sampleRate || 44100);
      const channelData = audioBuffer.getChannelData(0);
      const endIdx = Math.min(sh.start + length, sf2.sampleDataFloat.length);
      for (let j = sh.start; j < endIdx; j++) {
        channelData[j - sh.start] = sf2.sampleDataFloat[j];
      }
      newSampleBuffers.set(i, audioBuffer);
    }

    // Atomic swap — old voices keep their AudioBufferSourceNodes which
    // already reference old AudioBuffers, so they continue playing fine
    this.sf2 = sf2;
    this.presetMap = newPresetMap;
    this.sampleBuffers = newSampleBuffers;

    // Try to match the forced preset by bank:program in the new SF2
    let matchedPreset = -1;
    if (matchInstrument && this.forcedPresetIndex >= 0) {
      for (let i = 0; i < sf2.presets.length; i++) {
        const p = sf2.presets[i];
        if (`${p.bank}:${p.preset}` === matchInstrument) {
          matchedPreset = i;
          break;
        }
      }
      // Fallback: match by name similarity
      if (matchedPreset < 0) {
        matchedPreset = -1; // fall to auto
      }
      this.forcedPresetIndex = matchedPreset;
    }
    return matchedPreset;
  }

  private buildPresetMap(sf2: SF2File): void {
    for (const preset of sf2.presets) {
      const key = `${preset.bank}:${preset.preset}`;
      if (!this.presetMap.has(key)) {
        this.presetMap.set(key, preset);
      }
    }
  }

  private buildSampleBuffers(sf2: SF2File): void {
    for (let i = 0; i < sf2.samples.length; i++) {
      const sh = sf2.samples[i];
      if (sh.sampleType & 0x8000) continue;
      const length = sh.end - sh.start;
      if (length <= 0) continue;

      const audioBuffer = this.ctx.createBuffer(1, length, sh.sampleRate || 44100);
      const channelData = audioBuffer.getChannelData(0);
      const endIdx = Math.min(sh.start + length, sf2.sampleDataFloat.length);
      for (let j = sh.start; j < endIdx; j++) {
        channelData[j - sh.start] = sf2.sampleDataFloat[j];
      }
      this.sampleBuffers.set(i, audioBuffer);
    }
  }

  /** Set a forced instrument preset for all channels (demo feature) */
  setForcedPreset(presetIndex: number): void {
    this.forcedPresetIndex = presetIndex;
  }

  /** Clear forced preset, return to per-channel normal mapping */
  clearForcedPreset(): void {
    this.forcedPresetIndex = -1;
  }

  /** Get list of available presets */
  getPresets(): { index: number; bank: number; preset: number; name: string }[] {
    if (!this.sf2) return [];
    return this.sf2.presets.map((p, i) => ({
      index: i, bank: p.bank, preset: p.preset, name: p.name,
    }));
  }

  private findPreset(channel: Channel, channelNum: number): SF2Preset | undefined {
    if (!this.sf2) return undefined;

    // If forced, use forced preset for all channels
    if (this.forcedPresetIndex >= 0 && this.forcedPresetIndex < this.sf2.presets.length) {
      return this.sf2.presets[this.forcedPresetIndex];
    }

    // Normal lookup: bank:program
    const key = `${channel.bank}:${channel.program}`;
    let preset = this.presetMap.get(key);

    // Fallback: try bank 0
    if (!preset && channel.bank !== 0) {
      preset = this.presetMap.get(`0:${channel.program}`);
    }
    // Fallback: try program 0
    if (!preset) {
      preset = this.presetMap.get(`${channel.bank}:0`) || this.presetMap.get('0:0');
    }

    return preset;
  }

  /** Process a MIDI note-on event */
  noteOn(channel: number, key: number, velocity: number, audioTime?: number): void {
    if (velocity === 0) { this.noteOff(channel, key, audioTime); return; }
    if (!this.sf2) return;

    const ch = this.channels[channel];
    const time = audioTime ?? this.ctx.currentTime;
    const preset = this.findPreset(ch, channel);
    if (!preset) return;

    // Match preset zones by key + velocity
    const matchedZones = this.matchPresetZones(preset, key, velocity);

    for (const { instZone, presetZone } of matchedZones) {
      const sampleId = instZone.generators.get(SF2Gen.sampleID);
      if (sampleId === undefined) continue;

      const sample = this.sf2.samples[sampleId];
      if (!sample) continue;

      const audioBuffer = this.sampleBuffers.get(sampleId);
      if (!audioBuffer) continue;

      // Merge generators: instrument global → instrument zone → preset global → preset zone
      const mergedGens = this.mergeGenerators(preset, presetZone, instZone);

      const envelope = resolveVolEnvelope(mergedGens, key);

      const voiceParams: VoiceParams = {
        key, velocity, channel, sample,
        generators: mergedGens,
        envelope,
        sampleBuffer: audioBuffer,
      };

      // Voice stealing if at limit
      this.cleanupVoices();
      if (this.voices.length >= MAX_VOICES) {
        const oldest = this.voices.shift();
        oldest?.kill();
      }

      const voice = new Voice(this.ctx, this.masterGain, voiceParams, ch, time);
      this.voices.push(voice);
    }
  }

  /** Process a MIDI note-off event */
  noteOff(channel: number, key: number, audioTime?: number): void {
    const ch = this.channels[channel];
    const time = audioTime ?? this.ctx.currentTime;

    for (const voice of this.voices) {
      if (voice.channelNum === channel && voice.key === key && !voice.isReleased) {
        if (ch.sustain) {
          voice.sustained = true;
        } else {
          voice.release(time);
        }
      }
    }
  }

  /** Process a MIDI CC event */
  controlChange(channel: number, controller: number, value: number): void {
    const ch = this.channels[channel];
    const wasSustained = ch.sustain;
    ch.handleCC(controller, value);

    // Update voice gains for volume/expression changes
    if (controller === 7 || controller === 11) {
      for (const voice of this.voices) {
        if (voice.channelNum === channel && !voice.isFinished) {
          voice.updateChannelGain(ch);
        }
      }
    }

    // Sustain pedal released: release sustained voices
    if (wasSustained && !ch.sustain) {
      const time = this.ctx.currentTime;
      for (const voice of this.voices) {
        if (voice.channelNum === channel && voice.sustained && !voice.isReleased) {
          voice.release(time);
        }
      }
    }

    // All notes off (CC 123) / All sound off (CC 120)
    if (controller === 120 || controller === 123) {
      this.allNotesOff(channel);
    }
  }

  /** Process a program change event */
  programChange(channel: number, program: number): void {
    this.channels[channel].program = program;
  }

  /** Process a pitch bend event */
  pitchBend(channel: number, value: number): void {
    const ch = this.channels[channel];
    ch.pitchBend = value;
    // Live-update all active voices on this channel is complex;
    // simplified: just update future notes
  }

  /** Stop all notes on a channel */
  allNotesOff(channel: number): void {
    const time = this.ctx.currentTime;
    for (const voice of this.voices) {
      if (voice.channelNum === channel && !voice.isFinished) {
        voice.kill();
      }
    }
  }

  /** Stop all voices across all channels */
  allSoundOff(): void {
    for (const voice of this.voices) {
      voice.kill();
    }
    this.voices = [];
  }

  /** Reset all channels to defaults */
  resetAllChannels(): void {
    for (let i = 0; i < 16; i++) {
      this.channels[i].reset();
    }
    this.channels[9].bank = 128; // percussion
  }

  getChannel(ch: number): Channel {
    return this.channels[ch];
  }

  private cleanupVoices(): void {
    this.voices = this.voices.filter(v => !v.isFinished);
  }

  /** Match preset zones, then resolve to instrument zones */
  private matchPresetZones(preset: SF2Preset, key: number, velocity: number) {
    const results: { instZone: SF2Zone; presetZone: SF2Zone }[] = [];
    if (!this.sf2) return results;

    for (const pZone of preset.zones) {
      if (key < pZone.keyRangeLo || key > pZone.keyRangeHi) continue;
      if (velocity < pZone.velRangeLo || velocity > pZone.velRangeHi) continue;

      const instId = pZone.generators.get(SF2Gen.instrument);
      if (instId === undefined) continue;

      const instrument = this.sf2.instruments[instId];
      if (!instrument) continue;

      for (const iZone of instrument.zones) {
        if (key < iZone.keyRangeLo || key > iZone.keyRangeHi) continue;
        if (velocity < iZone.velRangeLo || velocity > iZone.velRangeHi) continue;

        results.push({ instZone: iZone, presetZone: pZone });
      }
    }

    return results;
  }

  /** Merge generators: inst global + inst zone (absolute), then preset global + preset zone (additive) */
  private mergeGenerators(preset: SF2Preset, presetZone: SF2Zone, instZone: SF2Zone): Map<SF2Gen, number> {
    if (!this.sf2) return instZone.generators;

    const merged = new Map<SF2Gen, number>();

    // Start with defaults
    for (const [gen, val] of Object.entries(GENERATOR_DEFAULTS)) {
      merged.set(Number(gen) as SF2Gen, val as number);
    }

    const instId = presetZone.generators.get(SF2Gen.instrument);
    if (instId !== undefined) {
      const instrument = this.sf2.instruments[instId];
      // Apply instrument global zone (absolute override)
      if (instrument?.globalZone) {
        for (const [gen, val] of instrument.globalZone.generators) {
          merged.set(gen, val);
        }
      }
    }

    // Apply instrument zone generators (absolute override)
    for (const [gen, val] of instZone.generators) {
      merged.set(gen, val);
    }

    // Apply preset global zone generators (ADDITIVE, skip sample generators)
    if (preset.globalZone) {
      for (const [gen, val] of preset.globalZone.generators) {
        if (SAMPLE_GENERATORS.has(gen)) continue;
        if (gen === SF2Gen.keyRange || gen === SF2Gen.velRange || gen === SF2Gen.instrument) continue;
        const current = merged.get(gen) ?? 0;
        merged.set(gen, current + val);
      }
    }

    // Apply preset zone generators (ADDITIVE, skip sample generators)
    for (const [gen, val] of presetZone.generators) {
      if (SAMPLE_GENERATORS.has(gen)) continue;
      if (gen === SF2Gen.keyRange || gen === SF2Gen.velRange || gen === SF2Gen.instrument) continue;
      const current = merged.get(gen) ?? 0;
      merged.set(gen, current + val);
    }

    return merged;
  }
}
