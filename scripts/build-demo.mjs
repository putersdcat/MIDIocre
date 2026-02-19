// Midiocre — Build demo (copy static assets + esbuild bundle)

import { buildSync } from 'esbuild';
import { mkdirSync, copyFileSync, existsSync, cpSync } from 'fs';
import { join } from 'path';

// Ensure output directory exists
const outDir = 'dist/demo';
mkdirSync(outDir, { recursive: true });

// Bundle demo TypeScript
buildSync({
  entryPoints: ['src/demo/demo.ts'],
  bundle: true,
  format: 'iife',
  outfile: join(outDir, 'demo.js'),
  sourcemap: true,
  minify: true,
});

// Copy static assets
const staticFiles = ['index.html', 'demo.css', 'demo-player.config.json'];
for (const file of staticFiles) {
  const src = join('src/demo', file);
  if (existsSync(src)) {
    copyFileSync(src, join(outDir, file));
  }
}

// Copy demo asset directories so the demo works on static hosting (SoundFonts + DemoMidiFiles)
// Only copy SoundFont files that the demo actually lists in src/demo/demo-player.config.json.
// This prevents accidentally packaging local, ignored .sf2 files into dist/demo during a local build.
const demoConfigPath = join('src', 'demo', 'demo-player.config.json');
let sf2FilesToCopy = [];
if (existsSync(demoConfigPath)) {
  try {
    const cfg = JSON.parse(require('fs').readFileSync(demoConfigPath, 'utf8'));
    sf2FilesToCopy = cfg.sf2Files ?? [];
  } catch (err) {
    // malformed config — fall back to copying nothing for SoundFonts
  }
}
const soundfontsSrcDir = join('.', 'SoundFonts');
const soundfontsDestDir = join(outDir, 'SoundFonts');
if (sf2FilesToCopy.length && existsSync(soundfontsSrcDir)) {
  // clear destination folder so leftover (local-only) .sf2 files aren't accidentally retained
  if (existsSync(soundfontsDestDir)) {
    const existing = require('fs').readdirSync(soundfontsDestDir);
    for (const fn of existing) {
      try { require('fs').unlinkSync(join(soundfontsDestDir, fn)); } catch (err) { /* ignore */ }
    }
  } else {
    mkdirSync(soundfontsDestDir, { recursive: true });
  }

  for (const f of sf2FilesToCopy) {
    const srcFile = join(soundfontsSrcDir, f);
    if (existsSync(srcFile)) copyFileSync(srcFile, join(soundfontsDestDir, f));
  }
}

// Copy DemoMidiFiles directory (whole directory)
const midiSrc = join('.', 'DemoMidiFiles');
const midiDest = join(outDir, 'DemoMidiFiles');
if (existsSync(midiSrc)) {
  try {
    cpSync(midiSrc, midiDest, { recursive: true });
  } catch (err) {
    const files = require('fs').readdirSync(midiSrc);
    for (const f of files) copyFileSync(join(midiSrc, f), join(midiDest, f));
  }
}

console.log('✓ Demo built to dist/demo/');
