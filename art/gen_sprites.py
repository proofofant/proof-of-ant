"""Procedural pixel-art ants for Proof of Ant.

Every ant is built from parts (gaster, petiole, thorax, head, legs, antennae)
on a 48x32 grid facing right. Castes differ only by parameters, so walk
frames come for free.

    python3 art/gen_sprites.py      → art/out/{svg,png}/..., sheet.png, *.gif
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 48, 32
OUT = Path(__file__).parent / "out"

# Palette (index → RGBA). 0 is transparent.
PAL = {
    0: (0, 0, 0, 0),
    1: (237, 228, 200, 255),  # bone
    2: (168, 159, 128, 255),  # shade
    3: (14, 26, 20, 255),  # dark (eye, cuts)
    4: (242, 181, 68, 255),  # gold
    5: (62, 90, 71, 255),  # ground / dim green
    6: (110, 104, 86, 255),  # deep shade (far legs, dirt)
    7: (143, 227, 154, 255),  # accent green
}
BONE, SHADE, DARK, GOLD, GROUND, DEEP, GREEN = 1, 2, 3, 4, 5, 6, 7


class Canvas:
    def __init__(self, w=W, h=H):
        self.w, self.h = w, h
        self.px = [[0] * w for _ in range(h)]

    def set(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c

    def get(self, x, y):
        return self.px[y][x] if 0 <= x < self.w and 0 <= y < self.h else 0

    def ellipse(self, cx, cy, rx, ry, c, shade=None, stripes=0):
        """Filled ellipse; lower third in `shade`, optional vertical segment stripes."""
        for y in range(self.h):
            for x in range(self.w):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1:
                    col = c
                    if shade and dy > 0.35:
                        col = shade
                    if stripes and dx * dx + dy * dy < 0.8 and x % stripes == 0:
                        col = shade or c
                    self.px[y][x] = col

    def line(self, x0, y0, x1, y1, c):
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(steps + 1):
            t = i / steps
            self.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c)

    def poly(self, pts, c):
        for (a, b) in zip(pts, pts[1:]):
            self.line(*a, *b, c)

    def ground(self, y=H - 2, x0=2, x1=W - 2):
        for x in range(x0, x1, 2):
            if self.get(x, y) == 0:
                self.set(x, y, GROUND)

    # ── export ──
    def png(self, scale=1) -> Image.Image:
        img = Image.new("RGBA", (self.w, self.h))
        img.putdata([PAL[c] for row in self.px for c in row])
        return img.resize((self.w * scale, self.h * scale), Image.NEAREST)

    def svg(self) -> str:
        rects = []
        for y, row in enumerate(self.px):
            x = 0
            while x < self.w:
                c = row[x]
                if c == 0:
                    x += 1
                    continue
                x0 = x
                while x < self.w and row[x] == c:
                    x += 1
                r, g, b, _ = PAL[c]
                rects.append(
                    f'<rect x="{x0}" y="{y}" width="{x - x0}" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>'
                )
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
            f'width="{self.w * 4}" height="{self.h * 4}" shape-rendering="crispEdges">'
            + "".join(rects)
            + "</svg>"
        )


@dataclass
class Ant:
    gaster: tuple = (11, 17, 8, 6)  # cx, cy, rx, ry
    thorax: tuple = (26, 16.5, 4.5, 3)
    head: tuple = (34.5, 13.5, 4, 3.5)
    mandible: str = "small"  # small | big
    wings: bool = False
    crown: bool = False
    carry: bool = False
    dig: bool = False
    phase: int = 0  # walk frame 0..3
    ground: bool = True
    extra: list = field(default_factory=list)


def legs(cv: Canvas, ant: Ant, near: bool):
    """Three legs per side. Tripod gait: near F+B with far M, and vice versa."""
    tx, ty, trx, try_ = ant.thorax
    hips = [(tx + 2.5, ty + 1.5), (tx, ty + 2), (tx - 2.5, ty + 1.5)]
    # (knee dx, knee dy, foot dx) relative to the hip: knees bend up and out
    shapes = [(5, -1, 9), (1, -2, -3), (-5, -1, -10)]
    foot_y = H - 3
    color = BONE if near else DEEP
    for i, ((hx, hy), (kx, ky, fx)) in enumerate(zip(hips, shapes)):
        group_a = (i != 1) if near else (i == 1)
        swing = [0, 1, 0, -1][ant.phase % 4] * (1 if group_a else -1)
        lift = 1 if (ant.phase % 2 == 1 and ((ant.phase == 1) == group_a)) else 0
        off = 0 if near else 1.5  # far legs drawn slightly behind
        knee = (hx + kx + swing - off, hy + ky - lift)
        foot = (hx + fx + 2 * swing - off, foot_y - lift)
        cv.poly([(hx - off, hy), knee, foot], color)
        cv.set(*knee, SHADE if near else DEEP)


def draw_ant(ant: Ant) -> Canvas:
    cv = Canvas()
    gx, gy, grx, gry = ant.gaster
    tx, ty, trx, try_ = ant.thorax
    hx, hy, hrx, hry = ant.head

    if ant.wings:
        # Two veined wings sweeping back over the gaster.
        for (dx, dy, rx, ry, c) in [(-11, -8, 12, 3, DEEP), (-9, -5, 10, 2.5, SHADE)]:
            cx, cy = tx + dx, ty + dy
            for y in range(H):
                for x in range(W):
                    ex, ey = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                    d = ex * ex + ey * ey
                    if 0.62 <= d <= 1:
                        cv.set(x, y, c)
            # veins from the wing root
            cv.line(tx - 1, ty - 2, cx - rx * 0.6, cy, c)
            cv.line(tx - 1, ty - 2, cx - rx * 0.2, cy + ry * 0.5, c)

    legs(cv, ant, near=False)

    cv.ellipse(gx, gy, grx, gry, BONE, SHADE, stripes=3)
    # petiole: a small node connecting gaster and thorax
    px = (gx + grx + tx - trx) / 2
    cv.ellipse(px, (gy + ty) / 2 - 0.5, 1.6, 2, BONE, SHADE)
    cv.ellipse(tx, ty, trx, try_, BONE, SHADE)
    cv.ellipse(tx + trx * 0.6, ty - 1.2, trx * 0.6, try_ * 0.8, BONE)
    # neck
    cv.line(tx + trx - 0.5, ty - 1, hx - hrx + 0.5, hy, BONE)
    cv.ellipse(hx, hy, hrx, hry, BONE, SHADE)
    cv.set(hx + hrx * 0.35, hy - hry * 0.3, DARK)  # eye

    # mandibles
    mx, my = hx + hrx - 0.5, hy + hry * 0.4
    if ant.mandible == "big":
        cv.poly([(mx, my - 1), (mx + 3, my - 2), (mx + 5, my), (mx + 4, my + 1)], BONE)
        cv.poly([(mx, my + 1), (mx + 3, my + 2), (mx + 5, my + 3), (mx + 3, my + 3)], SHADE)
    else:
        cv.poly([(mx, my), (mx + 2, my + 1), (mx + 1, my + 2)], SHADE)

    # antennae: scape up, elbow, funiculus forward, club tip
    ax, ay = hx + 0.5, hy - hry + 0.5
    if ant.dig:
        cv.poly([(ax, ay), (ax + 3, ay - 4), (ax + 8, ay + 1), (ax + 9, ay + 3)], BONE)
        cv.poly([(ax - 1, ay), (ax + 1, ay - 5), (ax + 6, ay - 2)], SHADE)
    else:
        cv.poly([(ax - 1, ay - 1), (ax - 3, ay - 7)], SHADE)
        cv.poly([(ax - 3, ay - 7), (ax + 3, ay - 10)], SHADE)
        cv.poly([(ax, ay), (ax + 1, ay - 6), (ax + 6, ay - 7), (ax + 9, ay - 4)], BONE)
        cv.set(ax + 9, ay - 3, BONE)

    legs(cv, ant, near=True)

    if ant.crown:
        cx, cy = hx - 1, hy - hry - 2
        crown = ["#.#.#", "#####", "#####"]
        for y, r in enumerate(crown):
            for x, ch in enumerate(r):
                if ch == "#":
                    cv.set(cx - 2 + x, cy - 3 + y, GOLD)
        for sx, sy in [(-6, -3), (5, -5)]:
            cv.set(cx + sx, cy + sy, GOLD)

    if ant.carry:
        # A dithered crumb of food held over the head and thorax.
        for y in range(3, 15):
            for x in range(23, 38):
                dx, dy = (x + 0.5 - 30.5) / 7.5, (y + 0.5 - 9) / 5
                if dx * dx + dy * dy <= 1:
                    c = BONE if (x + y) % 2 == 0 else SHADE
                    if dy > 0.4:
                        c = SHADE if (x + y) % 2 == 0 else DEEP
                    cv.set(x, y, c)

    if ant.dig:
        # Dirt mound in front of the head and a few flying grains.
        for y in range(18, H - 1):
            for x in range(36, W):
                if y > 19 + abs(x - 43) * 1.1:
                    cv.set(x, y, DEEP if (x * 3 + y) % 4 else SHADE)
        for x, y in [(38, 13), (42, 10), (45, 14), (40, 8), (44, 6)]:
            cv.set(x, y, SHADE)

    if ant.ground:
        cv.ground()
    return cv


def tiny() -> Canvas:
    rows = [
        "...........#..#.",
        "............##..",
        ".####...##.###..",
        "######.#######+.",
        "######.###.##...",
        ".####.#.#.#.....",
        ".....#..#..#....",
        "....#...#...#...",
    ]
    cv = Canvas(16, 10)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == "#":
                cv.set(x, y + 1, BONE)
            elif ch == "+":
                cv.set(x, y + 1, SHADE)
    return cv


ANTS = {
    "ant-side": Ant(gaster=(11, 20, 8, 6), thorax=(26, 20, 5, 3.4), head=(35, 17, 4.5, 4)),
    "worker": Ant(gaster=(12, 21, 7, 5), thorax=(25.5, 20.5, 4.5, 3.2), head=(34, 17.5, 4.2, 3.8)),
    "soldier": Ant(gaster=(10, 21, 7.5, 5.5), thorax=(24, 20.5, 4.5, 3.4), head=(33.5, 16.5, 5.5, 5), mandible="big"),
    "winged": Ant(gaster=(12, 21, 7.5, 4.5), thorax=(25.5, 20, 5, 3.6), head=(34.5, 17.5, 4.2, 3.8), wings=True),
    "queen": Ant(gaster=(10, 20, 10, 7), thorax=(26.5, 19.5, 5.5, 4), head=(36, 16.5, 4.5, 4.2), crown=True),
    "carrying": Ant(gaster=(12, 22, 7, 5), thorax=(25.5, 21.5, 4.5, 3.2), head=(34, 18.5, 4.2, 3.8), carry=True),
    "digging": Ant(gaster=(11, 19, 7, 5), thorax=(24, 20.5, 4.5, 3.2), head=(32, 19, 4.2, 3.8), dig=True),
}
CASTES = ["worker", "soldier", "winged", "queen"]
LABELS = {
    "ant-side": "01.1 ANT (SIDE VIEW)",
    "ant-tiny": "01.2 ANT (TINY ICON)",
    "worker": "01.3 WORKER ANT",
    "soldier": "01.4 SOLDIER ANT",
    "winged": "01.5 WINGED ANT",
    "queen": "01.6 QUEEN ANT",
    "carrying": "01.7 CARRYING ANT",
    "digging": "01.8 DIGGING ANT",
}


def font(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def main():
    (OUT / "svg").mkdir(parents=True, exist_ok=True)
    (OUT / "png").mkdir(parents=True, exist_ok=True)

    sprites = {name: draw_ant(a) for name, a in ANTS.items()}
    sprites["ant-tiny"] = tiny()
    sprites["ant-hero"] = draw_ant(replace(ANTS["ant-side"], ground=False))
    for name, cv in sprites.items():
        (OUT / "svg" / f"{name}.svg").write_text(cv.svg())
        cv.png(1).save(OUT / "png" / f"{name}.png")
        cv.png(8).save(OUT / "png" / f"{name}@8x.png")

    # Walk cycles: 4-frame horizontal strips + animated GIF previews.
    gifs = []
    for name in CASTES + ["carrying"]:
        frames = [draw_ant(replace(ANTS[name], phase=p)) for p in range(4)]
        strip = Image.new("RGBA", (W * 4, H))
        for i, f in enumerate(frames):
            strip.paste(f.png(1), (i * W, 0))
        strip.save(OUT / "png" / f"{name}-walk.png")
        strip.resize((W * 4 * 8, H * 8), Image.NEAREST).save(OUT / "png" / f"{name}-walk@8x.png")
        gifs.append([f.png(6) for f in frames])

    bg = (12, 22, 17, 255)
    preview = []
    for p in range(4):
        frame = Image.new("RGBA", (W * 6 * len(gifs), H * 6), bg)
        for i, g in enumerate(gifs):
            frame.alpha_composite(g[p], (i * W * 6, 0))
        preview.append(frame.convert("P", palette=Image.ADAPTIVE))
    preview[0].save(OUT / "walk.gif", save_all=True, append_images=preview[1:], duration=140, loop=0)

    # Reference sheet in the style of the mockup.
    order = ["ant-side", "ant-tiny", "worker", "soldier", "winged", "queen", "carrying", "digging"]
    cell_w, cell_h, scale = 360, 250, 6
    sheet = Image.new("RGBA", (cell_w * 4 + 40, cell_h * 2 + 110), bg)
    d = ImageDraw.Draw(sheet)
    d.text((24, 24), "PROOF OF ANT  //  SPRITE SHEET v0.1 (procedural)", fill=PAL[BONE], font=font(22))
    d.text((24, 62), "01. ANT UNITS", fill=PAL[GREEN], font=font(16))
    for i, name in enumerate(order):
        cx, cy = 20 + (i % 4) * cell_w, 90 + (i // 4) * cell_h
        d.rectangle([cx, cy, cx + cell_w - 10, cy + cell_h - 10], outline=PAL[GROUND])
        cv = sprites[name]
        s = scale if name != "ant-tiny" else 8
        img = cv.png(s)
        sheet.alpha_composite(img, (cx + (cell_w - 10 - img.width) // 2, cy + 18 + (190 - img.height) // 2))
        d.text((cx + 12, cy + cell_h - 34), LABELS[name], fill=PAL[BONE], font=font(14))
    sheet.save(OUT / "sheet.png")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
