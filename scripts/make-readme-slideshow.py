"""Create a uniform crop + animated GIF from Playwright screenshots.

Usage:
  python scripts/make-readme-slideshow.py [--src DIR] [--out DIR] [--width W] [--height H] [--gif FILE]

Behavior:
- Scans `--src` (default: .playwright-mcp) for PNG/JPEG screenshots.
- If --width/--height omitted, computes target size = min(widths), min(heights)
  (i.e. center-crop every image to a common size)
- Writes cropped images to `--out` (default: assets/readme-screenshots)
- Writes an animated GIF (`--gif`, default: assets/readme-slideshow.gif)

Dependencies: Pillow (install with `pip install pillow`)

This script is intended for simple, reproducible README slideshow generation
and is safe to run locally before committing the generated assets.
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image
import argparse

DEFAULT_SRC = Path('.playwright-mcp')
DEFAULT_OUT = Path('assets/readme-screenshots')
DEFAULT_GIF = Path('assets/readme-slideshow.gif')


def find_images(src: Path):
    exts = ('.png', '.jpg', '.jpeg', '.webp')
    return sorted([p for p in src.iterdir() if p.suffix.lower() in exts and p.is_file()])


def center_crop(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    w, h = img.size
    if w == target_w and h == target_h:
        return img
    left = max(0, (w - target_w) // 2)
    top = max(0, (h - target_h) // 2)
    return img.crop((left, top, left + target_w, top + target_h))


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('--src', type=Path, default=DEFAULT_SRC, help='Source folder with screenshots')
    p.add_argument('--out', type=Path, default=DEFAULT_OUT, help='Output folder for cropped images')
    p.add_argument('--width', type=int, help='Target crop width (optional)')
    p.add_argument('--height', type=int, help='Target crop height (optional)')
    p.add_argument('--gif', type=Path, default=DEFAULT_GIF, help='Output animated GIF path')
    p.add_argument('--resize-width', type=int, help='Resize final frames to this width while preserving aspect')
    p.add_argument('--duration', type=int, default=800, help='Frame duration in ms for the GIF')
    args = p.parse_args(argv)

    src = args.src
    out = args.out
    gif_path = args.gif

    if not src.exists() or not src.is_dir():
        print(f"Source folder '{src}' not found.")
        return 2

    images = find_images(src)
    if not images:
        print(f"No screenshot images found in '{src}'.")
        return 3

    # compute common target size
    widths = []
    heights = []
    for ip in images:
        with Image.open(ip) as im:
            widths.append(im.width)
            heights.append(im.height)
    if args.width and args.height:
        target_w, target_h = args.width, args.height
    else:
        target_w, target_h = min(widths), min(heights)

    out.mkdir(parents=True, exist_ok=True)

    frames = []
    for ip in images:
        with Image.open(ip) as im:
            frame = center_crop(im, target_w, target_h)
            # optional resize to a fixed width
            if args.resize_width and frame.width != args.resize_width:
                new_h = int(frame.height * (args.resize_width / frame.width))
                frame = frame.resize((args.resize_width, new_h), Image.LANCZOS)
            out_file = out / ip.name
            frame.save(out_file)
            frames.append(frame.convert('P', palette=Image.ADAPTIVE))
            print(f"Saved cropped: {out_file}")

    # write animated GIF
    if frames:
        first, *rest = frames
        gif_path.parent.mkdir(parents=True, exist_ok=True)
        first.save(
            gif_path,
            save_all=True,
            append_images=rest,
            duration=args.duration,
            loop=0,
            optimize=True,
            disposal=2,
        )
        print(f"Wrote GIF: {gif_path} ({len(frames)} frames)")
    else:
        print("No frames to write to GIF.")

    print("Done.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
