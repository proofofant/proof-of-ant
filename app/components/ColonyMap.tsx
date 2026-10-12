"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CASTES, CASTE_SHARES, explorer, fmtAgo, fmtHashrate, getProgram, hex, minerPda, short, type Miner } from "@/lib/chain";
import { useColony, type ColonyEvent } from "@/lib/colony";
import { useConnection, useSigner } from "@/lib/wallet";
import { Sprite, casteColor } from "./ui";

/**
 * Cross-section of the nest with every recent on-chain ant walking in it.
 * Galleries are horizontal and shafts vertical, so the 48x32 walk sprites
 * only ever turn by 90°, which keeps the pixels crisp. Click an ant to see it.
 */

const C = {
  dirt: "#13231a",
  dirtDot: "#1d3326",
  tunnel: "#0a130f",
  edge: "#2a4535",
  grass: "#5b7a62",
  bone: "#ece4c9",
  shade: "#a89f80",
  gold: "#f2b544",
  green: "#8fe39a",
  label: "#6e6856",
};

const SURFACE = 64;
const GALLERY = 32; // tunnel height above the floor
const SHAFT = 34;
const B = 3; // texture block size, matches the chunky look of the rest of the UI
const SPRITES = ["worker", "soldier", "winged", "queen", "carrying"] as const;

type Kind = "food" | "queen" | "nursery" | "store";
type Nest = {
  height: number;
  maxAnts: number;
  /** Floor depth per level; level 0 is the surface. */
  floors: number[];
  /** [left, right] as fractions of the width, per level. */
  spans: [number, number][];
  /** [x, from level, to level] */
  shafts: [number, number, number][];
  chambers: { x: number; level: number; w: number; kind: Kind; label: string }[];
};

const FULL: Nest = {
  height: 460,
  maxAnts: 36,
  floors: [SURFACE, 150, 245, 340, 430],
  spans: [[0.02, 0.98], [0.14, 0.86], [0.04, 0.66], [0.3, 0.97], [0.06, 0.94]],
  shafts: [[0.52, 0, 1], [0.2, 1, 2], [0.62, 1, 2], [0.4, 2, 3], [0.6, 2, 3], [0.1, 2, 4], [0.47, 3, 4], [0.9, 3, 4]],
  chambers: [
    { x: 0.16, level: 4, w: 190, kind: "food", label: "food vault" },
    { x: 0.8, level: 4, w: 200, kind: "queen", label: "queen chamber" },
    { x: 0.33, level: 1, w: 130, kind: "nursery", label: "nursery" },
    { x: 0.32, level: 2, w: 110, kind: "store", label: "" },
    { x: 0.74, level: 3, w: 120, kind: "store", label: "" },
  ],
};

/** Two-level nest for the overview page. */
const COMPACT: Nest = {
  height: 288,
  maxAnts: 24,
  floors: [SURFACE, 158, 250],
  spans: [[0.02, 0.98], [0.06, 0.94], [0.03, 0.97]],
  shafts: [[0.52, 0, 1], [0.24, 1, 2], [0.72, 1, 2]],
  chambers: [
    { x: 0.13, level: 2, w: 170, kind: "food", label: "food vault" },
    { x: 0.86, level: 2, w: 180, kind: "queen", label: "queen chamber" },
    { x: 0.38, level: 1, w: 120, kind: "nursery", label: "nursery" },
    { x: 0.5, level: 2, w: 100, kind: "store", label: "" },
  ],
};

// ── Organic geometry: nothing in the nest is a straight line ──
const snap = (v: number) => Math.round(v / B) * B;
const levelOf = (n: Nest, y: number) => n.floors.indexOf(y);
/** Wavy gallery floor; the surface (level 0) stays level with the grass. */
const floorY = (n: Nest, l: number, x: number) =>
  l === 0 ? ground(x) : n.floors[l] + 5 * Math.sin(x / 41 + l * 1.7) + 3 * Math.sin(x / 17 + l * 0.9);
/** Rolling ground line. */
const ground = (x: number) => SURFACE + snap(3 * Math.sin(x / 53) + 2 * Math.sin(x / 19 + 1));
/** Gallery height varies along the tunnel and pinches shut at the ends. */
function galleryH(l: number, x: number, x1: number, x2: number) {
  const h = GALLERY + 4 * Math.sin(x / 29 + l * 2.3) + 3 * Math.sin(x / 11 + l);
  const end = Math.min(x - x1, x2 - x);
  return end < 24 ? h * Math.sqrt(Math.max(0, end) / 24) : h;
}
/** Shafts meander sideways between their mouths (ya → yb), meeting the galleries at x0. */
function shaftX(x0: number, y: number, ya: number, yb: number) {
  const u = Math.min(1, Math.max(0, (y - ya) / (yb - ya)));
  return x0 + (7 * Math.sin(y / 27 + x0 * 0.13) + 3 * Math.sin(y / 9 + x0)) * Math.sin(Math.PI * u);
}
const shaftW = (x0: number, y: number) => SHAFT + 5 * Math.sin(y / 15 + x0);

type Node = { x: number; y: number; kind?: Kind };
type Walker = {
  id: string;
  ev: ColonyEvent | null; // null = the resident colony queen
  caste: number;
  carry: boolean;
  path: number[];
  seg: number;
  t: number;
  speed: number;
  dist: number;
  flash: number;
  box: [number, number, number, number];
};

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function layout(n: Nest, w: number) {
  const nodes: Node[] = [];
  const edges: [number, number][] = [];
  const at = new Map<string, number>();
  const node = (x: number, y: number, kind?: Kind) => {
    x = Math.round(x);
    const k = `${x},${y}`;
    if (!at.has(k)) {
      at.set(k, nodes.length);
      nodes.push({ x, y, kind });
    } else if (kind) nodes[at.get(k)!].kind = kind;
    return at.get(k)!;
  };
  // Stops on each level: gallery ends, shaft mouths, chamber centres.
  const stops = n.floors.map((y, l) => [node(n.spans[l][0] * w + 20, y), node(n.spans[l][1] * w - 20, y)]);
  for (const [x, a, b] of n.shafts) {
    stops[a].push(node(x * w, n.floors[a]));
    stops[b].push(node(x * w, n.floors[b]));
    edges.push([at.get(`${Math.round(x * w)},${n.floors[a]}`)!, at.get(`${Math.round(x * w)},${n.floors[b]}`)!]);
  }
  for (const c of n.chambers) stops[c.level].push(node(c.x * w, n.floors[c.level], c.kind));
  for (const s of stops) {
    const sorted = [...new Set(s)].sort((p, q) => nodes[p].x - nodes[q].x);
    for (let i = 1; i < sorted.length; i++) edges.push([sorted[i - 1], sorted[i]]);
  }
  const adj = nodes.map(() => [] as number[]);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return { nodes, edges, adj };
}

function bfs(adj: number[][], from: number, to: number) {
  const prev = new Map<number, number>([[from, -1]]);
  const q = [from];
  while (q.length) {
    const u = q.shift()!;
    if (u === to) break;
    for (const v of adj[u]) if (!prev.has(v)) { prev.set(v, u); q.push(v); }
  }
  const path: number[] = [];
  for (let u = to; u !== -1 && u !== undefined; u = prev.get(u)!) path.unshift(u);
  return path;
}

/** Leading zero bits of the first 8 bytes, and the work it represents. */
function hashWork(hash: number[]) {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(hash[i]);
  return v ? Number((1n << 64n) / v) : Infinity;
}

type Selection = { id: string } | null;

export function ColonyMap({ compact = false }: { compact?: boolean }) {
  const nest = compact ? COMPACT : FULL;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { events, colony, epoch, now } = useColony();
  const [sel, setSel] = useState<Selection>(null);
  const selRef = useRef<Selection>(null);
  selRef.current = sel;

  const hatched = useMemo(() => events.filter((e) => e.name === "AntHatched"), [events]);
  const recent = useMemo(() => hatched.slice(0, nest.maxAnts), [hatched, nest.maxAnts]);
  const syncRef = useRef<(list: ColonyEvent[]) => void>(() => {});

  useEffect(() => syncRef.current(recent), [recent]);

  useEffect(() => {
    const el = wrap.current!, cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const r = rng(11);
    const imgs = Object.fromEntries(
      SPRITES.map((s) => {
        const im = new Image();
        im.src = `/sprites/${s}-walk.png`;
        return [s, im];
      })
    ) as Record<(typeof SPRITES)[number], HTMLImageElement>;

    let w = 0;
    let g = layout(nest, 800);
    let dirt: HTMLCanvasElement | null = null;
    let ants: Walker[] = [];
    let known = new Set<string>();
    let first = true;
    const kindNode = (k: Kind) => g.nodes.findIndex((n) => n.kind === k);

    const randomStop = () => {
      const level = nest.floors[Math.floor(r() * nest.floors.length)];
      const onLevel = g.nodes.map((n, i) => (n.y === level ? i : -1)).filter((i) => i >= 0);
      return onLevel[Math.floor(r() * onLevel.length)];
    };
    const trip = (from: number) => {
      // Pick a level uniformly, then a stop on it, so ants spread over the whole nest
      // (picking a random node would favour the levels with the most stops).
      const roll = r();
      let to: number;
      if (roll < 0.08) to = kindNode("food");
      else if (roll < 0.14) to = kindNode("queen");
      else {
        const level = nest.floors[Math.floor(r() * nest.floors.length)];
        const onLevel = g.nodes.map((n, i) => (n.y === level ? i : -1)).filter((i) => i >= 0);
        to = onLevel[Math.floor(r() * onLevel.length)];
      }
      if (to === from) to = (to + 1) % g.nodes.length;
      return bfs(g.adj, from, to);
    };

    const makeAnt = (ev: ColonyEvent, from: number, flash: number): Walker => ({
      id: ev.id, ev, caste: ev.data.caste, carry: false,
      path: trip(from), seg: 0, t: r(), speed: 26 + r() * 22, dist: r() * 24, flash, box: [0, 0, 0, 0],
    });

    syncRef.current = (list) => {
      if (!w) return;
      const ids = new Set(list.map((e) => e.id));
      ants = ants.filter((a) => !a.ev || ids.has(a.id));
      for (const ev of [...list].reverse()) {
        if (known.has(ev.id)) continue;
        known.add(ev.id);
        // First load: scatter everyone. Later: hatch from the queen with a flash.
        const from = first ? randomStop() : kindNode("queen");
        ants.push(makeAnt(ev, from, first ? 0 : 1.5));
      }
      known = new Set([...known].filter((id) => ids.has(id)));
      first = false;
    };

    function build() {
      w = Math.max(360, el.clientWidth);
      cv.width = w;
      cv.height = nest.height;
      cv.style.width = `${w}px`;
      cv.style.height = `${nest.height}px`;
      g = layout(nest, w);

      dirt = document.createElement("canvas");
      dirt.width = w;
      dirt.height = nest.height;
      const d = dirt.getContext("2d")!;
      d.fillStyle = C.dirt;
      for (let x = 0; x < w; x += B) d.fillRect(x, ground(x), B, nest.height - ground(x));
      const rr = rng(3);
      d.fillStyle = C.dirtDot;
      for (let i = 0; i < (w * nest.height) / 160; i++)
        d.fillRect(Math.floor((rr() * w) / B) * B, SURFACE + 3 * B + Math.floor((rr() * (nest.height - SURFACE)) / B) * B, B, B);

      // Edge pass, then the tunnel pass on top, so every tunnel gets a lit rim.
      for (const [color, grow] of [[C.edge, B], [C.tunnel, 0]] as const) {
        d.fillStyle = color;
        // Galleries: carved column by column between a wavy floor and ceiling.
        for (let l = 1; l < nest.floors.length; l++) {
          const x1 = nest.spans[l][0] * w, x2 = nest.spans[l][1] * w;
          for (let x = snap(x1); x <= x2; x += B) {
            const h = galleryH(l, x, x1, x2);
            if (h <= 0) continue;
            const fl = floorY(nest, l, x) + 4;
            const top = snap(fl - h);
            d.fillRect(x - grow, top - grow, B + grow * 2, snap(fl) - top + grow * 2);
          }
        }
        // Shafts: carved row by row around a meandering centre line.
        for (const [x, a, b] of nest.shafts) {
          const x0 = Math.round(x * w);
          const ya = floorY(nest, a, x0), yb = floorY(nest, b, x0);
          const top = a === 0 ? ya - 6 : ya - GALLERY + 6;
          const bot = yb + 4;
          for (let y = snap(top) - grow; y <= bot + grow; y += B) {
            const cw = shaftW(x0, y);
            d.fillRect(snap(shaftX(x0, y, ya, yb) - cw / 2) - grow, y, snap(cw) + grow * 2, B);
          }
        }
        // Chambers: lumpy blobs resting on the gallery floor.
        nest.chambers.forEach((c, k) => {
          const cx = c.x * w, rx = c.w / 2 + grow, ry = 30 + grow;
          const cy = floorY(nest, c.level, cx) - 24;
          for (let y = snap(cy - ry - 6); y <= cy + ry; y += B)
            for (let x = snap(cx - rx * 1.2); x <= cx + rx * 1.2; x += B) {
              const dx = (x - cx) / rx, dy = (y - cy) / ry;
              const ang = Math.atan2(dy, dx);
              const rad = 1 + 0.13 * Math.sin(3 * ang + k * 1.9) + 0.07 * Math.sin(7 * ang + k);
              if (dx * dx + dy * dy <= rad * rad && y <= floorY(nest, c.level, x) + 4 + grow) d.fillRect(x, y, B, B);
            }
        });
      }
      // Chamber contents.
      for (const c of nest.chambers) {
        const cx = c.x * w, y = Math.round(floorY(nest, c.level, cx)) + 1;
        const pr = rng(c.x * 1000);
        if (c.kind === "food") {
          // A heap of crumbs: taller in the middle, ragged on top.
          const hx = cx - 20;
          for (let j = -18; j <= 18; j++) {
            const x = snap(hx + j * B);
            const h = Math.round(6 * (1 - (j / 18) ** 2) + pr() * 2);
            for (let k = 0; k < h; k++) {
              d.fillStyle = pr() < 0.3 ? C.gold : pr() < 0.6 ? C.shade : C.label;
              d.fillRect(x, snap(floorY(nest, c.level, x) + 3) - (k + 1) * B, B, B);
            }
          }
        }
        if (c.kind === "nursery" || c.kind === "queen") {
          // A small pile of eggs: 2x3-block ovals stacked 4 / 3 / 1.
          const ex = cx - (c.kind === "queen" ? 70 : 40);
          [[0, 0], [1, 0], [2, 0], [3, 0], [0.5, 1], [1.5, 1], [2.5, 1], [1.5, 2]].forEach(([i, row]) => {
            const x = snap(ex + i * 9 + (pr() - 0.5) * 3);
            const y0 = snap(floorY(nest, c.level, x) + 3) - (row + 1) * B * 2;
            d.fillStyle = C.bone;
            d.fillRect(x + B / 3, y0, B * 2, B * 2);
            d.fillStyle = C.shade;
            d.fillRect(x + B / 3, y0 + B, B, B);
          });
        }
        if (c.label) {
          d.fillStyle = C.label;
          d.font = "10px ui-monospace, monospace";
          d.textAlign = "center";
          d.fillText(c.label.toUpperCase().split("").join(" "), cx, y + 18);
        }
      }
      // Surface: grass and the entrance mound.
      d.fillStyle = C.grass;
      for (let x = 0; x < w; x += B) if (rr() < 0.6) d.fillRect(x, ground(x), B, B);
      for (let i = 0; i < w / 30; i++) {
        const x = snap(rr() * w), h = 1 + Math.floor(rr() * 3);
        d.fillRect(x, ground(x) - B * h, B, B * h);
        d.fillRect(x + B, ground(x) - B, B, B);
      }
      const ex = nest.shafts[0][0] * w;
      d.fillStyle = C.edge;
      for (let x = -14; x <= 14; x++) {
        const hh = Math.round(4 * (1 - (x / 14) ** 2)) * B;
        const gx = Math.round(ex + x * B);
        d.fillRect(gx, ground(gx) - hh, B, hh);
      }
      d.fillStyle = C.tunnel;
      for (let x = snap(ex - SHAFT / 2); x < ex + SHAFT / 2; x += B) d.fillRect(x, ground(x) - 6 - B * Math.round(2 * Math.sin((x - ex) / 9 + 1)), B, 12 + B * 2);

      // Re-seat existing ants on the new graph, and the resident queen.
      const q = kindNode("queen");
      ants = ants.filter((a) => a.ev).map((a) => ({ ...a, path: trip(randomStop()), seg: 0 }));
      ants.push({
        id: "queen", ev: null, caste: 3, carry: false, path: [q], seg: 0, t: 0, speed: 0, dist: 0, flash: 0, box: [0, 0, 0, 0],
      });
      if (first) syncRef.current(recent);
    }

    function draw(a: Walker, x: number, y: number, dir: 1 | -1, vertical: 0 | 1 | -1) {
      const img = imgs[a.carry ? "carrying" : SPRITES[a.caste]];
      const frame = a.speed === 0 ? 0 : Math.floor(a.dist / 6) % 4;
      ctx.save();
      if (vertical) {
        // Climbing (-1) faces up, descending (1) faces down; body centred in the shaft.
        ctx.translate(Math.round(x), Math.round(y - 16));
        ctx.rotate((vertical * Math.PI) / 2);
        if (img.complete) ctx.drawImage(img, frame * 48, 0, 48, 32, -24, -18, 48, 32);
        a.box = [x - 14, y - 40, x + 14, y + 8];
      } else {
        ctx.translate(Math.round(x), Math.round(y));
        if (dir < 0) ctx.scale(-1, 1);
        if (img.complete) ctx.drawImage(img, frame * 48, 0, 48, 32, -24, -28, 48, 32);
        a.box = [x - 22, y - 26, x + 22, y];
      }
      ctx.restore();
      if (a.flash > 0) {
        // Hatch flash: a square pheromone ring that expands and fades.
        const s = Math.round((1.5 - a.flash) * 24) + 18;
        ctx.strokeStyle = `rgba(143,227,154,${(a.flash / 1.5).toFixed(2)})`;
        ctx.lineWidth = B;
        ctx.strokeRect(Math.round(x - s), Math.round(y - 14 - s), s * 2, s * 2);
      }
      if (selRef.current?.id === a.id) {
        const [x1, y1, x2, y2] = a.box.map(Math.round);
        ctx.fillStyle = C.green;
        for (const [cx, cy, sx, sy] of [[x1, y1, 1, 1], [x2, y1, -1, 1], [x1, y2, 1, -1], [x2, y2, -1, -1]]) {
          ctx.fillRect(cx - (sx < 0 ? B : 0) - sx * 3, cy - (sy < 0 ? B : 0) - sy * 3, sx * 9, B);
          ctx.fillRect(cx - (sx < 0 ? B : 0) - sx * 3, cy - (sy < 0 ? B : 0) - sy * 3, B, sy * 9);
        }
      }
    }

    let raf = 0, last = performance.now();
    function frame(t: number) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      ctx.clearRect(0, 0, w, nest.height);
      if (dirt) ctx.drawImage(dirt, 0, 0);
      for (const a of ants) {
        if (a.flash > 0) a.flash = Math.max(0, a.flash - dt);
        if (a.path.length < 2 || a.speed === 0) {
          const n = g.nodes[a.path[0]];
          draw(a, n.x + 40, floorY(nest, levelOf(nest, n.y), n.x + 40), -1, 0);
          continue;
        }
        const A = g.nodes[a.path[a.seg]], Bn = g.nodes[a.path[a.seg + 1]];
        const len = Math.max(1, Math.hypot(Bn.x - A.x, Bn.y - A.y));
        if (selRef.current?.id !== a.id) {
          a.t += (a.speed * dt) / len;
          a.dist += a.speed * dt;
        }
        if (a.t >= 1) {
          a.t = 0;
          a.seg++;
          if (a.seg >= a.path.length - 1) {
            const end = a.path[a.path.length - 1];
            if (g.nodes[end].kind === "food") a.carry = true;
            if (g.nodes[end].kind === "queen") a.carry = false;
            a.path = trip(end);
            a.seg = 0;
          }
          continue;
        }
        if (A.x === Bn.x) {
          // Shaft: follow its meander between the two (wavy) floors.
          const ya = floorY(nest, levelOf(nest, A.y), A.x), yb = floorY(nest, levelOf(nest, Bn.y), A.x);
          const y = ya + (yb - ya) * a.t;
          draw(a, shaftX(A.x, y, Math.min(ya, yb), Math.max(ya, yb)), y, 1, Bn.y < A.y ? -1 : 1);
        } else {
          const x = A.x + (Bn.x - A.x) * a.t;
          draw(a, x, floorY(nest, levelOf(nest, A.y), x), Bn.x > A.x ? 1 : -1, 0);
        }
      }
    }

    const hit = (e: MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      for (let i = ants.length - 1; i >= 0; i--) {
        const [x1, y1, x2, y2] = ants[i].box;
        if (x >= x1 - 4 && x <= x2 + 4 && y >= y1 - 4 && y <= y2 + 4) return ants[i];
      }
      return null;
    };
    const onMove = (e: MouseEvent) => (cv.style.cursor = hit(e) ? "pointer" : "default");
    const onClick = (e: MouseEvent) => {
      const a = hit(e);
      setSel(a ? { id: a.id } : null);
    };
    cv.addEventListener("mousemove", onMove);
    cv.addEventListener("click", onClick);

    build();
    raf = requestAnimationFrame(frame);
    let lastW = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== lastW) {
        lastW = el.clientWidth;
        build();
      }
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("mousemove", onMove);
      cv.removeEventListener("click", onClick);
    };
    // The scene is built once per nest; new ants arrive through syncRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nest]);

  const selected = sel && sel.id !== "queen" ? hatched.find((e) => e.id === sel.id) ?? null : null;
  const serial = selected && colony ? colony.totalAnts.toNumber() - hatched.indexOf(selected) : null;

  return (
    <div ref={wrap} style={{ position: "relative", width: "100%", height: nest.height, overflow: "hidden" }}>
      <canvas ref={canvas} className="pixel" style={{ display: "block" }} />
      {recent.length === 0 && (
        <div className="dim" style={{ position: "absolute", left: 16, top: 14, fontSize: 11 }}>no ants yet: the first one hatches when someone mines</div>
      )}
      {sel?.id === "queen" && (
        <Card onClose={() => setSel(null)} sprite="queen" title="Colony queen" tag="resident" color="var(--gold)">
          <Row k="Total ants" v={colony?.totalAnts.toNumber().toLocaleString("en-US") ?? "—"} />
          <Row k="Epoch" v={colony ? String(colony.epoch.toNumber()).padStart(3, "0") : "—"} />
          <Row k="Hatched this epoch" v={epoch?.ants.toNumber().toLocaleString("en-US") ?? "—"} />
          <Row k="Pheromone tip" v={colony ? `${hex(colony.tip, 8)}…` : "—"} />
          <div className="dim" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
            She never leaves the chamber. Every new ant hatches here and is chained into her pheromone trail.
          </div>
        </Card>
      )}
      {selected && <AntCard ev={selected} serial={serial} now={now} onClose={() => setSel(null)} />}
    </div>
  );
}

function Card({ children, onClose, sprite, title, tag, color }: {
  children: React.ReactNode;
  onClose: () => void;
  sprite: (typeof CASTES)[number];
  title: string;
  tag: string;
  color: string;
}) {
  return (
    <div
      className="panel"
      style={{ position: "absolute", top: 12, right: 12, width: "min(320px, calc(100% - 24px))", padding: 14, background: "var(--panel)", boxShadow: "0 0 0 1px var(--line-2)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <Sprite name={sprite} scale={1} />
        <div style={{ flex: 1 }}>
          <div className="mid" style={{ letterSpacing: "0.08em" }}>{title}</div>
          <span className="tag" style={{ color, marginTop: 4 }}>{tag}</span>
        </div>
        <button className="btn btn-sm" onClick={onClose} aria-label="close">×</button>
      </div>
      <div className="kv" style={{ fontSize: 11 }}>{children}</div>
    </div>
  );
}

function Row({ k, v, href, cls }: { k: string; v: React.ReactNode; href?: string; cls?: string }) {
  return (
    <>
      <span>{k}</span>
      <span style={{ textAlign: "right" }} className={cls}>
        {href ? <a href={href} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{v}</a> : v}
      </span>
    </>
  );
}

function AntCard({ ev, serial, now, onClose }: { ev: ColonyEvent; serial: number | null; now: number; onClose: () => void }) {
  const { connection } = useConnection();
  const { publicKey } = useSigner();
  const [miner, setMiner] = useState<Miner | null>(null);
  const owner = ev.data.owner.toBase58();
  const caste = CASTES[ev.data.caste];
  const hash: number[] = Array.from(ev.data.hash);
  const zeros = hex(hash, 32).match(/^0*/)![0].length;

  useEffect(() => {
    let live = true;
    getProgram(connection)
      .account.miner.fetch(minerPda(ev.data.owner))
      .then((m) => live && setMiner(m))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [connection, ev.data.owner]);

  return (
    <Card onClose={onClose} sprite={caste} title={serial ? `Ant #${serial.toLocaleString("en-US")}` : "Ant"} tag={caste} color={casteColor(caste)}>
      <Row k="Owner" v={publicKey?.toBase58() === owner ? `${short(owner)} (you)` : short(owner)} href={explorer("address", owner)} />
      <Row k="Epoch" v={String(ev.data.epoch.toNumber()).padStart(3, "0")} />
      <Row k="Hatched" v={now ? fmtAgo(ev.ts, now) : "—"} />
      <Row k="Shares" v={ev.data.caste ? `${ev.data.shares.toNumber().toLocaleString("en-US")} (a 1-in-${CASTE_SHARES[ev.data.caste].toLocaleString("en-US")} hash)` : "1"} />
      <Row
        k="Hash"
        v={
          <>
            <span className="green">{hex(hash, 32).slice(0, zeros)}</span>
            {hex(hash, 32).slice(zeros, 20)}…
          </>
        }
      />
      <Row k="Work proven" v={`≈${fmtHashrate(hashWork(hash)).replace("/s", "")}`} />
      <Row k="Trail tip" v={`${hex(ev.data.tip, 6)}…`} />
      <Row k="Transaction" v={short(ev.sig, 6)} href={explorer("tx", ev.sig)} />
      {miner && (
        <Row
          k="Owner's colony"
          v={`${miner.totalAnts.toNumber().toLocaleString("en-US")} ants · ${miner.castes.map((c) => c.toNumber()).join("/")}`}
        />
      )}
    </Card>
  );
}
