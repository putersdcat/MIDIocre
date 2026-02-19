// Midiocre — Volume envelope (SF2 6-stage: delay, attack, hold, decay, sustain, release)
// Uses Web Audio gain parameter scheduling for efficiency

import { SF2Gen, GENERATOR_DEFAULTS } from '../sf2/SF2Types.js';

/** Convert SF2 timecents to seconds. -32768 → ~0 (instant) */
export function timecentsToSeconds(tc: number): number {
  if (tc <= -32768) return 0;
  return Math.pow(2, tc / 1200);
}

/** Convert centibels attenuation to linear gain */
export function centibelToGain(cb: number): number {
  if (cb <= 0) return 1;
  if (cb >= 1440) return 0; // ~144 dB = silence
  return Math.pow(10, -cb / 200);
}

/** Envelope parameters resolved from generators */
export interface EnvelopeParams {
  delay: number;    // seconds
  attack: number;   // seconds
  hold: number;     // seconds
  decay: number;    // seconds
  sustain: number;  // linear gain (0–1) for vol env; 0–1 level for mod env
  release: number;  // seconds
}

/** Resolve volume envelope from combined generator map */
export function resolveVolEnvelope(gens: Map<SF2Gen, number>, key: number): EnvelopeParams {
  const g = (gen: SF2Gen) => gens.get(gen) ?? GENERATOR_DEFAULTS[gen] ?? 0;

  let holdTC = g(SF2Gen.holdVolEnv);
  let decayTC = g(SF2Gen.decayVolEnv);

  // Key-number scaling (centered on key 60)
  const holdScale = g(SF2Gen.keynumToVolEnvHold);
  const decayScale = g(SF2Gen.keynumToVolEnvDecay);
  holdTC += holdScale * (key - 60);
  decayTC += decayScale * (key - 60);

  const sustainCB = g(SF2Gen.sustainVolEnv);

  return {
    delay: timecentsToSeconds(g(SF2Gen.delayVolEnv)),
    attack: timecentsToSeconds(g(SF2Gen.attackVolEnv)),
    hold: timecentsToSeconds(holdTC),
    decay: timecentsToSeconds(decayTC),
    sustain: centibelToGain(sustainCB),
    release: timecentsToSeconds(g(SF2Gen.releaseVolEnv)),
  };
}

/** Schedule the volume envelope on a GainNode starting at `startTime` */
export function scheduleEnvelope(
  gainNode: GainNode,
  env: EnvelopeParams,
  startTime: number,
): void {
  const gain = gainNode.gain;

  // Clamp minimum times to avoid scheduling artifacts
  const minTime = 0.001;
  const delay = Math.max(env.delay, 0);
  const attack = Math.max(env.attack, minTime);
  const hold = Math.max(env.hold, 0);
  const decay = Math.max(env.decay, minTime);
  const sustain = Math.max(env.sustain, 0.0001);

  const t0 = startTime + delay;
  const t1 = t0 + attack;
  const t2 = t1 + hold;
  const t3 = t2 + decay;

  // Start at zero during delay
  gain.setValueAtTime(0.0001, startTime);

  if (delay > 0) {
    gain.setValueAtTime(0.0001, t0);
  }

  // Attack: ramp to peak
  gain.linearRampToValueAtTime(1.0, t1);

  // Hold: stay at peak
  if (hold > 0) {
    gain.setValueAtTime(1.0, t2);
  }

  // Decay: exponential ramp to sustain level
  gain.setTargetAtTime(sustain, t2, decay / 3);
}

/** Schedule the release phase on a GainNode */
export function scheduleRelease(
  gainNode: GainNode,
  releaseTime: number,
  noteOffTime: number,
): void {
  const release = Math.max(releaseTime, 0.005);
  const gain = gainNode.gain;
  gain.cancelScheduledValues(noteOffTime);
  gain.setValueAtTime(gain.value || 0.0001, noteOffTime);
  gain.setTargetAtTime(0.0001, noteOffTime, release / 3);
}
