"""Quality gate for final sprites: the checks size/alpha/palette alone miss.

    python3 art/check_sprites.py            # checks every PNG in art/final
    python3 art/check_sprites.py worker-walk.png

Fails on:
  - wrong native size or colors outside the palette
  - opaque "background" (dark pixels, ground green inside an ant)
  - walk strips whose body moves between frames (only legs may move)
  - walk strips drawn at a different scale than the static sprite
"""

import sys
from pathlib import Path

from PIL import Image

from gen_sprites import PAL

FINAL = Path(__file__).parent / "final"
COLORS = {rgba[:3] for i, rgba in PAL.items() if i}
DARK, GROUND = PAL[3][:3], PAL[5][:3]
SIZES = {"tiny": (16, 10), "icon": (16, 16), "walk": (192, 32), "static": (48, 32)}
MAX_BODY_JITTER = 0.04  # share of body pixels allowed to change between frames
MAX_SCALE_DIFF = 0.15  # walk frame bbox height vs static bbox height


def kind(name):
    if name == "tiny":
        return "tiny"
    if name.startswith("icon-"):
        return "icon"
    return "walk" if name.endswith("-walk") else "static"


def opaque(img):
    return [(x, y, img.getpixel((x, y))[:3]) for y in range(img.height) for x in range(img.width) if img.getpixel((x, y))[3] >= 128]


def bbox_h(img):
    b = img.getchannel("A").point(lambda a: 255 if a >= 128 else 0).getbbox()
    return (b[3] - b[1]) if b else 0


def check(path: Path) -> list[str]:
    name, errs = path.stem, []
    img = Image.open(path).convert("RGBA")
    k = kind(name)
    if img.size != SIZES[k]:
        errs.append(f"size {img.size}, expected {SIZES[k]}")
    px = opaque(img)
    bad = {c for _, _, c in px if c not in COLORS}
    if bad:
        errs.append(f"{len(bad)} colors outside the palette")
    dark = sum(c == DARK for _, _, c in px)
    if dark > 2:
        errs.append(f"{dark} dark pixels: only the eye may be dark (leftover background?)")
    if k in ("static", "walk", "tiny") and any(c == GROUND for _, _, c in px):
        errs.append("ground green inside an ant")

    if k == "walk":
        frames = [img.crop((i * 48, 0, i * 48 + 48, 32)) for i in range(4)]
        # Body = upper 60% of the canvas, where legs are not drawn.
        body = [f.crop((0, 0, 48, 19)) for f in frames]
        base = list(body[0].get_flattened_data())
        n = max(1, sum(p[3] >= 128 for p in base))
        for i, b in enumerate(body[1:], 2):
            moved = sum(p != q for p, q in zip(base, b.get_flattened_data())) / n
            if moved > MAX_BODY_JITTER:
                errs.append(f"frame {i}: {moved:.0%} of the body moved (legs only, please)")
        static = FINAL / f"{name.removesuffix('-walk')}.png"
        if static.exists():
            hs, hw = bbox_h(Image.open(static).convert("RGBA")), bbox_h(frames[0])
            if hs and abs(hw - hs) / hs > MAX_SCALE_DIFF:
                errs.append(f"scale: frame height {hw}px vs static {hs}px")
    return errs


def main():
    files = [FINAL / a for a in sys.argv[1:]] or sorted(p for p in FINAL.glob("*.png") if "@" not in p.name)
    failed = 0
    for f in files:
        errs = check(f)
        failed += bool(errs)
        print(f"{'FAIL' if errs else 'ok  '} {f.name}" + "".join(f"\n     - {e}" for e in errs))
    print(f"\n{len(files) - failed}/{len(files)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
