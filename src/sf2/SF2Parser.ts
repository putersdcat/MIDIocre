// Midiocre — SF2/RIFF parser (SoundFont 2.01 spec-compliant)

import {
  SF2File, SF2Info, SF2Preset, SF2Instrument, SF2SampleHeader, SF2Zone, SF2Gen,
  RawPresetHeader, RawInstHeader, RawBag, RawGen, RawMod, RawSampleHeader,
} from './SF2Types.js';

// -- Binary helpers ----------------------------------------------------------

function readFourCC(view: DataView, offset: number): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function readZStr(view: DataView, offset: number, maxLen: number): string {
  let s = '';
  for (let i = 0; i < maxLen; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

// -- RIFF chunk reader -------------------------------------------------------

interface Chunk {
  id: string;
  size: number;
  dataOffset: number;
  formType?: string;
}

function readChunk(view: DataView, offset: number): Chunk {
  const id = readFourCC(view, offset);
  const size = view.getUint32(offset + 4, true); // RIFF is little-endian
  let formType: string | undefined;
  let dataOffset = offset + 8;

  if (id === 'RIFF' || id === 'LIST') {
    formType = readFourCC(view, dataOffset);
    dataOffset += 4;
  }

  return { id, size, dataOffset, formType };
}

function readSubChunks(view: DataView, start: number, end: number): Chunk[] {
  const chunks: Chunk[] = [];
  let off = start;
  while (off + 8 <= end) {
    const chunk = readChunk(view, off);
    chunks.push(chunk);
    // Advance past chunk (pad to even boundary per RIFF spec)
    off += 8 + chunk.size;
    if (off & 1) off++;
  }
  return chunks;
}

// -- hydra record parsers ----------------------------------------------------

function parsePresetHeaders(view: DataView, offset: number, size: number): RawPresetHeader[] {
  const count = Math.floor(size / 38);
  const headers: RawPresetHeader[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * 38;
    headers.push({
      name: readZStr(view, o, 20),
      preset: view.getUint16(o + 20, true),
      bank: view.getUint16(o + 22, true),
      bagIndex: view.getUint16(o + 24, true),
      library: view.getUint32(o + 26, true),
      genre: view.getUint32(o + 30, true),
      morphology: view.getUint32(o + 34, true),
    });
  }
  return headers;
}

function parseBags(view: DataView, offset: number, size: number): RawBag[] {
  const count = Math.floor(size / 4);
  const bags: RawBag[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * 4;
    bags.push({
      genIndex: view.getUint16(o, true),
      modIndex: view.getUint16(o + 2, true),
    });
  }
  return bags;
}

function parseMods(view: DataView, offset: number, size: number): RawMod[] {
  const count = Math.floor(size / 10);
  const mods: RawMod[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * 10;
    mods.push({
      srcOper: view.getUint16(o, true),
      destOper: view.getUint16(o + 2, true),
      amount: view.getInt16(o + 4, true),
      amtSrcOper: view.getUint16(o + 6, true),
      transOper: view.getUint16(o + 8, true),
    });
  }
  return mods;
}

function parseGens(view: DataView, offset: number, size: number): RawGen[] {
  const count = Math.floor(size / 4);
  const gens: RawGen[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * 4;
    gens.push({
      oper: view.getUint16(o, true),
      amount: view.getInt16(o + 2, true), // signed by default
    });
  }
  return gens;
}

function parseInstHeaders(view: DataView, offset: number, size: number): RawInstHeader[] {
  const count = Math.floor(size / 22);
  const headers: RawInstHeader[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * 22;
    headers.push({
      name: readZStr(view, o, 20),
      bagIndex: view.getUint16(o + 20, true),
    });
  }
  return headers;
}

function parseSampleHeaders(view: DataView, offset: number, size: number): RawSampleHeader[] {
  const count = Math.floor(size / 46);
  const headers: RawSampleHeader[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * 46;
    headers.push({
      name: readZStr(view, o, 20),
      start: view.getUint32(o + 20, true),
      end: view.getUint32(o + 24, true),
      loopStart: view.getUint32(o + 28, true),
      loopEnd: view.getUint32(o + 32, true),
      sampleRate: view.getUint32(o + 36, true),
      originalPitch: view.getUint8(o + 40),
      pitchCorrection: view.getInt8(o + 41),
      sampleLink: view.getUint16(o + 42, true),
      sampleType: view.getUint16(o + 44, true),
    });
  }
  return headers;
}

// -- Zone builder (shared between preset and instrument zone processing) -----

function buildZones(
  bags: RawBag[],
  gens: RawGen[],
  mods: RawMod[],
  startBag: number,
  endBag: number,
  terminalGen: SF2Gen, // SF2Gen.instrument for presets, SF2Gen.sampleID for instruments
): { zones: SF2Zone[]; globalZone?: SF2Zone } {
  const zones: SF2Zone[] = [];
  let globalZone: SF2Zone | undefined;

  for (let zoneIdx = startBag; zoneIdx < endBag; zoneIdx++) {
    const bag = bags[zoneIdx];
    const nextBag = bags[zoneIdx + 1];
    if (!bag || !nextBag) break;

    const genStart = bag.genIndex;
    const genEnd = nextBag.genIndex;
    const modStart = bag.modIndex;
    const modEnd = nextBag.modIndex;

    const zone: SF2Zone = {
      keyRangeLo: 0,
      keyRangeHi: 127,
      velRangeLo: 0,
      velRangeHi: 127,
      generators: new Map(),
      modulators: [],
    };

    // Parse generators
    for (let gi = genStart; gi < genEnd && gi < gens.length; gi++) {
      const gen = gens[gi];
      if (gen.oper === SF2Gen.keyRange) {
        zone.keyRangeLo = gen.amount & 0xFF;
        zone.keyRangeHi = (gen.amount >> 8) & 0xFF;
      } else if (gen.oper === SF2Gen.velRange) {
        zone.velRangeLo = gen.amount & 0xFF;
        zone.velRangeHi = (gen.amount >> 8) & 0xFF;
      }
      zone.generators.set(gen.oper as SF2Gen, gen.amount);
    }

    // Parse modulators
    for (let mi = modStart; mi < modEnd && mi < mods.length; mi++) {
      zone.modulators.push(mods[mi]);
    }

    // Determine if this is a global zone (first zone, no terminal generator)
    const isFirstZone = zoneIdx === startBag;
    const hasTerminal = zone.generators.has(terminalGen);

    if (isFirstZone && !hasTerminal) {
      globalZone = zone;
    } else if (hasTerminal) {
      zones.push(zone);
    }
    // Zones without terminal generator (non-global) are ignored per spec
  }

  return { zones, globalZone };
}

// -- Main parser -------------------------------------------------------------

export function parseSF2(buffer: ArrayBuffer): SF2File {
  const view = new DataView(buffer);

  // Top-level RIFF chunk
  const riff = readChunk(view, 0);
  if (riff.id !== 'RIFF' || riff.formType !== 'sfbk') {
    throw new Error('Not a SoundFont 2 file (expected RIFF/sfbk)');
  }

  const topEnd = 8 + riff.size;
  const topChunks = readSubChunks(view, riff.dataOffset, topEnd);

  let info: SF2Info = {
    version: { major: 2, minor: 1 },
    soundEngine: 'EMU8000',
    name: 'Unknown',
  };
  let sampleData = new Int16Array(0);
  let sampleDataFloat = new Float32Array(0);
  let rawPresetHeaders: RawPresetHeader[] = [];
  let rawPresetBags: RawBag[] = [];
  let rawPresetMods: RawMod[] = [];
  let rawPresetGens: RawGen[] = [];
  let rawInstHeaders: RawInstHeader[] = [];
  let rawInstBags: RawBag[] = [];
  let rawInstMods: RawMod[] = [];
  let rawInstGens: RawGen[] = [];
  let rawSampleHeaders: RawSampleHeader[] = [];

  for (const chunk of topChunks) {
    if (chunk.id === 'LIST') {
      const listSubs = readSubChunks(view, chunk.dataOffset, chunk.dataOffset - 4 + chunk.size);

      if (chunk.formType === 'INFO') {
        for (const sub of listSubs) {
          const d = sub.dataOffset;
          const s = sub.size;
          switch (sub.id) {
            case 'ifil':
              info.version = { major: view.getUint16(d, true), minor: view.getUint16(d + 2, true) };
              break;
            case 'isng': info.soundEngine = readZStr(view, d, s); break;
            case 'INAM': info.name = readZStr(view, d, s); break;
            case 'irom': info.rom = readZStr(view, d, s); break;
            case 'iver':
              info.romVersion = { major: view.getUint16(d, true), minor: view.getUint16(d + 2, true) };
              break;
            case 'ICRD': info.creationDate = readZStr(view, d, s); break;
            case 'IENG': info.engineers = readZStr(view, d, s); break;
            case 'IPRD': info.product = readZStr(view, d, s); break;
            case 'ICOP': info.copyright = readZStr(view, d, s); break;
            case 'ICMT': info.comments = readZStr(view, d, s); break;
            case 'ISFT': info.tools = readZStr(view, d, s); break;
            // Unknown INFO sub-chunks: gracefully ignored per spec
          }
        }
      } else if (chunk.formType === 'sdta') {
        for (const sub of listSubs) {
          if (sub.id === 'smpl') {
            const numSamples = Math.floor(sub.size / 2);
            sampleData = new Int16Array(numSamples);
            sampleDataFloat = new Float32Array(numSamples);
            for (let i = 0; i < numSamples; i++) {
              const val = view.getInt16(sub.dataOffset + i * 2, true);
              sampleData[i] = val;
              sampleDataFloat[i] = val / 32768;
            }
          }
          // sm24 sub-chunk: optional 24-bit extension, not required for basic playback
        }
      } else if (chunk.formType === 'pdta') {
        // STRICT ordering per spec: phdr, pbag, pmod, pgen, inst, ibag, imod, igen, shdr
        for (const sub of listSubs) {
          const d = sub.dataOffset;
          const s = sub.size;
          switch (sub.id) {
            case 'phdr': rawPresetHeaders = parsePresetHeaders(view, d, s); break;
            case 'pbag': rawPresetBags = parseBags(view, d, s); break;
            case 'pmod': rawPresetMods = parseMods(view, d, s); break;
            case 'pgen': rawPresetGens = parseGens(view, d, s); break;
            case 'inst': rawInstHeaders = parseInstHeaders(view, d, s); break;
            case 'ibag': rawInstBags = parseBags(view, d, s); break;
            case 'imod': rawInstMods = parseMods(view, d, s); break;
            case 'igen': rawInstGens = parseGens(view, d, s); break;
            case 'shdr': rawSampleHeaders = parseSampleHeaders(view, d, s); break;
          }
        }
      }
    }
  }

  // Build high-level preset structures
  const presets: SF2Preset[] = [];
  const termPresetIdx = rawPresetHeaders.length - 1; // last is terminal
  for (let pi = 0; pi < termPresetIdx; pi++) {
    const ph = rawPresetHeaders[pi];
    const nextPh = rawPresetHeaders[pi + 1];
    const { zones, globalZone } = buildZones(
      rawPresetBags, rawPresetGens, rawPresetMods,
      ph.bagIndex, nextPh.bagIndex,
      SF2Gen.instrument
    );
    presets.push({ name: ph.name, preset: ph.preset, bank: ph.bank, zones, globalZone });
  }

  // Build high-level instrument structures
  const instruments: SF2Instrument[] = [];
  const termInstIdx = rawInstHeaders.length - 1;
  for (let ii = 0; ii < termInstIdx; ii++) {
    const ih = rawInstHeaders[ii];
    const nextIh = rawInstHeaders[ii + 1];
    const { zones, globalZone } = buildZones(
      rawInstBags, rawInstGens, rawInstMods,
      ih.bagIndex, nextIh.bagIndex,
      SF2Gen.sampleID
    );
    instruments.push({ name: ih.name, zones, globalZone });
  }

  // Build sample headers (exclude terminal)
  const termSampleIdx = rawSampleHeaders.length - 1;
  const samples: SF2SampleHeader[] = [];
  for (let si = 0; si < termSampleIdx; si++) {
    const sh = rawSampleHeaders[si];
    let pitch = sh.originalPitch;
    if (pitch >= 128 && pitch !== 255) pitch = 60; // invalid → default
    if (pitch === 255) pitch = 60; // unpitched → default
    samples.push({
      name: sh.name,
      start: sh.start,
      end: sh.end,
      loopStart: sh.loopStart,
      loopEnd: sh.loopEnd,
      sampleRate: sh.sampleRate || 44100,
      originalPitch: pitch,
      pitchCorrection: sh.pitchCorrection,
      sampleLink: sh.sampleLink,
      sampleType: sh.sampleType,
    });
  }

  return {
    info,
    sampleData,
    sampleDataFloat,
    presets,
    instruments,
    samples,
    rawPresetHeaders,
    rawPresetBags,
    rawPresetMods,
    rawPresetGens,
    rawInstHeaders,
    rawInstBags,
    rawInstMods,
    rawInstGens,
    rawSampleHeaders,
  };
}
