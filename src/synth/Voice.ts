// Midiocre — Voice management (single sounding note backed by SF2 sample data)

import { SF2Gen, SF2SampleHeader, GENERATOR_DEFAULTS, SF2SampleMode } from '../sf2/SF2Types.js';
import { EnvelopeParams, scheduleEnvelope, scheduleRelease, centibelToGain } from './Envelope.js';
import { Channel } from './Channel.js';

export interface VoiceParams {
  key: number;
  velocity: number;
  channel: number;
  sample: SF2SampleHeader;
  generators: Map<SF2Gen, number>;
  envelope: EnvelopeParams;
  sampleBuffer: AudioBuffer;
}

export class Voice {
  readonly key: number;
  readonly velocity: number;
  readonly channelNum: number;
  readonly startTime: number;

  private source: AudioBufferSourceNode;
  private envGain: GainNode;
  private channelGain: GainNode;
  private panNode: StereoPannerNode;
  private releaseTime: number;
  private released = false;
  private finished = false;
  sustained = false; // held by sustain pedal

  constructor(
    ctx: AudioContext,
    dest: AudioNode,
    params: VoiceParams,
    channel: Channel,
    audioTime: number,
  ) {
    this.key = params.key;
    this.velocity = params.velocity;
    this.channelNum = params.channel;
    this.startTime = audioTime;
    this.releaseTime = params.envelope.release;

    const g = (gen: SF2Gen) => params.generators.get(gen) ?? GENERATOR_DEFAULTS[gen] ?? 0;

    // Source node
    this.source = ctx.createBufferSource();
    this.source.buffer = params.sampleBuffer;

    // Calculate playback rate
    const sampleRate = params.sample.sampleRate;
    const rootKey = g(SF2Gen.overridingRootKey) >= 0 && g(SF2Gen.overridingRootKey) <= 127
      ? g(SF2Gen.overridingRootKey)
      : params.sample.originalPitch;
    const coarseTune = g(SF2Gen.coarseTune);
    const fineTune = g(SF2Gen.fineTune) + params.sample.pitchCorrection;
    const scaleTuning = g(SF2Gen.scaleTuning) / 100; // default 100 = 1.0

    const semitones = (params.key - rootKey) * scaleTuning + coarseTune + fineTune / 100;
    const pitchBendSemitones = channel.pitchBendSemitones;
    const totalSemitones = semitones + pitchBendSemitones;

    this.source.playbackRate.value = (sampleRate / ctx.sampleRate) * Math.pow(2, totalSemitones / 12);

    // Loop configuration
    const sampleModes = g(SF2Gen.sampleModes);
    if (sampleModes === SF2SampleMode.LoopContinuous || sampleModes === SF2SampleMode.LoopReleaseEnd) {
      const loopStart = params.sample.loopStart + g(SF2Gen.startloopAddrsOffset) + g(SF2Gen.startloopAddrsCoarseOffset) * 32768;
      const loopEnd = params.sample.loopEnd + g(SF2Gen.endloopAddrsOffset) + g(SF2Gen.endloopAddrsCoarseOffset) * 32768;
      if (loopEnd > loopStart && loopStart >= params.sample.start) {
        this.source.loop = true;
        this.source.loopStart = (loopStart - params.sample.start) / sampleRate;
        this.source.loopEnd = (loopEnd - params.sample.start) / sampleRate;
      }
    }

    // Envelope gain node
    this.envGain = ctx.createGain();
    scheduleEnvelope(this.envGain, params.envelope, audioTime);

    // Velocity + initial attenuation
    const attenuation = g(SF2Gen.initialAttenuation);
    const velGain = (params.velocity / 127);
    const attenGain = centibelToGain(attenuation);

    // Channel gain node
    this.channelGain = ctx.createGain();
    this.channelGain.gain.value = channel.gain * velGain * attenGain;

    // Pan node
    this.panNode = ctx.createStereoPanner();
    const genPan = g(SF2Gen.pan) / 500; // SF2: -500..500 = -1..1
    this.panNode.pan.value = Math.max(-1, Math.min(1, genPan + channel.panPosition * 0.5));

    // Connect: source → envGain → channelGain → pan → destination
    this.source.connect(this.envGain);
    this.envGain.connect(this.channelGain);
    this.channelGain.connect(this.panNode);
    this.panNode.connect(dest);

    // Start playback
    const startOffset = g(SF2Gen.startAddrsOffset) + g(SF2Gen.startAddrsCoarseOffset) * 32768;
    const sampleStart = Math.max(0, startOffset) / sampleRate;
    this.source.start(audioTime, sampleStart);

    // Auto-cleanup on end
    this.source.onended = () => { this.finished = true; };
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get isReleased(): boolean {
    return this.released;
  }

  /** Update channel gain (for CC changes during note) */
  updateChannelGain(channel: Channel): void {
    this.channelGain.gain.value = channel.gain * (this.velocity / 127);
  }

  /** Update pitch bend */
  updatePitchBend(channel: Channel, sample: SF2SampleHeader, gens: Map<SF2Gen, number>): void {
    const g = (gen: SF2Gen) => gens.get(gen) ?? GENERATOR_DEFAULTS[gen] ?? 0;
    const rootKey = g(SF2Gen.overridingRootKey) >= 0 && g(SF2Gen.overridingRootKey) <= 127
      ? g(SF2Gen.overridingRootKey) : sample.originalPitch;
    const coarseTune = g(SF2Gen.coarseTune);
    const fineTune = g(SF2Gen.fineTune) + sample.pitchCorrection;
    const scaleTuning = g(SF2Gen.scaleTuning) / 100;
    const semitones = (this.key - rootKey) * scaleTuning + coarseTune + fineTune / 100;
    const total = semitones + channel.pitchBendSemitones;
    this.source.playbackRate.value = (sample.sampleRate / this.source.context.sampleRate) *
      Math.pow(2, total / 12);
  }

  /** Trigger note-off release phase */
  release(audioTime: number): void {
    if (this.released) return;
    this.released = true;
    this.sustained = false;
    scheduleRelease(this.envGain, this.releaseTime, audioTime);

    // Stop source after release completes
    const stopTime = audioTime + this.releaseTime * 2 + 0.1;
    try { this.source.stop(stopTime); } catch { /* already stopped */ }
  }

  /** Immediately stop and disconnect */
  kill(): void {
    this.finished = true;
    this.released = true;
    try { this.source.stop(); } catch { /* noop */ }
    try {
      this.source.disconnect();
      this.envGain.disconnect();
      this.channelGain.disconnect();
      this.panNode.disconnect();
    } catch { /* noop */ }
  }
}
