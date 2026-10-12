"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Brand } from "@/components/AppShell";
import { Stat, Stats } from "@/components/ui";
import { WalletButton } from "@/components/WalletButton";
import { colonyHashrate, fmtHashrate, fmtToken } from "@/lib/chain";
import { useColony } from "@/lib/colony";
import { TICKER } from "@/lib/config";
import { useActiveMiners } from "@/lib/hooks";

function Moon() {
  return (
    <svg width="64" height="64" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden className="hide-sm" style={{ position: "absolute", right: "18%", top: 30 }}>
      {Array.from({ length: 16 * 16 }, (_, i) => {
        const x = i % 16, y = Math.floor(i / 16);
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (d > 7) return null;
        return <rect key={i} x={x} y={y} width={1} height={1} fill={d > 6 ? "var(--text-2)" : (x + y) % 2 ? "var(--panel-2)" : "transparent"} />;
      })}
    </svg>
  );
}

// ── Hash hill: the mound is the colony's hash chain, ASIC-style ──
const HW = 120, HH = 34;
/** Flat-topped mound (so every foot touches it) with a little wobble on the slopes. */
const surface = (x: number) => {
  const e = Math.exp(-(((x - 75) / 36) ** 6));
  return Math.min(HH - 1, Math.round(HH - 1.5 - 24 * e - 0.8 * Math.sin(x / 4) * (1 - e)));
};
// The ant lives in the same coordinates as the hill: 1 sprite px = ANT_K hill units.
const ANT_K = 1.5, ANT_X = 38, ANT_Y = surface(75) - 28 * ANT_K, TOP = ANT_Y + 3 * ANT_K;
// Sprite feet (x, bottom row) → hill x.
const FEET = [14.5, 23.5, 33.5, 36].map((x) => Math.round(ANT_X + ANT_K * x - 0.5));

const GREEN = [143, 227, 154], LINE = [42, 69, 53];
const SAND = [[237, 228, 200], [168, 159, 128], [110, 104, 86]];

/** Cheap deterministic per-cell noise in [0, 1). */
const noise = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
};

/**
 * The mound as a sand hill over a mining die: grainy sand with dune ripples,
 * a faint chip grid underneath, matrix-style green streams pouring through
 * it, and grains that roll down the slopes and spray from the ant's feet.
 * Drawn on the hill's own 1-unit pixel grid.
 */
function HashRain() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rows = HH - TOP;
    const top = surface(75);
    const inside = (x: number, y: number) => y > surface(x);

    // Static sand: colour index (or -1 for empty) and alpha per cell.
    const sand: [number, number][] = [];
    for (let y = 0; y < HH; y++)
      for (let x = 0; x < HW; x++) {
        const below = y - surface(x);
        const n = noise(x, y);
        const ripple = (x + 2 * y + Math.round(2 * Math.sin(x / 9))) % 9 === 0;
        const grid = x % 6 === 0 || y % 5 === 0;
        // Denser and lighter near the surface, sparser and darker deep down.
        const density = below <= 1 ? 0.95 : Math.max(0.22, 0.75 - below * 0.03);
        if (n < density) sand.push([ripple ? 2 : n < density * 0.25 ? 0 : 1, (below <= 1 ? 0.65 : 0.42 - Math.min(0.2, below * 0.009)) * (ripple ? 1.3 : 1)]);
        else sand.push(grid ? [-2, 0.5] : [-1, 0]);
      }

    const spawn = (anywhere: boolean) => ({
      y: anywhere ? top + Math.random() * (HH - top + 10) : top - Math.random() * 6,
      speed: 0.25 + Math.random() * 0.55,
      len: 4 + Math.floor(Math.random() * 8),
    });
    const drops = Array.from({ length: HW }, () => spawn(true));
    // Loose grains: kicked up by the feet, then sliding down the slope.
    type Grain = { x: number; y: number; vx: number; vy: number; life: number };
    const grains: Grain[] = [];
    const kick = () => {
      const f = FEET[Math.floor(Math.random() * FEET.length)];
      grains.push({ x: f, y: surface(f) - 1, vx: -(0.3 + Math.random() * 0.5), vy: -(0.4 + Math.random() * 0.5), life: 60 });
    };
    const slide = () => {
      const left = Math.random() < 0.5;
      const x = left ? 50 + Math.random() * 6 : 96 + Math.random() * 6;
      grains.push({ x, y: surface(Math.round(x)) - 1, vx: left ? -0.35 : 0.35, vy: 0, life: 120 });
    };

    let sc = 1;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.width * (rows / HW));
      sc = canvas.width / HW;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const px = (x: number, y: number, rgb: number[], a: number) => {
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;
      const x0 = Math.round(x * sc), y0 = Math.round((y - TOP) * sc);
      ctx.fillRect(x0, y0, Math.round((x + 1) * sc) - x0, Math.round((y + 1 - TOP) * sc) - y0);
    };

    let raf = 0, last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 50) return;
      last = t;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const breathe = 0.8 + 0.2 * Math.sin(t / 900);

      for (let x = 0; x < HW; x++) {
        const d = drops[x];
        if (!reduce) {
          d.y += d.speed;
          if (d.y - d.len > HH) Object.assign(d, spawn(false));
        }
        const head = Math.floor(d.y);
        for (let y = Math.max(0, top); y < HH; y++) {
          if (!inside(x, y)) continue;
          const [c, a] = sand[y * HW + x];
          const dist = head - y;
          if (dist === 0) px(x, y, [225, 255, 228], 0.9);
          else if (dist > 0 && dist < d.len) {
            const k = 1 - dist / d.len;
            px(x, y, GREEN, (0.12 + 0.65 * k) * breathe * (c >= 0 ? 1 : 0.6));
          } else if (c >= 0) px(x, y, SAND[c], a);
          else if (c === -2) px(x, y, LINE, 0.45);
        }
      }

      if (!reduce) {
        if (Math.random() < 0.35) kick();
        if (Math.random() < 0.12) slide();
        for (let i = grains.length - 1; i >= 0; i--) {
          const g = grains[i];
          g.x += g.vx;
          g.y += g.vy;
          const floor = surface(Math.max(0, Math.min(HW - 1, Math.round(g.x)))) - 1;
          if (g.y >= floor) {
            // Landed: roll downhill along the surface.
            g.y = floor;
            g.vy = 0;
            const slope = surface(Math.min(HW - 1, Math.round(g.x) + 1)) - surface(Math.max(0, Math.round(g.x) - 1));
            g.vx = slope === 0 ? g.vx * 0.6 : Math.sign(slope) * Math.min(0.6, Math.abs(g.vx) + 0.05);
          } else g.vy += 0.12;
          if (--g.life <= 0 || g.x < 0 || g.x >= HW || (g.vy === 0 && Math.abs(g.vx) < 0.05)) grains.splice(i, 1);
          else px(Math.round(g.x), Math.round(g.y), SAND[g.life % 3 === 0 ? 1 : 0], 0.85);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />;
}

function Hill() {
  // Sand crest: one pixel line, a little uneven like real grains.
  const outline = Array.from({ length: HW }, (_, x) => (
    <rect key={x} x={x} y={surface(x)} width={1} height={1} fill={noise(x, 0) < 0.3 ? "var(--text)" : "var(--text-2)"} />
  ));

  return (
    <div style={{ width: "100%", maxWidth: 560, position: "relative" }}>
      <HashRain />
      <svg viewBox={`0 ${TOP} ${HW} ${HH - TOP}`} width="100%" style={{ display: "block", position: "relative" }} aria-hidden>
        <image href="/sprites/ant-hero.svg" x={ANT_X} y={ANT_Y} width={48 * ANT_K} height={32 * ANT_K} style={{ imageRendering: "pixelated" }} />
        <g shapeRendering="crispEdges">
          {outline}
        </g>
      </svg>
    </div>
  );
}

const FLOW = [
  ["Trades", "(on-chain)"],
  ["Creator fees", ""],
  ["Buyback", `$${TICKER}`],
  ["Reward vault", ""],
  ["Miners", "(epoch rewards)"],
];

export default function Landing() {
  const { colony, epoch, vaultAmount, now } = useColony();
  const active = useActiveMiners(colony?.epoch.toNumber());

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 16px 40px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 28, height: 64 }}>
        <Brand />
        <nav className="hide-sm" style={{ display: "flex", gap: 24, fontSize: 12, letterSpacing: "0.12em" }}>
          <a href="#how" className="dim">HOW IT WORKS</a>
          <Link href="/app" className="dim">STATS</Link>
          <Link href="/app/docs" className="dim">DOCS</Link>
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <WalletButton compact />
          <Link href="/app/mine" className="btn btn-sm hide-sm">Enter terminal</Link>
        </div>
      </header>

      <section
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 24,
          alignItems: "end",
          padding: "56px 0 28px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "clamp(38px, 7vw, 64px)", lineHeight: 1, margin: "0 0 22px", fontWeight: 500, letterSpacing: "0.04em" }}>
            PROOF OF ANT
          </h1>
          <p style={{ fontSize: "clamp(15px, 2vw, 19px)", lineHeight: 1.45, margin: "0 0 22px", letterSpacing: "0.06em" }}>
            BROWSER-BASED PROOF OF WORK
            <br />
            FOR A LIVE ON-CHAIN COLONY
          </p>
          <p className="dim" style={{ margin: "0 0 28px", fontSize: 13, lineHeight: 1.8 }}>
            <span className="green">Mine in your browser.</span>
            <br />
            Earn buyback-funded rewards.
            <br />
            Watch the colony grow in real time.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/app/mine" className="btn btn-primary">Enter terminal →</Link>
            <Link href="/app/docs" className="btn">Read docs</Link>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Moon />
          <Hill />
        </div>
      </section>

      <Stats cols={4}>
        <Stat label="Epoch" value={colony ? String(colony.epoch.toNumber()).padStart(3, "0") : "—"} />
        <Stat label="Miners" value={active.toLocaleString("en-US")} sub="this epoch" />
        <Stat label="Colony hashrate" value={epoch ? fmtHashrate(colonyHashrate(epoch, now)) : "—"} />
        <Stat label="Reward vault" value={`${fmtToken(vaultAmount, 0)} ${TICKER}`} />
      </Stats>

      <section
        id="how"
        className="panel flow"
        style={{ marginTop: 16 }}
      >
        {FLOW.map(([a, b], i) => (
          <div key={a} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "center", letterSpacing: "0.12em", fontSize: 12 }}>
              <div>{a.toUpperCase()}</div>
              {b && <div className="dim" style={{ fontSize: 11 }}>{b}</div>}
            </div>
            {i < FLOW.length - 1 && <span className="dim">⟶</span>}
          </div>
        ))}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 16 }}>
        {[
          ["01 · Dig", "Your browser searches for a nonce so that sha256(challenge ‖ wallet ‖ counter ‖ nonce) falls below the target. Pure proof of work."],
          ["02 · Hatch", "The program verifies the hash on-chain. A hash far below the target hatches a rarer caste: soldier, winged, or the 1-in-65,536 queen."],
          ["03 · Earn", "Each epoch locks 10% of the vault, filled by creator-fee buybacks, and splits it by shares. Claim any time."],
        ].map(([t, d]) => (
          <div key={t} className="panel">
            <div className="h-section">{t}</div>
            <div className="dim" style={{ fontSize: 12, lineHeight: 1.7 }}>{d}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
