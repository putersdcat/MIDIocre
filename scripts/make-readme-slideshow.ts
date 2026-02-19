#!/usr/bin/env node

/**
 * Create a uniform crop + animated GIF from Playwright screenshots.
 *
 * Usage:
 *   node scripts/make-readme-slideshow.ts [--src DIR] [--out DIR] [--width W] [--height H] [--gif FILE]
 *
 * Behavior:
 * - Scans `--src` (default: .playwright-mcp) for PNG/JPEG screenshots.
 * - If --width/--height omitted, computes target size = min(widths), min(heights)
 *   (i.e. center-crop every image to a common size)
 * - Writes cropped images to `--out` (default: assets/readme-screenshots)
 * - Writes an animated GIF (`--gif`, default: assets/readme-slideshow.gif)
 *
 * Dependencies: sharp (install with `npm install --save-dev sharp`)
 *
 * This script is intended for simple, reproducible README slideshow generation
 * and is safe to run locally before committing the generated assets.
 */

import { createRequire } from 'module';
import { promises as fs } from 'fs';
import { join, extname, dirname } from 'path';
import sharp from 'sharp';
import { readdir, stat } from 'fs/promises';
import { spawn } from 'child_process';

const require = createRequire(import.meta.url);

const DEFAULT_SRC = '.playwright-mcp';
const DEFAULT_OUT = 'assets/readme-screenshots';
const DEFAULT_GIF = 'assets/readme-slideshow.gif';

interface Args {
  src: string;
  out: string;
  width?: number;
  height?: number;
  gif: string;
  resizeWidth?: number;
  duration: number;
  trim: boolean;
  trimPadding: number;
  cycleThemes: boolean;
  repeat: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: any = {
    src: DEFAULT_SRC,
    out: DEFAULT_OUT,
    gif: DEFAULT_GIF,
    duration: 800,
    trim: false,
    trimPadding: 12,
    cycleThemes: false,
    repeat: 1,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      i++; // skip next

      switch (key) {
        case 'src':
          parsed.src = value;
          break;
        case 'out':
          parsed.out = value;
          break;
        case 'width':
          parsed.width = parseInt(value);
          break;
        case 'height':
          parsed.height = parseInt(value);
          break;
        case 'gif':
          parsed.gif = value;
          break;
        case 'resize-width':
          parsed.resizeWidth = parseInt(value);
          break;
        case 'duration':
          parsed.duration = parseInt(value);
          break;
        case 'trim-padding':
          parsed.trimPadding = parseInt(value);
          break;
        case 'repeat':
          parsed.repeat = parseInt(value);
          break;
        case 'trim':
          parsed.trim = true;
          i--; // no value
          break;
        case 'cycle-themes':
          parsed.cycleThemes = true;
          i--; // no value
          break;
      }
    }
  }

  return parsed as Args;
}

async function findImages(src: string): Promise<string[]> {
  const exts = ['.png', '.jpg', '.jpeg', '.webp'];
  const files = await readdir(src);
  const images: string[] = [];

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (exts.includes(ext)) {
      const fullPath = join(src, file);
      const stats = await stat(fullPath);
      if (stats.isFile()) {
        images.push(fullPath);
      }
    }
  }

  return images.sort();
}

async function getImageStats(imagePath: string): Promise<{ width: number; height: number; hue: number }> {
  const image = sharp(imagePath);
  const metadata = await image.metadata();

  // For hue calculation, we'll use a simpler approach - sample some pixels
  const { data, info } = await image
    .resize(100, 100, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let totalHue = 0;
  let pixelCount = 0;

  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Convert RGB to HSV and get hue
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let hue = 0;
    if (delta !== 0) {
      if (max === r) {
        hue = ((g - b) / delta) % 6;
      } else if (max === g) {
        hue = (b - r) / delta + 2;
      } else {
        hue = (r - g) / delta + 4;
      }
      hue *= 60;
      if (hue < 0) hue += 360;
    }

    totalHue += hue;
    pixelCount++;
  }

  const avgHue = pixelCount > 0 ? totalHue / pixelCount : 0;

  return {
    width: metadata.width!,
    height: metadata.height!,
    hue: avgHue,
  };
}

async function processImages(args: Args): Promise<void> {
  const { src, out, gif, trim, trimPadding, cycleThemes, repeat: repeatCount } = args;

  // Check if source exists
  try {
    await stat(src);
  } catch {
    console.error(`Source folder '${src}' not found.`);
    process.exit(2);
  }

  const images = await findImages(src);
  if (images.length === 0) {
    console.error(`No screenshot images found in '${src}'.`);
    process.exit(3);
  }

  // Get image stats
  const imageStats = await Promise.all(images.map(getImageStats));
  const widths = imageStats.map(s => s.width);
  const heights = imageStats.map(s => s.height);

  // Calculate target dimensions
  let targetWidth = args.width || Math.min(...widths);
  let targetHeight = args.height || Math.min(...heights);

  // Create output directory
  await fs.mkdir(out, { recursive: true });

  // Process each image
  const frameData: Array<{ buffer: Buffer; hue: number; path: string }> = [];

  for (let i = 0; i < images.length; i++) {
    const imagePath = images[i];
    const stats = imageStats[i];

    let processor = sharp(imagePath);

    // Trim if requested (simplified - just crop to content area)
    if (trim) {
      // For simplicity, we'll skip the complex trim logic and just center crop
      // In a full implementation, you'd need to detect content boundaries
    }

    // Center crop to target size
    processor = processor.resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: 'center',
    });

    // Optional resize to fixed width
    if (args.resizeWidth && targetWidth !== args.resizeWidth) {
      const newHeight = Math.round(targetHeight * (args.resizeWidth / targetWidth));
      processor = processor.resize(args.resizeWidth, newHeight);
      targetWidth = args.resizeWidth;
      targetHeight = newHeight;
    }

    const buffer = await processor.png().toBuffer();
    const outFile = join(out, `${i.toString().padStart(3, '0')}_${Date.now()}.png`);
    await fs.writeFile(outFile, buffer);

    frameData.push({
      buffer,
      hue: stats.hue,
      path: outFile,
    });

    console.log(`Saved cropped: ${outFile} (hue=${stats.hue.toFixed(1)})`);
  }

  // Sort by hue if cycling themes
  if (cycleThemes) {
    frameData.sort((a, b) => a.hue - b.hue);
  }

  // Repeat frames if requested
  const finalFrames = [];
  for (let i = 0; i < Math.max(1, repeatCount); i++) {
    finalFrames.push(...frameData.map(f => f.buffer));
  }

  // Create animated GIF
  if (finalFrames.length > 0) {
    await fs.mkdir(dirname(gif), { recursive: true });

    // Try to create animated GIF using gifsicle if available
    try {
      // Save frames as temporary files for gifsicle
      const tempDir = join(dirname(gif), 'temp_frames');
      await fs.mkdir(tempDir, { recursive: true });

      const frameFiles: string[] = [];
      for (let i = 0; i < finalFrames.length; i++) {
        const frameFile = join(tempDir, `frame_${i.toString().padStart(3, '0')}.png`);
        await fs.writeFile(frameFile, finalFrames[i]);
        frameFiles.push(frameFile);
      }

      // Try to use gifsicle to create animated GIF
      await new Promise<void>((resolve, reject) => {
        const gifsicle = spawn('gifsicle', [
          '--delay', args.duration.toString(),
          '--loop',
          '--optimize=3',
          ...frameFiles,
          '--output', gif
        ], { stdio: 'inherit' });

        gifsicle.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`gifsicle exited with code ${code}`));
          }
        });

        gifsicle.on('error', (err) => {
          reject(err);
        });
      });

      // Clean up temp files
      await Promise.all(frameFiles.map(f => fs.unlink(f)));
      await fs.rmdir(tempDir);

      console.log(`Created animated GIF with gifsicle: ${gif} (${finalFrames.length} frames)`);
    } catch (err) {
      // Fallback: create a static image with the first frame
      console.log('gifsicle not available, creating static preview image');
      await fs.writeFile(gif.replace('.gif', '_preview.png'), finalFrames[0]);
      console.log(`Created static preview: ${gif.replace('.gif', '_preview.png')}`);
      console.log('To create animated GIF, install gifsicle: choco install gifsicle (Windows) or apt install gifsicle (Linux/Mac)');
    }
  }

  console.log('Done.');
}

async function main(): Promise<void> {
  const args = parseArgs();
  await processImages(args);
}

main().catch(console.error);