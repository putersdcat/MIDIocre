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
const assetDirs = ['SoundFonts', 'DemoMidiFiles'];
for (const d of assetDirs) {
  const srcDir = join('.', d);
  const destDir = join(outDir, d);
  if (existsSync(srcDir)) {
    try {
      mkdirSync(destDir, { recursive: true });
      cpSync(srcDir, destDir, { recursive: true });
    } catch (err) {
      // Fallback (shallow copy) for environments without cpSync
      const files = require('fs').readdirSync(srcDir);
      for (const f of files) {
        copyFileSync(join(srcDir, f), join(destDir, f));
      }
    }
  }
}

console.log('✓ Demo built to dist/demo/');
