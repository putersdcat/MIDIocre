// Midiocre — Dev server (esbuild watch + static file server + SF2 builder API)

import { context } from 'esbuild';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync, writeFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.sf2': 'application/octet-stream',
  '.map': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Build demo JS with watch
const ctx = await context({
  entryPoints: ['src/demo/demo.ts'],
  bundle: true,
  format: 'iife',
  outfile: 'dist/demo.js',
  sourcemap: true,
});

await ctx.watch();
console.log('👀 Watching src/ for changes...');

// Dynamically import the built library for server-side SF2 operations
let parseSF2, mergeSF2;
async function loadLib() {
  const lib = await import('../dist/midiocre.js');
  parseSF2 = lib.parseSF2;
  mergeSF2 = lib.mergeSF2;
}

// Build once so the lib is available, then load it
import { build } from 'esbuild';
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/midiocre.js',
  sourcemap: true,
});
await loadLib();
console.log('📦 Library loaded for server-side SF2 operations');

// -- API helpers -------------------------------------------------------------

function jsonResponse(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// -- Static file server + API ------------------------------------------------

const PORT = process.env.PORT || process.env.DEV_PORT || 3000; // allow overriding the dev port via env
const SF2_DIR = join('.', 'SoundFonts');

createServer(async (req, res) => {
  let url = req.url.split('?')[0];

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── API: List all SF2 files with their presets ────────────────────
  if (url === '/api/sf2-catalog' && req.method === 'GET') {
    try {
      const files = readdirSync(SF2_DIR).filter(f => f.toLowerCase().endsWith('.sf2'));
      const catalog = [];

      for (const filename of files) {
        try {
          const buf = readFileSync(join(SF2_DIR, filename));
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          const sf2 = parseSF2(ab);
          const presets = sf2.presets.map((p, i) => ({
            index: i,
            bank: p.bank,
            preset: p.preset,
            name: p.name,
            zones: p.zones.length,
          }));
          catalog.push({
            filename,
            name: sf2.info.name || filename,
            presetCount: presets.length,
            presets,
          });
        } catch (e) {
          catalog.push({ filename, name: filename, presetCount: 0, presets: [], error: e.message });
        }
      }

      jsonResponse(res, 200, { catalog });
    } catch (e) {
      jsonResponse(res, 500, { error: e.message });
    }
    return;
  }

  // ── API: Build a custom SF2 from selected presets ────────────────
  if (url === '/api/build-sf2' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)).toString('utf-8'));
      // body: { name: string, filename: string, selections: [{ sf2File: string, presetIndices: number[] }] }

      if (!body.name || !body.filename || !body.selections?.length) {
        jsonResponse(res, 400, { error: 'Missing required fields: name, filename, selections' });
        return;
      }

      // Sanitize filename
      let outName = body.filename.replace(/[^a-zA-Z0-9_\- .]/g, '');
      if (!outName.toLowerCase().endsWith('.sf2')) outName += '.sf2';
      const outPath = join(SF2_DIR, outName);

      // Check if file already exists
      if (existsSync(outPath) && !body.overwrite) {
        jsonResponse(res, 409, { error: `File "${outName}" already exists. Set overwrite:true to replace.` });
        return;
      }

      // Parse each source SF2 and build merge entries
      const entries = [];
      let totalPresets = 0;

      for (const sel of body.selections) {
        const srcPath = join(SF2_DIR, sel.sf2File);
        if (!existsSync(srcPath)) {
          jsonResponse(res, 404, { error: `Source SF2 not found: ${sel.sf2File}` });
          return;
        }
        const buf = readFileSync(srcPath);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        const sf2 = parseSF2(ab);
        entries.push({ source: sf2, presetIndices: sel.presetIndices });
        totalPresets += sel.presetIndices.length;
      }

      // Merge and write
      const result = mergeSF2(entries, {
        name: body.name,
        engineers: body.engineers || undefined,
        comments: body.comments || `Custom SF2 built via Midiocre Web UI — ${totalPresets} presets from ${entries.length} sources`,
        copyright: body.copyright || undefined,
      });

      writeFileSync(outPath, Buffer.from(result));

      // Verify the output parses cleanly
      const verifyBuf = readFileSync(outPath);
      const verifyAB = verifyBuf.buffer.slice(verifyBuf.byteOffset, verifyBuf.byteOffset + verifyBuf.byteLength);
      const verified = parseSF2(verifyAB);

      jsonResponse(res, 200, {
        success: true,
        filename: outName,
        path: outPath,
        size: result.byteLength,
        presets: verified.presets.length,
        instruments: verified.instruments.length,
        samples: verified.samples.length,
      });
    } catch (e) {
      jsonResponse(res, 500, { error: e.message });
    }
    return;
  }

  // ── Static file serving ──────────────────────────────────────────
  // Redirect root → /src/demo/
  if (url === '/') {
    res.writeHead(302, { Location: '/src/demo/' });
    res.end();
    return;
  }

  const filePath = join('.', url);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    const indexPath = join(filePath, 'index.html');
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
      res.end(content);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(readFileSync(filePath));
}).listen(PORT);

console.log(`\n🎵 Midiocre Dev Server running at http://localhost:${PORT}\n`);
