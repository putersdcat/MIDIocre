// build-custom-sf2.mjs — Build MidiocrePack.sf2: 10 curated presets from each of 5 SoundFonts (50 total)
// Usage: node scripts/build-custom-sf2.mjs

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Build lib first so we can import it
import { build } from 'esbuild';
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/midiocre.js',
  sourcemap: true,
  logLevel: 'silent',
});

const { parseSF2, mergeSF2 } = await import('../dist/midiocre.js');

const SF2_DIR = 'SoundFonts';
const OUT_FILE = join(SF2_DIR, 'MidiocrePack.sf2');

// ── Curated selections: 10 presets per source, chosen for variety ───────────
// Index = position in that file's preset array (from /api/sf2-catalog)
const selections = [
  {
    file: 'AWE32.sf2',
    label: 'AWE32 (General MIDI)',
    // Piano 1, E Piano 1, Vibraphone, Nylon Guitar, Acoustic Bass, Strings, Trumpet, Alto Sax, Flute, Drum Kit
    indices: [0, 4, 11, 24, 32, 48, 56, 65, 73, 128],
  },
  {
    file: 'ChoriumRevB.sf2',
    label: 'Chorium (revB)',
    // Brass, Pick Bass, Pan Flute, Trombone, Orchestra Hit, Choral Aahhs, Violin, French Horns, Synth Bass 1, Harp
    indices: [0, 1, 7, 11, 12, 13, 40, 105, 110, 167],
  },
  {
    file: 'General808.sf2',
    label: 'General808',
    // Rhodes, Organ, Accordion, Guitar, Distortion Guitar, Bass, Strings, Trumpet, Sax, 808 Drumkit
    indices: [0, 5, 7, 8, 9, 10, 13, 19, 21, 20],
  },
  {
    file: 'GM SFX Bank.sf2',
    label: 'GM SFX Bank',
    // Harpsichord, Church Organ, Steel Guitar, Slap Bass 1, Cello, Timpani, Choir Aahs, Oboe, Warm Pad, Standard Drums
    indices: [6, 19, 25, 36, 42, 47, 52, 68, 89, 128],
  },
  {
    file: 'MIRACLE.sf2',
    label: 'MIRACLE',
    // Honky-Tonk, Celesta, Church Org, Jazz Gt, Pizz Strings, Synth Voice, Clarinet, Saw Wave, Fantasia, Stand. Drums
    indices: [2, 7, 18, 25, 41, 50, 62, 72, 79, 273],
  },
];

console.log('🔨 Building MidiocrePack.sf2...\n');

const entries = [];
let totalPresets = 0;

for (const sel of selections) {
  const path = join(SF2_DIR, sel.file);
  if (!existsSync(path)) {
    console.error(`❌ Source not found: ${path}`);
    process.exit(1);
  }

  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const sf2 = parseSF2(ab);

  // Validate indices
  const valid = sel.indices.filter(i => i < sf2.presets.length);
  if (valid.length !== sel.indices.length) {
    const bad = sel.indices.filter(i => i >= sf2.presets.length);
    console.warn(`⚠️  ${sel.file}: indices ${bad.join(',')} out of range (max ${sf2.presets.length - 1}), skipping those`);
  }

  console.log(`📁 ${sel.label} (${sel.file}): ${valid.length} presets`);
  for (const idx of valid) {
    const p = sf2.presets[idx];
    console.log(`   [${idx}] ${String(p.bank).padStart(3)}:${String(p.preset).padStart(3)} ${p.name}`);
  }

  entries.push({ source: sf2, presetIndices: valid });
  totalPresets += valid.length;
}

console.log(`\n📊 Total presets selected: ${totalPresets}`);
console.log('⚙️  Merging...');

const result = mergeSF2(entries, {
  name: 'MidiocrePack',
  engineers: 'Midiocre SF2 Builder',
  copyright: 'Assembled from public domain SoundFont samples',
  comments: `Curated collection of ${totalPresets} presets from 5 SoundFont sources — built by Midiocre`,
});

writeFileSync(OUT_FILE, Buffer.from(result));
const sizeMB = (result.byteLength / (1024 * 1024)).toFixed(2);

// Verify the output parses cleanly
const verifyBuf = readFileSync(OUT_FILE);
const verifyAB = verifyBuf.buffer.slice(verifyBuf.byteOffset, verifyBuf.byteOffset + verifyBuf.byteLength);
const verified = parseSF2(verifyAB);

console.log(`\n✅ MidiocrePack.sf2 written successfully!`);
console.log(`   📦 Size: ${sizeMB} MB`);
console.log(`   🎵 Presets: ${verified.presets.length}`);
console.log(`   🎸 Instruments: ${verified.instruments.length}`);
console.log(`   🔊 Samples: ${verified.samples.length}`);
console.log(`   📂 Path: ${OUT_FILE}`);
