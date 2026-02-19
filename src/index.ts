// Midiocre — Library entry point (public exports)

export { Midiocre, type MidiocreConfig, type MidiocreState } from './api/Midiocre.js';
export { parseMidi } from './midi/MidiParser.js';
export { buildTimeline, tickToTime, timeToTick } from './midi/TempoMap.js';
export { parseSF2 } from './sf2/SF2Parser.js';
export { buildSF2, mergeSF2, type ExtractOptions, type MergeEntry } from './sf2/SF2Builder.js';
export type { MidiFile, MidiHeader, MidiTrack, MidiEvent, MidiTimeline } from './midi/MidiTypes.js';
export { MidiEventKind, MetaType } from './midi/MidiTypes.js';
export type { SF2File, SF2Info, SF2Preset, SF2Instrument, SF2SampleHeader, SF2Zone } from './sf2/SF2Types.js';
export { SF2Gen, SF2SampleMode } from './sf2/SF2Types.js';
export { Synthesizer } from './synth/Synthesizer.js';
export { Scheduler } from './engine/Scheduler.js';
export { Transport, type TransportState } from './engine/Transport.js';
