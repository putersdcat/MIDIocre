// Midiocre — SF2 builder (construct valid SF2 files from selected components)

import {
  SF2File, RawPresetHeader, RawInstHeader, RawBag, RawGen, RawMod, RawSampleHeader,
} from './SF2Types.js';

// -- Helper: write utilities --------------------------------------------------

function writeString(view: DataView, offset: number, str: string, len: number): void {
  for (let i = 0; i < len; i++) {
    view.setUint8(offset + i, i < str.length ? str.charCodeAt(i) : 0);
  }
}

function writeFourCC(view: DataView, offset: number, cc: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, cc.charCodeAt(i));
}

// RIFF chunks must be padded to even size
function padSize(size: number): number {
  return size + (size & 1);
}

// -- Sub-chunk writers -------------------------------------------------------

function writeInfoChunk(info: SF2File['info']): ArrayBuffer {
  // Calculate sub-chunk sizes
  const subChunks: { id: string; data: ArrayBuffer }[] = [];

  // ifil (required)
  const ifilBuf = new ArrayBuffer(4);
  const ifilView = new DataView(ifilBuf);
  ifilView.setUint16(0, info.version.major, true);
  ifilView.setUint16(2, info.version.minor, true);
  subChunks.push({ id: 'ifil', data: ifilBuf });

  // isng (required)
  const isng = info.soundEngine || 'EMU8000';
  const isngLen = isng.length + 1 + ((isng.length + 1) & 1); // pad to even
  const isngBuf = new ArrayBuffer(isngLen);
  const isngView = new DataView(isngBuf);
  writeString(isngView, 0, isng, isngLen);
  subChunks.push({ id: 'isng', data: isngBuf });

  // INAM (required)
  const inam = info.name || 'Midiocre Custom SF2';
  const inamLen = inam.length + 1 + ((inam.length + 1) & 1);
  const inamBuf = new ArrayBuffer(inamLen);
  writeString(new DataView(inamBuf), 0, inam, inamLen);
  subChunks.push({ id: 'INAM', data: inamBuf });

  // Optional info chunks
  const optionals: [string, string | undefined][] = [
    ['ICRD', info.creationDate], ['IENG', info.engineers],
    ['IPRD', info.product], ['ICOP', info.copyright],
    ['ICMT', info.comments],
    ['ISFT', info.tools || 'Midiocre SF2 Builder'],
  ];
  for (const [id, val] of optionals) {
    if (val) {
      const len = val.length + 1 + ((val.length + 1) & 1);
      const buf = new ArrayBuffer(len);
      writeString(new DataView(buf), 0, val, len);
      subChunks.push({ id, data: buf });
    }
  }

  // Calculate total size of LIST INFO
  let dataSize = 4; // 'INFO' fourCC
  for (const sc of subChunks) dataSize += 8 + padSize(sc.data.byteLength);

  const buf = new ArrayBuffer(8 + dataSize);
  const view = new DataView(buf);
  writeFourCC(view, 0, 'LIST');
  view.setUint32(4, dataSize, true);
  writeFourCC(view, 8, 'INFO');

  let off = 12;
  for (const sc of subChunks) {
    writeFourCC(view, off, sc.id);
    view.setUint32(off + 4, sc.data.byteLength, true);
    new Uint8Array(buf, off + 8, sc.data.byteLength).set(new Uint8Array(sc.data));
    off += 8 + padSize(sc.data.byteLength);
  }

  return buf;
}

function writeSdtaChunk(sampleData: Int16Array): ArrayBuffer {
  const smplSize = sampleData.length * 2;
  const dataSize = 4 + 8 + smplSize; // 'sdta' + smpl header + data
  const totalSize = 8 + dataSize;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  writeFourCC(view, 0, 'LIST');
  view.setUint32(4, dataSize, true);
  writeFourCC(view, 8, 'sdta');
  writeFourCC(view, 12, 'smpl');
  view.setUint32(16, smplSize, true);

  // Write sample data
  for (let i = 0; i < sampleData.length; i++) {
    view.setInt16(20 + i * 2, sampleData[i], true);
  }

  return buf;
}

function writePdtaChunk(
  presetHeaders: RawPresetHeader[],
  presetBags: RawBag[],
  presetMods: RawMod[],
  presetGens: RawGen[],
  instHeaders: RawInstHeader[],
  instBags: RawBag[],
  instMods: RawMod[],
  instGens: RawGen[],
  sampleHeaders: RawSampleHeader[],
): ArrayBuffer {
  // Calculate sub-chunk sizes
  const phdrSize = presetHeaders.length * 38;
  const pbagSize = presetBags.length * 4;
  const pmodSize = presetMods.length * 10;
  const pgenSize = presetGens.length * 4;
  const instSize = instHeaders.length * 22;
  const ibagSize = instBags.length * 4;
  const imodSize = instMods.length * 10;
  const igenSize = instGens.length * 4;
  const shdrSize = sampleHeaders.length * 46;

  const dataSize = 4 + // 'pdta'
    9 * 8 + // 9 sub-chunk headers
    phdrSize + pbagSize + pmodSize + pgenSize +
    instSize + ibagSize + imodSize + igenSize + shdrSize;

  const buf = new ArrayBuffer(8 + dataSize);
  const view = new DataView(buf);

  writeFourCC(view, 0, 'LIST');
  view.setUint32(4, dataSize, true);
  writeFourCC(view, 8, 'pdta');
  let off = 12;

  // phdr
  writeFourCC(view, off, 'phdr'); view.setUint32(off + 4, phdrSize, true); off += 8;
  for (const ph of presetHeaders) {
    writeString(view, off, ph.name, 20); off += 20;
    view.setUint16(off, ph.preset, true); off += 2;
    view.setUint16(off, ph.bank, true); off += 2;
    view.setUint16(off, ph.bagIndex, true); off += 2;
    view.setUint32(off, ph.library, true); off += 4;
    view.setUint32(off, ph.genre, true); off += 4;
    view.setUint32(off, ph.morphology, true); off += 4;
  }

  // pbag
  writeFourCC(view, off, 'pbag'); view.setUint32(off + 4, pbagSize, true); off += 8;
  for (const b of presetBags) {
    view.setUint16(off, b.genIndex, true); off += 2;
    view.setUint16(off, b.modIndex, true); off += 2;
  }

  // pmod
  writeFourCC(view, off, 'pmod'); view.setUint32(off + 4, pmodSize, true); off += 8;
  for (const m of presetMods) {
    view.setUint16(off, m.srcOper, true); off += 2;
    view.setUint16(off, m.destOper, true); off += 2;
    view.setInt16(off, m.amount, true); off += 2;
    view.setUint16(off, m.amtSrcOper, true); off += 2;
    view.setUint16(off, m.transOper, true); off += 2;
  }

  // pgen
  writeFourCC(view, off, 'pgen'); view.setUint32(off + 4, pgenSize, true); off += 8;
  for (const g of presetGens) {
    view.setUint16(off, g.oper, true); off += 2;
    view.setInt16(off, g.amount, true); off += 2;
  }

  // inst
  writeFourCC(view, off, 'inst'); view.setUint32(off + 4, instSize, true); off += 8;
  for (const ih of instHeaders) {
    writeString(view, off, ih.name, 20); off += 20;
    view.setUint16(off, ih.bagIndex, true); off += 2;
  }

  // ibag
  writeFourCC(view, off, 'ibag'); view.setUint32(off + 4, ibagSize, true); off += 8;
  for (const b of instBags) {
    view.setUint16(off, b.genIndex, true); off += 2;
    view.setUint16(off, b.modIndex, true); off += 2;
  }

  // imod
  writeFourCC(view, off, 'imod'); view.setUint32(off + 4, imodSize, true); off += 8;
  for (const m of instMods) {
    view.setUint16(off, m.srcOper, true); off += 2;
    view.setUint16(off, m.destOper, true); off += 2;
    view.setInt16(off, m.amount, true); off += 2;
    view.setUint16(off, m.amtSrcOper, true); off += 2;
    view.setUint16(off, m.transOper, true); off += 2;
  }

  // igen
  writeFourCC(view, off, 'igen'); view.setUint32(off + 4, igenSize, true); off += 8;
  for (const g of instGens) {
    view.setUint16(off, g.oper, true); off += 2;
    view.setInt16(off, g.amount, true); off += 2;
  }

  // shdr
  writeFourCC(view, off, 'shdr'); view.setUint32(off + 4, shdrSize, true); off += 8;
  for (const sh of sampleHeaders) {
    writeString(view, off, sh.name, 20); off += 20;
    view.setUint32(off, sh.start, true); off += 4;
    view.setUint32(off, sh.end, true); off += 4;
    view.setUint32(off, sh.loopStart, true); off += 4;
    view.setUint32(off, sh.loopEnd, true); off += 4;
    view.setUint32(off, sh.sampleRate, true); off += 4;
    view.setUint8(off, sh.originalPitch); off += 1;
    view.setInt8(off, sh.pitchCorrection); off += 1;
    view.setUint16(off, sh.sampleLink, true); off += 2;
    view.setUint16(off, sh.sampleType, true); off += 2;
  }

  return buf;
}

// -- Extract + Repack --------------------------------------------------------

export interface ExtractOptions {
  presetIndices?: number[];
  instrumentIndices?: number[];
  sampleIndices?: number[];
}

/** Merge preset from a source SF2 file — returns { preset/instrument/sample data } */
export interface MergeEntry {
  source: SF2File;
  presetIndices: number[];
}

/**
 * Merge presets from multiple SF2 sources into a single valid SF2 buffer.
 * Handles sample data concatenation, index remapping, and deduplication.
 */
export function mergeSF2(entries: MergeEntry[], info?: Partial<SF2File['info']>): ArrayBuffer {
  // Accumulated output arrays
  const allPHdrs: RawPresetHeader[] = [];
  const allPBags: RawBag[] = [];
  const allPMods: RawMod[] = [];
  const allPGens: RawGen[] = [];
  const allIHdrs: RawInstHeader[] = [];
  const allIBags: RawBag[] = [];
  const allIMods: RawMod[] = [];
  const allIGens: RawGen[] = [];
  const allSHdrs: RawSampleHeader[] = [];
  const sampleChunks: Int16Array[] = [];
  let sampleOffset = 0; // running offset in the concatenated sample data

  for (const entry of entries) {
    const src = entry.source;
    const wantedPresets = new Set(entry.presetIndices);
    const wantedInstruments = new Set<number>();
    const wantedSamples = new Set<number>();

    // Resolve dependencies: presets → instruments → samples
    for (const pi of wantedPresets) {
      const preset = src.presets[pi];
      if (!preset) continue;
      if (preset.globalZone) {
        const gInst = preset.globalZone.generators.get(41);
        if (gInst !== undefined) wantedInstruments.add(gInst);
      }
      for (const zone of preset.zones) {
        const instId = zone.generators.get(41);
        if (instId !== undefined) wantedInstruments.add(instId);
      }
    }

    for (const ii of wantedInstruments) {
      const inst = src.instruments[ii];
      if (!inst) continue;
      if (inst.globalZone) {
        const gSmp = inst.globalZone.generators.get(53);
        if (gSmp !== undefined) wantedSamples.add(gSmp);
      }
      for (const zone of inst.zones) {
        const sampleId = zone.generators.get(53);
        if (sampleId !== undefined) wantedSamples.add(sampleId);
      }
    }

    // Build remap tables (local indices → global indices in merged file)
    const sampleRemap = new Map<number, number>();
    const instRemap = new Map<number, number>();

    // Samples: copy data and remap offsets
    const sortedSamples = [...wantedSamples].sort((a, b) => a - b);
    for (const si of sortedSamples) {
      const sh = src.samples[si];
      if (!sh) continue;
      const newIdx = allSHdrs.length;
      sampleRemap.set(si, newIdx);

      const len = sh.end - sh.start + 46; // include trailing zeros for loop
      const slice = new Int16Array(len);
      const endCopy = Math.min(sh.start + len, src.sampleData.length);
      for (let j = sh.start; j < endCopy; j++) {
        slice[j - sh.start] = src.sampleData[j];
      }
      sampleChunks.push(slice);

      const offset = sampleOffset - sh.start;
      allSHdrs.push({
        name: sh.name,
        start: sh.start + offset,
        end: sh.end + offset,
        loopStart: sh.loopStart + offset,
        loopEnd: sh.loopEnd + offset,
        sampleRate: sh.sampleRate,
        originalPitch: sh.originalPitch,
        pitchCorrection: sh.pitchCorrection,
        sampleLink: 0, // will fix linked samples if needed
        sampleType: sh.sampleType,
      });
      sampleOffset += len;
    }

    // Fix sample links (stereo pairs)
    for (const si of sortedSamples) {
      const sh = src.samples[si];
      if (!sh) continue;
      const newIdx = sampleRemap.get(si)!;
      if (sh.sampleLink !== 0 && sampleRemap.has(sh.sampleLink)) {
        allSHdrs[newIdx].sampleLink = sampleRemap.get(sh.sampleLink)!;
      }
    }

    // Instruments
    const sortedInsts = [...wantedInstruments].sort((a, b) => a - b);
    for (const ii of sortedInsts) {
      const inst = src.instruments[ii];
      if (!inst) continue;
      const newIdx = allIHdrs.length;
      instRemap.set(ii, newIdx);

      allIHdrs.push({ name: inst.name, bagIndex: allIBags.length });

      // Global zone
      if (inst.globalZone) {
        allIBags.push({ genIndex: allIGens.length, modIndex: allIMods.length });
        for (const [oper, amount] of inst.globalZone.generators) {
          if (oper === 53) {
            allIGens.push({ oper, amount: sampleRemap.get(amount) ?? 0 });
          } else {
            allIGens.push({ oper, amount });
          }
        }
        for (const mod of inst.globalZone.modulators) allIMods.push(mod);
      }

      // Regular zones
      for (const zone of inst.zones) {
        allIBags.push({ genIndex: allIGens.length, modIndex: allIMods.length });
        for (const [oper, amount] of zone.generators) {
          if (oper === 53) {
            allIGens.push({ oper, amount: sampleRemap.get(amount) ?? 0 });
          } else {
            allIGens.push({ oper, amount });
          }
        }
        for (const mod of zone.modulators) allIMods.push(mod);
      }
    }

    // Presets
    for (const pi of [...wantedPresets].sort((a, b) => a - b)) {
      const preset = src.presets[pi];
      if (!preset) continue;

      // Check for bank:program collision with already-added presets
      const key = `${preset.bank}:${preset.preset}`;
      const collision = allPHdrs.find(
        ph => ph.bank === preset.bank && ph.preset === preset.preset
      );
      const name = collision
        ? `${preset.name} (${src.info.name?.slice(0, 8) || 'src'})`
        : preset.name;
      const bank = collision ? preset.bank : preset.bank;
      const presetNum = collision
        ? preset.preset + 100 // remap colliding presets to higher numbers
        : preset.preset;

      allPHdrs.push({
        name,
        preset: presetNum,
        bank,
        bagIndex: allPBags.length,
        library: 0, genre: 0, morphology: 0,
      });

      // Global zone
      if (preset.globalZone) {
        allPBags.push({ genIndex: allPGens.length, modIndex: allPMods.length });
        for (const [oper, amount] of preset.globalZone.generators) {
          if (oper === 41) {
            allPGens.push({ oper, amount: instRemap.get(amount) ?? 0 });
          } else {
            allPGens.push({ oper, amount });
          }
        }
        for (const mod of preset.globalZone.modulators) allPMods.push(mod);
      }

      // Regular zones
      for (const zone of preset.zones) {
        allPBags.push({ genIndex: allPGens.length, modIndex: allPMods.length });
        for (const [oper, amount] of zone.generators) {
          if (oper === 41) {
            allPGens.push({ oper, amount: instRemap.get(amount) ?? 0 });
          } else {
            allPGens.push({ oper, amount });
          }
        }
        for (const mod of zone.modulators) allPMods.push(mod);
      }
    }
  }

  // Terminal records
  allSHdrs.push({
    name: 'EOS', start: 0, end: 0, loopStart: 0, loopEnd: 0,
    sampleRate: 0, originalPitch: 60, pitchCorrection: 0, sampleLink: 0, sampleType: 0,
  });
  allIHdrs.push({ name: 'EOI', bagIndex: allIBags.length });
  allIBags.push({ genIndex: allIGens.length, modIndex: allIMods.length });
  allIGens.push({ oper: 0, amount: 0 });
  allIMods.push({ srcOper: 0, destOper: 0, amount: 0, amtSrcOper: 0, transOper: 0 });
  allPHdrs.push({
    name: 'EOP', preset: 255, bank: 255, bagIndex: allPBags.length,
    library: 0, genre: 0, morphology: 0,
  });
  allPBags.push({ genIndex: allPGens.length, modIndex: allPMods.length });
  allPGens.push({ oper: 0, amount: 0 });
  allPMods.push({ srcOper: 0, destOper: 0, amount: 0, amtSrcOper: 0, transOper: 0 });

  // Concatenate sample data
  const totalSamples = sampleChunks.reduce((sum, c) => sum + c.length, 0);
  const mergedSampleData = new Int16Array(totalSamples);
  let writePos = 0;
  for (const chunk of sampleChunks) {
    mergedSampleData.set(chunk, writePos);
    writePos += chunk.length;
  }

  // Build info
  const mergedInfo: SF2File['info'] = {
    version: { major: 2, minor: 1 },
    soundEngine: 'EMU8000',
    name: info?.name ?? 'MidiocrePack',
    creationDate: info?.creationDate ?? new Date().toISOString().slice(0, 10),
    tools: info?.tools ?? 'Midiocre SF2 Builder',
    engineers: info?.engineers,
    product: info?.product,
    copyright: info?.copyright,
    comments: info?.comments ?? `Merged from ${entries.length} SF2 sources`,
  };

  // Assemble RIFF
  const infoChunk = writeInfoChunk(mergedInfo);
  const sdtaChunk = writeSdtaChunk(mergedSampleData);
  const pdtaChunk = writePdtaChunk(
    allPHdrs, allPBags, allPMods, allPGens,
    allIHdrs, allIBags, allIMods, allIGens, allSHdrs,
  );

  const totalDataSize = 4 + infoChunk.byteLength + sdtaChunk.byteLength + pdtaChunk.byteLength;
  const totalFileSize = 8 + totalDataSize;
  const result = new ArrayBuffer(totalFileSize);
  const rv = new DataView(result);

  writeFourCC(rv, 0, 'RIFF');
  rv.setUint32(4, totalDataSize, true);
  writeFourCC(rv, 8, 'sfbk');

  let wOff = 12;
  new Uint8Array(result, wOff, infoChunk.byteLength).set(new Uint8Array(infoChunk));
  wOff += infoChunk.byteLength;
  new Uint8Array(result, wOff, sdtaChunk.byteLength).set(new Uint8Array(sdtaChunk));
  wOff += sdtaChunk.byteLength;
  new Uint8Array(result, wOff, pdtaChunk.byteLength).set(new Uint8Array(pdtaChunk));

  return result;
}

/** Extract selected components from an SF2 and build a new valid SF2 buffer */
export function buildSF2(source: SF2File, options: ExtractOptions = {}): ArrayBuffer {
  // Determine which presets/instruments/samples to include
  const wantedPresets = new Set(options.presetIndices ?? source.presets.map((_, i) => i));
  const wantedInstruments = new Set(options.instrumentIndices ?? []);
  const wantedSamples = new Set(options.sampleIndices ?? []);

  // Resolve dependencies: presets → instruments → samples
  for (const pi of wantedPresets) {
    const preset = source.presets[pi];
    if (!preset) continue;
    for (const zone of preset.zones) {
      const instId = zone.generators.get(41); // SF2Gen.instrument
      if (instId !== undefined) wantedInstruments.add(instId);
    }
  }

  for (const ii of wantedInstruments) {
    const inst = source.instruments[ii];
    if (!inst) continue;
    for (const zone of inst.zones) {
      const sampleId = zone.generators.get(53); // SF2Gen.sampleID
      if (sampleId !== undefined) wantedSamples.add(sampleId);
    }
  }

  // If no explicit selection and no presets selected, include everything
  if (wantedSamples.size === 0 && wantedInstruments.size === 0 && wantedPresets.size === 0) {
    source.samples.forEach((_, i) => wantedSamples.add(i));
    source.instruments.forEach((_, i) => wantedInstruments.add(i));
    source.presets.forEach((_, i) => wantedPresets.add(i));
  }

  // Build remapping tables
  const sampleRemap = new Map<number, number>();
  const instRemap = new Map<number, number>();
  const presetRemap = new Map<number, number>();

  const sortedSamples = [...wantedSamples].sort((a, b) => a - b);
  sortedSamples.forEach((orig, idx) => sampleRemap.set(orig, idx));

  const sortedInsts = [...wantedInstruments].sort((a, b) => a - b);
  sortedInsts.forEach((orig, idx) => instRemap.set(orig, idx));

  const sortedPresets = [...wantedPresets].sort((a, b) => a - b);
  sortedPresets.forEach((orig, idx) => presetRemap.set(orig, idx));

  // Copy and remap sample data
  let totalSamplePoints = 0;
  const sampleSlices: { src: number; len: number; newStart: number }[] = [];
  for (const si of sortedSamples) {
    const sh = source.samples[si];
    if (!sh) continue;
    const len = sh.end - sh.start + 46; // include trailing zeros
    sampleSlices.push({ src: sh.start, len, newStart: totalSamplePoints });
    totalSamplePoints += len;
  }

  const newSampleData = new Int16Array(totalSamplePoints);
  for (const slice of sampleSlices) {
    const end = Math.min(slice.src + slice.len, source.sampleData.length);
    for (let i = slice.src; i < end; i++) {
      newSampleData[i - slice.src + slice.newStart] = source.sampleData[i];
    }
  }

  // Build new sample headers
  const newSampleHeaders: RawSampleHeader[] = [];
  for (let i = 0; i < sortedSamples.length; i++) {
    const origIdx = sortedSamples[i];
    const sh = source.samples[origIdx];
    const offset = sampleSlices[i].newStart - sh.start;
    newSampleHeaders.push({
      name: sh.name,
      start: sh.start + offset,
      end: sh.end + offset,
      loopStart: sh.loopStart + offset,
      loopEnd: sh.loopEnd + offset,
      sampleRate: sh.sampleRate,
      originalPitch: sh.originalPitch,
      pitchCorrection: sh.pitchCorrection,
      sampleLink: sampleRemap.get(sh.sampleLink) ?? 0,
      sampleType: sh.sampleType,
    });
  }
  // Terminal sample header
  newSampleHeaders.push({
    name: 'EOS', start: 0, end: 0, loopStart: 0, loopEnd: 0,
    sampleRate: 0, originalPitch: 60, pitchCorrection: 0, sampleLink: 0, sampleType: 0,
  });

  // Build new instrument data
  const newInstHeaders: RawInstHeader[] = [];
  const newInstBags: RawBag[] = [];
  const newInstGens: RawGen[] = [];
  const newInstMods: RawMod[] = [];

  for (const origIdx of sortedInsts) {
    const inst = source.instruments[origIdx];
    if (!inst) continue;
    newInstHeaders.push({ name: inst.name, bagIndex: newInstBags.length });

    // Global zone
    if (inst.globalZone) {
      newInstBags.push({ genIndex: newInstGens.length, modIndex: newInstMods.length });
      for (const [oper, amount] of inst.globalZone.generators) {
        newInstGens.push({ oper, amount });
      }
      for (const mod of inst.globalZone.modulators) {
        newInstMods.push(mod);
      }
    }

    // Regular zones
    for (const zone of inst.zones) {
      newInstBags.push({ genIndex: newInstGens.length, modIndex: newInstMods.length });
      for (const [oper, amount] of zone.generators) {
        if (oper === 53) { // sampleID
          newInstGens.push({ oper, amount: sampleRemap.get(amount) ?? 0 });
        } else {
          newInstGens.push({ oper, amount });
        }
      }
      for (const mod of zone.modulators) {
        newInstMods.push(mod);
      }
    }
  }
  // Terminal instrument
  newInstHeaders.push({ name: 'EOI', bagIndex: newInstBags.length });
  newInstBags.push({ genIndex: newInstGens.length, modIndex: newInstMods.length });
  newInstGens.push({ oper: 0, amount: 0 });
  newInstMods.push({ srcOper: 0, destOper: 0, amount: 0, amtSrcOper: 0, transOper: 0 });

  // Build new preset data
  const newPresetHeaders: RawPresetHeader[] = [];
  const newPresetBags: RawBag[] = [];
  const newPresetGens: RawGen[] = [];
  const newPresetMods: RawMod[] = [];

  for (const origIdx of sortedPresets) {
    const preset = source.presets[origIdx];
    if (!preset) continue;
    newPresetHeaders.push({
      name: preset.name,
      preset: preset.preset,
      bank: preset.bank,
      bagIndex: newPresetBags.length,
      library: 0, genre: 0, morphology: 0,
    });

    // Global zone
    if (preset.globalZone) {
      newPresetBags.push({ genIndex: newPresetGens.length, modIndex: newPresetMods.length });
      for (const [oper, amount] of preset.globalZone.generators) {
        newPresetGens.push({ oper, amount });
      }
      for (const mod of preset.globalZone.modulators) {
        newPresetMods.push(mod);
      }
    }

    // Regular zones
    for (const zone of preset.zones) {
      newPresetBags.push({ genIndex: newPresetGens.length, modIndex: newPresetMods.length });
      for (const [oper, amount] of zone.generators) {
        if (oper === 41) { // instrument
          newPresetGens.push({ oper, amount: instRemap.get(amount) ?? 0 });
        } else {
          newPresetGens.push({ oper, amount });
        }
      }
      for (const mod of zone.modulators) {
        newPresetMods.push(mod);
      }
    }
  }
  // Terminal preset
  newPresetHeaders.push({
    name: 'EOP', preset: 255, bank: 255, bagIndex: newPresetBags.length,
    library: 0, genre: 0, morphology: 0,
  });
  newPresetBags.push({ genIndex: newPresetGens.length, modIndex: newPresetMods.length });
  newPresetGens.push({ oper: 0, amount: 0 });
  newPresetMods.push({ srcOper: 0, destOper: 0, amount: 0, amtSrcOper: 0, transOper: 0 });

  // Assemble RIFF sfbk
  const infoChunk = writeInfoChunk(source.info);
  const sdtaChunk = writeSdtaChunk(newSampleData);
  const pdtaChunk = writePdtaChunk(
    newPresetHeaders, newPresetBags, newPresetMods, newPresetGens,
    newInstHeaders, newInstBags, newInstMods, newInstGens,
    newSampleHeaders,
  );

  const totalDataSize = 4 + infoChunk.byteLength + sdtaChunk.byteLength + pdtaChunk.byteLength;
  const totalFileSize = 8 + totalDataSize;
  const result = new ArrayBuffer(totalFileSize);
  const rv = new DataView(result);

  writeFourCC(rv, 0, 'RIFF');
  rv.setUint32(4, totalDataSize, true);
  writeFourCC(rv, 8, 'sfbk');

  let writeOff = 12;
  new Uint8Array(result, writeOff, infoChunk.byteLength).set(new Uint8Array(infoChunk));
  writeOff += infoChunk.byteLength;
  new Uint8Array(result, writeOff, sdtaChunk.byteLength).set(new Uint8Array(sdtaChunk));
  writeOff += sdtaChunk.byteLength;
  new Uint8Array(result, writeOff, pdtaChunk.byteLength).set(new Uint8Array(pdtaChunk));

  return result;
}
