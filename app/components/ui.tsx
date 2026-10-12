import type { CSSProperties, ReactNode } from "react";
import { ICONS16 } from "./icons16";

export function Stat({ label, value, sub, size = "big", className }: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  size?: "big" | "mid";
  className?: string;
}) {
  return (
    <div className={`stat ${className ?? ""}`}>
      <span className="label">{label}</span>
      <span className={size}>{value}</span>
      {sub && <span className="dim" style={{ fontSize: 11 }}>{sub}</span>}
    </div>
  );
}

export function Stats({ cols = 4, children, style }: { cols?: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="stats" style={{ ["--cols" as string]: cols, ...style }}>
      {children}
    </div>
  );
}

export function Panel({ title, right, children, flush, style, className }: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <section className={`${flush ? "panel-flush" : "panel"} ${className ?? ""}`} style={style}>
      {(title || right) && (
        <div className="panel-head" style={flush ? { padding: "14px 16px 0" } : undefined}>
          {title && <h2 className="h-section" style={{ margin: 0 }}>{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export type SpriteName =
  | "ant-side" | "ant-hero" | "ant-tiny" | "worker" | "soldier" | "winged" | "queen" | "carrying" | "digging";

/** Static sprite (48x32 native, 16x10 for the tiny icon). */
export function Sprite({ name, scale = 2, style, flip }: { name: SpriteName; scale?: number; style?: CSSProperties; flip?: boolean }) {
  const [w, h] = name === "ant-tiny" ? [16, 10] : [48, 32];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/sprites/${name}.svg`}
      alt=""
      width={w * scale}
      height={h * scale}
      className="pixel"
      style={{ display: "block", transform: flip ? "scaleX(-1)" : undefined, ...style }}
    />
  );
}

/** 4-frame walk cycle from the sprite strip. */
export function Walker({ caste = "worker", scale = 2, style }: {
  caste?: "worker" | "soldier" | "winged" | "queen" | "carrying";
  scale?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="walker"
      style={{ ["--s" as string]: scale, backgroundImage: `url(/sprites/${caste}-walk.png)`, ...style }}
    />
  );
}

/** Tiny pixel icons drawn from 8x8 bitmaps. */
const ICONS: Record<string, string[]> = {
  overview: ["########", "#..#...#", "#..#...#", "####...#", "#..#####", "#..#...#", "#..#...#", "########"],
  mine: ["...####.", "..#....#", ".#....#.", "#.#..#..", "...##...", "..#.....", ".#......", "#......."],
  rewards: ["..####..", ".#....#.", "#..##..#", "#.#..#.#", "#.#..#.#", "#..##..#", ".#....#.", "..####.."],
  colony: ["...##...", "..####..", ".##..##.", "##.##.##", "#..##..#", "#.####.#", "##....##", "########"],
  leaderboard: ["........", "...##...", "...##...", "##.##...", "##.##.##", "##.##.##", "##.##.##", "########"],
  vault: ["########", "#......#", "#.####.#", "#.#..#.#", "#.####.#", "#......#", "########", ".#....#."],
  activity: ["........", "#.......", "#...#...", "#..#.#..", "#.#...#.", "##.....#", "#.......", "########"],
  docs: [".#####..", ".#...##.", ".#....#.", ".#.##.#.", ".#....#.", ".#.##.#.", ".#....#.", ".######."],
  ant: ["....#.#.", ".....#..", ".##.###.", "#######.", ".##.##..", "#.#.#.#.", "........", "........"],
};

/** 8x8 nav icons, or the 16x16 two-tone set (use size 16/32 for crisp pixels). */
export function PixelIcon({ name, size = 12, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  const rows = ICONS[name] ?? ICONS16[name] ?? ICONS.ant;
  const n = rows.length;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" aria-hidden style={{ flex: "none" }}>
      {rows.flatMap((r, y) =>
        [...r].map((c, x) =>
          c === "#" || c === "+" ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} opacity={c === "+" ? 0.55 : 1} />
          ) : null
        )
      )}
    </svg>
  );
}

/** Bar sparkline in the mockup's style. */
export function Sparkline({ values, width = 90, height = 22 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const n = 30;
  const vs = values.slice(-n);
  const bw = width / n;
  return (
    <svg width={width} height={height} shapeRendering="crispEdges" aria-hidden>
      {vs.map((v, i) => {
        const h = Math.max(1, Math.round((v / max) * height));
        return <rect key={i} x={Math.floor(i * bw)} y={height - h} width={Math.max(1, Math.floor(bw) - 1)} height={h} fill="var(--green)" />;
      })}
    </svg>
  );
}

export const casteColor = (c: string | null | undefined) =>
  c === "queen" ? "var(--gold)" : c === "winged" ? "var(--green)" : c === "soldier" ? "var(--text)" : "var(--text-2)";
