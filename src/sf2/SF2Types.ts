// Midiocre — SF2 type definitions (per SoundFont 2.01 spec)

export interface SF2File {
  info: SF2Info;
  sampleData: Int16Array;       // raw 16-bit sample data
  sampleDataFloat: Float32Array; // normalized to [-1, 1]
  presets: SF2Preset[];
  instruments: SF2Instrument[];
  samples: SF2SampleHeader[];
  // Raw hydra for builder use
  rawPresetHeaders: RawPresetHeader[];
  rawPresetBags: RawBag[];
  rawPresetMods: RawMod[];
  rawPresetGens: RawGen[];
  rawInstHeaders: RawInstHeader[];
  rawInstBags: RawBag[];
  rawInstMods: RawMod[];
  rawInstGens: RawGen[];
  rawSampleHeaders: RawSampleHeader[];
}

export interface SF2Info {
  version: { major: number; minor: number };
  soundEngine: string;
  name: string;
  rom?: string;
  romVersion?: { major: number; minor: number };
  creationDate?: string;
  engineers?: string;
  product?: string;
  copyright?: string;
  comments?: string;
  tools?: string;
}

export interface SF2Preset {
  name: string;
  preset: number;    // MIDI program 0-127
  bank: number;      // MIDI bank
  zones: SF2Zone[];
  globalZone?: SF2Zone;
}

export interface SF2Instrument {
  name: string;
  zones: SF2Zone[];
  globalZone?: SF2Zone;
}

export interface SF2Zone {
  keyRangeLo: number;
  keyRangeHi: number;
  velRangeLo: number;
  velRangeHi: number;
  generators: Map<SF2Gen, number>;
  modulators: RawMod[];
}

export interface SF2SampleHeader {
  name: string;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  originalPitch: number;
  pitchCorrection: number;
  sampleLink: number;
  sampleType: number;
}

// Generator enum — per SF2 spec section 8.1.2
export enum SF2Gen {
  startAddrsOffset          = 0,
  endAddrsOffset            = 1,
  startloopAddrsOffset      = 2,
  endloopAddrsOffset        = 3,
  startAddrsCoarseOffset    = 4,
  modLfoToPitch             = 5,
  vibLfoToPitch             = 6,
  modEnvToPitch             = 7,
  initialFilterFc           = 8,
  initialFilterQ            = 9,
  modLfoToFilterFc          = 10,
  modLfoToVolume            = 11,
  endAddrsCoarseOffset      = 12,
  modEnvToFilterFc          = 13,
  chorusEffectsSend         = 15,
  reverbEffectsSend         = 16,
  pan                       = 17,
  delayModLFO               = 21,
  freqModLFO                = 22,
  delayVibLFO               = 23,
  freqVibLFO                = 24,
  delayModEnv               = 25,
  attackModEnv              = 26,
  holdModEnv                = 27,
  decayModEnv               = 28,
  sustainModEnv             = 29,
  releaseModEnv             = 30,
  keynumToModEnvHold        = 31,
  keynumToModEnvDecay       = 32,
  delayVolEnv               = 33,
  attackVolEnv              = 34,
  holdVolEnv                = 35,
  decayVolEnv               = 36,
  sustainVolEnv             = 37,
  releaseVolEnv             = 38,
  keynumToVolEnvHold        = 39,
  keynumToVolEnvDecay       = 40,
  instrument                = 41,
  keyRange                  = 43,
  velRange                  = 44,
  startloopAddrsCoarseOffset = 45,
  keynum                    = 46,
  velocity                  = 47,
  initialAttenuation        = 48,
  endloopAddrsCoarseOffset  = 50,
  coarseTune                = 51,
  fineTune                  = 52,
  sampleID                  = 53,
  sampleModes               = 54,
  scaleTuning               = 56,
  exclusiveClass            = 57,
  overridingRootKey         = 58,
  endOper                   = 60,
}

// Sample modes
export enum SF2SampleMode {
  NoLoop        = 0,
  LoopContinuous = 1,
  LoopReleaseEnd = 3, // loop during depression, then play out
}

// --- Raw hydra record types (for parsing/building) ---

export interface RawPresetHeader {
  name: string;
  preset: number;
  bank: number;
  bagIndex: number;
  library: number;
  genre: number;
  morphology: number;
}

export interface RawInstHeader {
  name: string;
  bagIndex: number;
}

export interface RawBag {
  genIndex: number;
  modIndex: number;
}

export interface RawGen {
  oper: number;
  amount: number; // signed 16-bit (or packed ranges)
}

export interface RawMod {
  srcOper: number;
  destOper: number;
  amount: number;
  amtSrcOper: number;
  transOper: number;
}

export interface RawSampleHeader {
  name: string;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  originalPitch: number;
  pitchCorrection: number;
  sampleLink: number;
  sampleType: number;
}

// Default generator values (per SF2 spec section 8.1.3)
export const GENERATOR_DEFAULTS: Partial<Record<SF2Gen, number>> = {
  [SF2Gen.startAddrsOffset]: 0,
  [SF2Gen.endAddrsOffset]: 0,
  [SF2Gen.startloopAddrsOffset]: 0,
  [SF2Gen.endloopAddrsOffset]: 0,
  [SF2Gen.startAddrsCoarseOffset]: 0,
  [SF2Gen.endAddrsCoarseOffset]: 0,
  [SF2Gen.startloopAddrsCoarseOffset]: 0,
  [SF2Gen.endloopAddrsCoarseOffset]: 0,
  [SF2Gen.modLfoToPitch]: 0,
  [SF2Gen.vibLfoToPitch]: 0,
  [SF2Gen.modEnvToPitch]: 0,
  [SF2Gen.initialFilterFc]: 13500,
  [SF2Gen.initialFilterQ]: 0,
  [SF2Gen.modLfoToFilterFc]: 0,
  [SF2Gen.modLfoToVolume]: 0,
  [SF2Gen.modEnvToFilterFc]: 0,
  [SF2Gen.chorusEffectsSend]: 0,
  [SF2Gen.reverbEffectsSend]: 0,
  [SF2Gen.pan]: 0,
  [SF2Gen.delayModLFO]: -12000,
  [SF2Gen.freqModLFO]: 0,
  [SF2Gen.delayVibLFO]: -12000,
  [SF2Gen.freqVibLFO]: 0,
  [SF2Gen.delayModEnv]: -12000,
  [SF2Gen.attackModEnv]: -12000,
  [SF2Gen.holdModEnv]: -12000,
  [SF2Gen.decayModEnv]: -12000,
  [SF2Gen.sustainModEnv]: 0,
  [SF2Gen.releaseModEnv]: -12000,
  [SF2Gen.keynumToModEnvHold]: 0,
  [SF2Gen.keynumToModEnvDecay]: 0,
  [SF2Gen.delayVolEnv]: -12000,
  [SF2Gen.attackVolEnv]: -12000,
  [SF2Gen.holdVolEnv]: -12000,
  [SF2Gen.decayVolEnv]: -12000,
  [SF2Gen.sustainVolEnv]: 0,
  [SF2Gen.releaseVolEnv]: -12000,
  [SF2Gen.keynumToVolEnvHold]: 0,
  [SF2Gen.keynumToVolEnvDecay]: 0,
  [SF2Gen.initialAttenuation]: 0,
  [SF2Gen.coarseTune]: 0,
  [SF2Gen.fineTune]: 0,
  [SF2Gen.scaleTuning]: 100,
  [SF2Gen.exclusiveClass]: 0,
  [SF2Gen.sampleModes]: 0,
};

// Generators that are "sample" type and don't apply at preset level
export const SAMPLE_GENERATORS = new Set<SF2Gen>([
  SF2Gen.startAddrsOffset, SF2Gen.endAddrsOffset,
  SF2Gen.startloopAddrsOffset, SF2Gen.endloopAddrsOffset,
  SF2Gen.startAddrsCoarseOffset, SF2Gen.endAddrsCoarseOffset,
  SF2Gen.startloopAddrsCoarseOffset, SF2Gen.endloopAddrsCoarseOffset,
  SF2Gen.sampleModes, SF2Gen.exclusiveClass,
  SF2Gen.overridingRootKey,
]);
