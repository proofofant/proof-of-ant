"""Install reviewed final sprites into the app as crisp SVGs.

    python3 art/install_sprites.py

Only sprites listed in ACCEPTED are installed; everything else keeps the
procedural placeholder already in app/public/sprites.
"""

from pathlib import Path

from PIL import Image

from gen_sprites import PAL, Canvas

ART = Path(__file__).parent
FINAL = ART / "final"
DEST = ART.parent / "app/public/sprites"

# Round 1 reviewed 2026-10-12; round 2 (walks rebuilt from the statics,
# outline wings, hand-gridded tiny and icons) accepted the same day.
ACCEPTED = {
    "ant-side": ["ant-side"],
    "worker": ["worker"],
    "soldier": ["soldier"],
    "queen": ["queen"],
    "carrying": ["carrying"],
    "digging": ["digging"],
    "winged": ["winged"],
    "tiny": ["ant-tiny"],
}
WALKS = ["worker", "soldier", "winged", "queen", "carrying"]
ICONS = ["mining-chip", "vault", "pheromone-chain", "cooling-fan", "power", "hashrate"]
ICONS_TS = ART.parent / "app/components/icons16.ts"

INDEX = {rgba[:3]: i for i, rgba in PAL.items() if i}
GROUND, DEEP, DARK = 5, 6, 3


def load(name: str) -> Canvas:
    img = Image.open(FINAL / f"{name}.png").convert("RGBA")
    cv = Canvas(img.width, img.height)
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = img.getpixel((x, y))
            if a < 128:
                continue
            c = INDEX.get((r, g, b), DEEP)
            # The cleaner snapped some deep-shade pixels to the ground green.
            cv.px[y][x] = DEEP if c == GROUND else c
    return cv


def png(cv: Canvas) -> Image.Image:
    img = Image.new("RGBA", (cv.w, cv.h))
    for y, row in enumerate(cv.px):
        for x, c in enumerate(row):
            if c:
                img.putpixel((x, y), PAL[c])
    return img


def icon_rows(cv: Canvas) -> list[str]:
    """'#' = bone (currentColor), '+' = shade (currentColor, dimmed)."""
    ch = {0: ".", 1: "#"}
    return ["".join(ch.get(c, "+") for c in row) for row in cv.px]


def rects(cells) -> str:
    """cells: {(x, y): palette index} → horizontal runs of <rect>."""
    out = []
    for y in sorted({y for _, y in cells}):
        xs = sorted(x for x, yy in cells if yy == y)
        i = 0
        while i < len(xs):
            x0, c = xs[i], cells[(xs[i], y)]
            j = i
            while j + 1 < len(xs) and xs[j + 1] == xs[j] + 1 and cells[(xs[j + 1], y)] == c:
                j += 1
            r, g, b, _ = PAL[c]
            out.append(f'<rect x="{x0}" y="{y}" width="{xs[j] - x0 + 1}" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>')
            i = j + 1
    return "".join(out)


# Idle loop for the landing hero, pure CSS so it works inside <img>.
# Steps keep every move on the pixel grid.
HERO_CSS = """
.body{animation:breathe 2.4s steps(1) infinite}
.tips{animation:twitch 3.7s steps(1) infinite}
.hash rect{opacity:0;animation:rise 2.1s steps(5) infinite}
.hash rect:nth-child(2){animation-delay:.7s}
.hash rect:nth-child(3){animation-delay:1.4s}
@keyframes breathe{0%,100%{transform:none}50%{transform:translateY(1px)}}
@keyframes twitch{0%,100%{transform:none}8%{transform:translateX(1px)}14%{transform:none}52%{transform:translateX(-1px)}58%,62%{transform:none}66%{transform:translateX(1px)}72%{transform:none}}
@keyframes rise{0%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0;transform:translateY(-5px)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.hash rect{opacity:0}}
"""


def hero_svg(cv: Canvas) -> str:
    """Split the side-view ant into legs (static), body (breathes) and antenna tips (twitch)."""
    legs, body, tips = {}, {}, {}
    for y, row in enumerate(cv.px):
        for x, c in enumerate(row):
            if not c:
                continue
            if (y >= 21 and x >= 18) or (y >= 23 and x >= 14):
                legs[(x, y)] = c
            elif y <= 11 and x >= 33:
                tips[(x, y)] = c
            else:
                body[(x, y)] = c
    g, gr, bl, _ = PAL[7]
    green = f"#{g:02x}{gr:02x}{bl:02x}"
    hashes = "".join(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{green}"/>' for x, y in [(39, 5), (42, 7), (36, 4)])
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {cv.w} {cv.h}" '
        f'width="{cv.w * 4}" height="{cv.h * 4}" shape-rendering="crispEdges">'
        f"<style>{HERO_CSS.strip()}</style>"
        f'<g class="legs">{rects(legs)}</g>'
        f'<g class="body">{rects(body)}<g class="tips">{rects(tips)}</g><g class="hash">{hashes}</g></g>'
        "</svg>"
    )


def main():
    (DEST / "ant-hero.svg").write_text(hero_svg(load("ant-side")))
    print("ant-side.png → app/public/sprites/ant-hero.svg (animated idle)")
    for src, targets in ACCEPTED.items():
        cv = load(src)
        for t in targets:
            (DEST / f"{t}.svg").write_text(cv.svg())
            print(f"{src}.png → app/public/sprites/{t}.svg")
    for w in WALKS:
        png(load(f"{w}-walk")).save(DEST / f"{w}-walk.png")
        print(f"{w}-walk.png → app/public/sprites/{w}-walk.png")
    lines = ["// Generated by art/install_sprites.py from art/final/icon-*.png. Do not edit.", "export const ICONS16: Record<string, string[]> = {"]
    for n in ICONS:
        rows = icon_rows(load(f"icon-{n}"))
        lines.append(f'  "{n}": [' + ", ".join(f'"{r}"' for r in rows) + "],")
    lines.append("};\n")
    ICONS_TS.write_text("\n".join(lines))
    print(f"{len(ICONS)} icons → app/components/icons16.ts")


if __name__ == "__main__":
    main()
