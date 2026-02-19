// Midiocre — SF2 CLI utility (Node.js) for inspection, extraction, and repacking

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { parseSF2 } from '../sf2/SF2Parser.js';
import { buildSF2 } from '../sf2/SF2Builder.js';
import { SF2File, SF2Gen } from '../sf2/SF2Types.js';

// -- Helpers -----------------------------------------------------------------

function loadSF2File(path: string): SF2File {
  if (!existsSync(path)) {
    console.error(`Error: File not found: ${path}`);
    process.exit(1);
  }
  const data = readFileSync(path);
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return parseSF2(buffer);
}

function printJSON(obj: any): void {
  console.log(JSON.stringify(obj, null, 2));
}

// -- Commands ----------------------------------------------------------------

function cmdInfo(sf2: SF2File, json: boolean): void {
  const info = {
    name: sf2.info.name,
    version: `${sf2.info.version.major}.${sf2.info.version.minor}`,
    soundEngine: sf2.info.soundEngine,
    rom: sf2.info.rom,
    creationDate: sf2.info.creationDate,
    engineers: sf2.info.engineers,
    product: sf2.info.product,
    copyright: sf2.info.copyright,
    comments: sf2.info.comments,
    tools: sf2.info.tools,
    presetCount: sf2.presets.length,
    instrumentCount: sf2.instruments.length,
    sampleCount: sf2.samples.length,
    sampleDataPoints: sf2.sampleData.length,
  };

  if (json) {
    printJSON(info);
  } else {
    console.log(`\n  SoundFont Info: ${info.name}`);
    console.log(`  ${'─'.repeat(50)}`);
    console.log(`  Version:       ${info.version}`);
    console.log(`  Sound Engine:  ${info.soundEngine}`);
    if (info.rom) console.log(`  ROM:           ${info.rom}`);
    if (info.creationDate) console.log(`  Created:       ${info.creationDate}`);
    if (info.engineers) console.log(`  Engineers:     ${info.engineers}`);
    if (info.product) console.log(`  Product:       ${info.product}`);
    if (info.copyright) console.log(`  Copyright:     ${info.copyright}`);
    if (info.comments) console.log(`  Comments:      ${info.comments}`);
    if (info.tools) console.log(`  Tools:         ${info.tools}`);
    console.log(`  Presets:       ${info.presetCount}`);
    console.log(`  Instruments:   ${info.instrumentCount}`);
    console.log(`  Samples:       ${info.sampleCount}`);
    console.log(`  Sample Data:   ${(info.sampleDataPoints * 2 / 1024 / 1024).toFixed(2)} MB`);
    console.log('');
  }
}

function cmdListPresets(sf2: SF2File, json: boolean): void {
  const presets = sf2.presets.map((p, i) => ({
    index: i,
    bank: p.bank,
    preset: p.preset,
    name: p.name,
    zones: p.zones.length,
  }));

  if (json) {
    printJSON(presets);
  } else {
    console.log(`\n  Presets (${presets.length}):`);
    console.log(`  ${'─'.repeat(60)}`);
    console.log(`  ${'#'.padEnd(5)} ${'Bank'.padEnd(6)} ${'Prog'.padEnd(6)} ${'Zones'.padEnd(7)} Name`);
    for (const p of presets) {
      console.log(`  ${String(p.index).padEnd(5)} ${String(p.bank).padEnd(6)} ${String(p.preset).padEnd(6)} ${String(p.zones).padEnd(7)} ${p.name}`);
    }
    console.log('');
  }
}

function cmdListInstruments(sf2: SF2File, json: boolean): void {
  const instruments = sf2.instruments.map((inst, i) => ({
    index: i,
    name: inst.name,
    zones: inst.zones.length,
  }));

  if (json) {
    printJSON(instruments);
  } else {
    console.log(`\n  Instruments (${instruments.length}):`);
    console.log(`  ${'─'.repeat(50)}`);
    console.log(`  ${'#'.padEnd(5)} ${'Zones'.padEnd(7)} Name`);
    for (const inst of instruments) {
      console.log(`  ${String(inst.index).padEnd(5)} ${String(inst.zones).padEnd(7)} ${inst.name}`);
    }
    console.log('');
  }
}

function cmdListSamples(sf2: SF2File, json: boolean): void {
  const samples = sf2.samples.map((s, i) => ({
    index: i,
    name: s.name,
    sampleRate: s.sampleRate,
    originalPitch: s.originalPitch,
    length: s.end - s.start,
    loopStart: s.loopStart - s.start,
    loopEnd: s.loopEnd - s.start,
    type: s.sampleType,
  }));

  if (json) {
    printJSON(samples);
  } else {
    console.log(`\n  Samples (${samples.length}):`);
    console.log(`  ${'─'.repeat(70)}`);
    console.log(`  ${'#'.padEnd(5)} ${'Rate'.padEnd(7)} ${'Key'.padEnd(5)} ${'Len'.padEnd(8)} Name`);
    for (const s of samples) {
      console.log(`  ${String(s.index).padEnd(5)} ${String(s.sampleRate).padEnd(7)} ${String(s.originalPitch).padEnd(5)} ${String(s.length).padEnd(8)} ${s.name}`);
    }
    console.log('');
  }
}

function cmdShowMappings(sf2: SF2File, json: boolean): void {
  const mappings: any[] = [];

  for (let pi = 0; pi < sf2.presets.length; pi++) {
    const preset = sf2.presets[pi];
    const presetEntry: any = {
      presetIndex: pi,
      bank: preset.bank,
      program: preset.preset,
      name: preset.name,
      instruments: [] as any[],
    };

    for (const zone of preset.zones) {
      const instId = zone.generators.get(SF2Gen.instrument);
      if (instId === undefined) continue;

      const inst = sf2.instruments[instId];
      if (!inst) continue;

      const instEntry: any = {
        instrumentIndex: instId,
        name: inst.name,
        keyRange: `${zone.keyRangeLo}-${zone.keyRangeHi}`,
        velRange: `${zone.velRangeLo}-${zone.velRangeHi}`,
        samples: [] as any[],
      };

      for (const izone of inst.zones) {
        const sampleId = izone.generators.get(SF2Gen.sampleID);
        if (sampleId === undefined) continue;
        const sample = sf2.samples[sampleId];
        if (!sample) continue;

        instEntry.samples.push({
          sampleIndex: sampleId,
          name: sample.name,
          keyRange: `${izone.keyRangeLo}-${izone.keyRangeHi}`,
          velRange: `${izone.velRangeLo}-${izone.velRangeHi}`,
          sampleRate: sample.sampleRate,
          rootKey: sample.originalPitch,
        });
      }

      presetEntry.instruments.push(instEntry);
    }

    mappings.push(presetEntry);
  }

  if (json) {
    printJSON(mappings);
  } else {
    for (const m of mappings) {
      console.log(`\n  Preset [${m.presetIndex}] ${String(m.bank).padStart(3, '0')}:${String(m.program).padStart(3, '0')} "${m.name}"`);
      for (const inst of m.instruments) {
        console.log(`    └─ Instrument [${inst.instrumentIndex}] "${inst.name}" keys:${inst.keyRange} vel:${inst.velRange}`);
        for (const s of inst.samples) {
          console.log(`        └─ Sample [${s.sampleIndex}] "${s.name}" keys:${s.keyRange} vel:${s.velRange} root:${s.rootKey} rate:${s.sampleRate}`);
        }
      }
    }
    console.log('');
  }
}

function cmdValidate(sf2: SF2File): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for dangling instrument references
  for (let pi = 0; pi < sf2.presets.length; pi++) {
    const preset = sf2.presets[pi];
    for (const zone of preset.zones) {
      const instId = zone.generators.get(SF2Gen.instrument);
      if (instId !== undefined && instId >= sf2.instruments.length) {
        errors.push(`Preset [${pi}] "${preset.name}": dangling instrument ref ${instId}`);
      }
    }
  }

  // Check for dangling sample references
  for (let ii = 0; ii < sf2.instruments.length; ii++) {
    const inst = sf2.instruments[ii];
    for (const zone of inst.zones) {
      const sampleId = zone.generators.get(SF2Gen.sampleID);
      if (sampleId !== undefined && sampleId >= sf2.samples.length) {
        errors.push(`Instrument [${ii}] "${inst.name}": dangling sample ref ${sampleId}`);
      }
    }
  }

  // Check for orphaned instruments
  const referencedInsts = new Set<number>();
  for (const preset of sf2.presets) {
    for (const zone of preset.zones) {
      const instId = zone.generators.get(SF2Gen.instrument);
      if (instId !== undefined) referencedInsts.add(instId);
    }
  }
  for (let ii = 0; ii < sf2.instruments.length; ii++) {
    if (!referencedInsts.has(ii)) {
      warnings.push(`Instrument [${ii}] "${sf2.instruments[ii].name}" is orphaned (not referenced by any preset)`);
    }
  }

  // Check for orphaned samples
  const referencedSamples = new Set<number>();
  for (const inst of sf2.instruments) {
    for (const zone of inst.zones) {
      const sampleId = zone.generators.get(SF2Gen.sampleID);
      if (sampleId !== undefined) referencedSamples.add(sampleId);
    }
  }
  for (let si = 0; si < sf2.samples.length; si++) {
    if (!referencedSamples.has(si)) {
      warnings.push(`Sample [${si}] "${sf2.samples[si].name}" is orphaned (not referenced by any instrument)`);
    }
  }

  // Check sample bounds
  for (let si = 0; si < sf2.samples.length; si++) {
    const s = sf2.samples[si];
    if (s.end > sf2.sampleData.length) {
      errors.push(`Sample [${si}] "${s.name}": end (${s.end}) exceeds sample data length (${sf2.sampleData.length})`);
    }
    if (s.loopEnd > s.end) {
      warnings.push(`Sample [${si}] "${s.name}": loopEnd (${s.loopEnd}) > end (${s.end})`);
    }
  }

  console.log(`\n  Validation Results:`);
  console.log(`  ${'─'.repeat(50)}`);
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`  ✓ No issues found.`);
  } else {
    for (const e of errors) console.log(`  ✗ ERROR: ${e}`);
    for (const w of warnings) console.log(`  ⚠ WARNING: ${w}`);
    console.log(`  ${errors.length} error(s), ${warnings.length} warning(s)`);
  }
  console.log('');
}

function cmdExtract(sf2: SF2File, args: string[]): void {
  // Parse selection flags
  const presets: number[] = [];
  const instruments: number[] = [];
  const samples: number[] = [];
  let outputPath = 'output.sf2';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--preset': case '-p':
        presets.push(Number(args[++i]));
        break;
      case '--instrument': case '-i':
        instruments.push(Number(args[++i]));
        break;
      case '--sample': case '-s':
        samples.push(Number(args[++i]));
        break;
      case '--output': case '-o':
        outputPath = args[++i];
        break;
    }
  }

  const options: any = {};
  if (presets.length > 0) options.presetIndices = presets;
  if (instruments.length > 0) options.instrumentIndices = instruments;
  if (samples.length > 0) options.sampleIndices = samples;

  const result = buildSF2(sf2, options);
  const outBuf = Buffer.from(result);
  writeFileSync(outputPath, outBuf);
  console.log(`\n  Extracted SF2 written to: ${resolve(outputPath)}`);
  console.log(`  Size: ${(outBuf.length / 1024).toFixed(1)} KB\n`);
}

function cmdRepack(sf2: SF2File, outputPath: string): void {
  // Full repack — rebuild everything (useful for cleaning/normalizing)
  const result = buildSF2(sf2);
  const outBuf = Buffer.from(result);
  writeFileSync(outputPath, outBuf);
  console.log(`\n  Repacked SF2 written to: ${resolve(outputPath)}`);
  console.log(`  Size: ${(outBuf.length / 1024 / 1024).toFixed(2)} MB\n`);
}

// -- CLI argument parsing ----------------------------------------------------

function printUsage(): void {
  console.log(`
  Midiocre SF2 CLI — SoundFont 2 Inspection & Manipulation Tool
  ${'═'.repeat(55)}

  Usage: sf2cli <command> <sf2-file> [options]

  Commands:
    info          Show INFO metadata
    presets       List all presets
    instruments   List all instruments
    samples       List all samples
    mappings      Show preset → instrument → sample relationships
    validate      Check structural integrity & dangling references
    extract       Extract selected components to a new SF2 file
    repack        Clean repack of entire SF2 file

  Options:
    --json        Output in JSON format
    --output, -o  Output file path (for extract/repack)
    --preset, -p  Preset index to extract (repeatable)
    --instrument, -i  Instrument index to extract (repeatable)
    --sample, -s  Sample index to extract (repeatable)

  Examples:
    sf2cli info MySoundFont.sf2
    sf2cli presets MySoundFont.sf2 --json
    sf2cli mappings MySoundFont.sf2
    sf2cli validate MySoundFont.sf2
    sf2cli extract MySoundFont.sf2 -p 0 -p 1 -o subset.sf2
    sf2cli repack MySoundFont.sf2 -o clean.sf2
`);
}

// -- Main entry point --------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const command = args[0];
  const filePath = args[1];
  const json = args.includes('--json');
  const remainingArgs = args.slice(2).filter(a => a !== '--json');

  let sf2: SF2File;
  try {
    sf2 = loadSF2File(filePath);
  } catch (e: any) {
    console.error(`\n  Error parsing SF2: ${e.message}\n`);
    process.exit(1);
    return;
  }

  switch (command) {
    case 'info':
      cmdInfo(sf2, json);
      break;
    case 'presets':
      cmdListPresets(sf2, json);
      break;
    case 'instruments':
      cmdListInstruments(sf2, json);
      break;
    case 'samples':
      cmdListSamples(sf2, json);
      break;
    case 'mappings':
      cmdShowMappings(sf2, json);
      break;
    case 'validate':
      cmdValidate(sf2);
      break;
    case 'extract':
      cmdExtract(sf2, remainingArgs);
      break;
    case 'repack': {
      let output = 'repacked.sf2';
      const oi = remainingArgs.indexOf('-o');
      const oi2 = remainingArgs.indexOf('--output');
      if (oi >= 0) output = remainingArgs[oi + 1];
      else if (oi2 >= 0) output = remainingArgs[oi2 + 1];
      cmdRepack(sf2, output);
      break;
    }
    default:
      console.error(`\n  Unknown command: ${command}\n`);
      printUsage();
      process.exit(1);
  }
}

main();
