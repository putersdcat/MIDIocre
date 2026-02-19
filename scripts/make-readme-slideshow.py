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
from PIL import Image, ImageChops
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


def detect_trim_bbox(img: Image.Image, threshold: int = 10) -> tuple | None:
    """Return a bounding box (left, upper, right, lower) of content by
    comparing the image to a solid background color sampled from the border.
    If nothing differs (all background), returns None.
    """
    rgb = img.convert('RGB')
    w, h = rgb.size

    # Sample border pixels (10px wide strip) and take median as background color
    samples = []
    strip = 10
    for x in range(0, w, max(1, w // 50)):
        for y in range(0, strip):
            samples.append(rgb.getpixel((x, y)))
            samples.append(rgb.getpixel((x, h - 1 - y)))
    for y in range(0, h, max(1, h // 50)):
        for x in range(0, strip):
            samples.append(rgb.getpixel((x, y)))
            samples.append(rgb.getpixel((w - 1 - x, y)))

    if not samples:
        bg = (0, 0, 0)
    else:
        # median per channel
        rs = sorted(s[0] for s in samples)
        gs = sorted(s[1] for s in samples)
        bs = sorted(s[2] for s in samples)
        mid = len(rs) // 2
        bg = (rs[mid], gs[mid], bs[mid])

    # build a background image and compute a difference mask
    bg_img = Image.new('RGB', (w, h), bg)
    diff = ImageChops.difference(rgb, bg_img).convert('L')

    # threshold the diff to create a binary mask and get bbox
    mask = diff.point(lambda p: 255 if p > threshold else 0)
    bbox = mask.getbbox()
    return bbox


def compute_avg_hue(img: Image.Image, sample_box: tuple | None = None) -> float:
    """Estimate the average hue (0..360) for the image or a sub-box.
    Used to loosely group / order frames by color theme.
    """
    im = img.convert('RGB')
    if sample_box:
        im = im.crop(sample_box)
    # downscale for performance
    small = im.resize((100, 100))
    hsv = small.convert('HSV')
    data = list(hsv.getdata())
    if not data:
        return 0.0
    # H channel: 0..255 — convert to degrees
    hvals = [p[0] for p in data]
    avg = sum(hvals) / len(hvals)
    return (avg / 255.0) * 360.0


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('--src', type=Path, default=DEFAULT_SRC, help='Source folder with screenshots')
    p.add_argument('--out', type=Path, default=DEFAULT_OUT, help='Output folder for cropped images')
    p.add_argument('--width', type=int, help='Target crop width (optional)')
    p.add_argument('--height', type=int, help='Target crop height (optional)')
    p.add_argument('--gif', type=Path, default=DEFAULT_GIF, help='Output animated GIF path')
    p.add_argument('--resize-width', type=int, help='Resize final frames to this width while preserving aspect')
    p.add_argument('--duration', type=int, default=800, help='Frame duration in ms for the GIF')
    p.add_argument('--trim', action='store_true', help='Tight-trim images to content (removes dead space)')
    p.add_argument('--trim-padding', type=int, default=12, help='Padding (px) to add after trim bbox')
    p.add_argument('--cycle-themes', action='store_true', help='Order frames by predominant hue so GIF cycles color themes')
    p.add_argument('--repeat', type=int, default=1, help='Repeat frames sequence in GIF (useful with --cycle-themes)')
    args = p.parse_args(argv)

    src = args.src
    out = args.out
    gif_path = args.gif
    do_trim = args.trim
    trim_padding = args.trim_padding
    cycle_themes = args.cycle_themes
    repeat_count = max(1, args.repeat)


    if not src.exists() or not src.is_dir():
        print(f"Source folder '{src}' not found.")
        return 2

    images = find_images(src)
    if not images:
        print(f"No screenshot images found in '{src}'.")
        return 3

    # --- compute crop/trim box (optional) ---------------------------------
    widths = []
    heights = []
    bboxes = []  # per-image trim bbox (may be None)
    for ip in images:
        with Image.open(ip) as im:
            widths.append(im.width)
            heights.append(im.height)
            if do_trim:
                b = detect_trim_bbox(im)
                # default to full image when detect fails
                if not b:
                    b = (0, 0, im.width, im.height)
                bboxes.append(b)
            else:
                bboxes.append((0, 0, im.width, im.height))

    # union bbox across all frames (useful when trimming)
    if do_trim:
        lefts = [b[0] for b in bboxes]
        uppers = [b[1] for b in bboxes]
        rights = [b[2] for b in bboxes]
        lowers = [b[3] for b in bboxes]
        union = (
            max(0, min(lefts) - trim_padding),
            max(0, min(uppers) - trim_padding),
            max(rights) + trim_padding,
            max(lowers) + trim_padding,
        )
        # clamp union to smallest image size (assume consistent sizes)
        base_w, base_h = min(widths), min(heights)
        union = (union[0], union[1], min(union[2], base_w), min(union[3], base_h))
        target_w, target_h = (args.width or (union[2] - union[0]), args.height or (union[3] - union[1]))
    else:
        target_w, target_h = (args.width or min(widths), args.height or min(heights))
        union = None

    out.mkdir(parents=True, exist_ok=True)

    # --- crop/resize frames --------------------------------------------------
    frame_tuples = []  # (frame_image, avg_hue)
    for idx, ip in enumerate(images):
        with Image.open(ip) as im:
            if union:
                # ensure bbox fits current image (clamp if necessary)
                lw, up, rt, lo = union
                lw = max(0, min(lw, im.width - 1))
                up = max(0, min(up, im.height - 1))
                rt = max(lw + 1, min(rt, im.width))
                lo = max(up + 1, min(lo, im.height))
                frame = im.crop((lw, up, rt, lo))
                # if user asked for explicit width/height, center-crop that region
                if args.width or args.height:
                    frame = center_crop(frame, target_w, target_h)
            else:
                frame = center_crop(im, target_w, target_h)

            # optional resize to a fixed width
            if args.resize_width and frame.width != args.resize_width:
                new_h = int(frame.height * (args.resize_width / frame.width))
                frame = frame.resize((args.resize_width, new_h), Image.LANCZOS)

            out_file = out / ip.name
            frame.save(out_file)

            # compute theme hue (for ordering) and keep frame
            hue = compute_avg_hue(frame)
            frame_tuples.append((frame.copy(), hue))
            print(f"Saved cropped: {out_file} (hue={hue:.1f})")

    # --- optionally reorder frames by theme hue -------------------------------
    if cycle_themes:
        frame_tuples.sort(key=lambda x: x[1])
    else:
        # keep original order
        pass

    # flatten and repeat if requested
    frames = [ft[0].convert('P', palette=Image.ADAPTIVE) for ft in frame_tuples]
    if repeat_count > 1:
        frames = frames * repeat_count

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
