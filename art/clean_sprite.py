"""Snap an AI-generated "pixel art" image onto a real pixel grid and palette.

    python3 art/clean_sprite.py in.png --size 48x32 -o art/final/worker.png [--scale 8]

1. If the background is opaque, the corner color is keyed out to transparent.
2. Every pixel is snapped to the nearest palette color.
3. The image is split into a WxH grid and each cell takes its most common color.
"""

import argparse
from collections import Counter
from pathlib import Path

from PIL import Image

from gen_sprites import PAL

COLORS = [(i, rgba[:3]) for i, rgba in PAL.items() if i != 0]


def nearest(rgb):
    return min(COLORS, key=lambda c: sum((a - b) ** 2 for a, b in zip(rgb, c[1])))[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--size", default="48x32", help="native WxH, e.g. 48x32 or 192x32")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--scale", type=int, default=1, help="also save an upscaled copy")
    ap.add_argument("--key-tolerance", type=int, default=40)
    args = ap.parse_args()

    w, h = map(int, args.size.lower().split("x"))
    img = Image.open(args.input).convert("RGBA")
    src = img.load()
    iw, ih = img.size

    corner = src[0, 0]
    key = corner[:3] if corner[3] > 200 else None

    def classify(px):
        r, g, b, a = px
        if a < 128:
            return 0
        if key and sum(abs(x - y) for x, y in zip((r, g, b), key)) < args.key_tolerance:
            return 0
        return nearest((r, g, b))

    out = Image.new("RGBA", (w, h))
    dst = out.load()
    for cy in range(h):
        for cx in range(w):
            x0, x1 = cx * iw // w, (cx + 1) * iw // w
            y0, y1 = cy * ih // h, (cy + 1) * ih // h
            # Sample the inner part of the cell to avoid bleeding from neighbors.
            mx, my = max(1, (x1 - x0) // 4), max(1, (y1 - y0) // 4)
            votes = Counter(
                classify(src[x, y])
                for y in range(y0 + my, max(y0 + my + 1, y1 - my))
                for x in range(x0 + mx, max(x0 + mx + 1, x1 - mx))
            )
            dst[cx, cy] = PAL[votes.most_common(1)[0][0]]

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    out.save(args.output)
    if args.scale > 1:
        p = Path(args.output)
        out.resize((w * args.scale, h * args.scale), Image.NEAREST).save(p.with_name(f"{p.stem}@{args.scale}x{p.suffix}"))
    print(f"{args.input} → {args.output} ({w}x{h})")


if __name__ == "__main__":
    main()
