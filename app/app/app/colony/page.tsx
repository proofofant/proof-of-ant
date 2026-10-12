"use client";

import { Fragment } from "react";
import { ColonyMap } from "@/components/ColonyMap";
import { NoColony } from "@/components/NoColony";
import { Panel, Sprite, casteColor } from "@/components/ui";
import { CASTES, CASTE_SHARES, fmtAgo, hex, short } from "@/lib/chain";
import { useColony } from "@/lib/colony";
import { useMiners } from "@/lib/hooks";

const PLURAL = ["workers", "soldiers", "winged", "queens"];

export default function ColonyPage() {
  const { colony, events, now } = useColony();
  const miners = useMiners();
  const castes = [0, 1, 2, 3].map((i) => (miners ?? []).reduce((s, m) => s + m.account.castes[i].toNumber(), 0));
  const total = castes.reduce((a, b) => a + b, 0);
  const spawns = events.filter((e) => e.name === "AntHatched").slice(0, 8);

  return (
    <div className="grid">
      <NoColony />
      <Panel title="Colony map" right={<span className="label">click an ant</span>} flush>
        <ColonyMap />
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
        <Panel title="Colony stats">
          <div className="kv">
            <span>Total ants</span>
            <span style={{ textAlign: "right" }}>{colony?.totalAnts.toNumber().toLocaleString("en-US") ?? "—"}</span>
            {PLURAL.map((p, i) => (
              <Fragment key={p}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Sprite name={CASTES[i]} scale={0.5} /> {p}
                </span>
                <span style={{ textAlign: "right", color: casteColor(CASTES[i]) }}>
                  {castes[i].toLocaleString("en-US")}{" "}
                  <span className="dim">({total ? ((castes[i] / total) * 100).toFixed(1) : "0.0"}%)</span>
                </span>
              </Fragment>
            ))}
          </div>
          <div className="dim" style={{ fontSize: 11, marginTop: 14, lineHeight: 1.7 }}>
            Expected odds per ant: soldier 1/16, winged 1/256, queen 1/65,536. Shares {CASTE_SHARES.join(" / ")} keep
            rewards proportional to the work done.
          </div>
        </Panel>

        <Panel title="Latest spawns">
          {spawns.length === 0 && <div className="empty">no ants yet</div>}
          {spawns.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "5px 0", fontSize: 12 }}>
              <span style={{ width: 90 }}>{short(e.data.owner)}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, color: casteColor(CASTES[e.data.caste]) }}>
                <Sprite name={CASTES[e.data.caste]} scale={0.5} />
                {CASTES[e.data.caste]}
              </span>
              <span className="dim">{fmtAgo(e.ts, now)}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Pheromone chain">
          <div className="dim" style={{ fontSize: 11, marginBottom: 12, lineHeight: 1.7 }}>
            tip = sha256(tip ‖ ant_hash). Every ant is chained into one sequential on-chain history: a tiny proof of history.
          </div>
          {spawns.slice(0, 5).map((e, i) => (
            <div key={e.id} style={{ fontSize: 11, lineHeight: 1.6 }}>
              {i > 0 && <div className="faint" style={{ paddingLeft: 8 }}>↑</div>}
              <div style={{ display: "flex", gap: 8, border: "1px solid var(--line)", padding: "4px 8px" }}>
                <span className={i === 0 ? "green" : undefined}>{hex(e.data.tip, 6)}…</span>
                <span className="faint">← {hex(e.data.hash, 4)}… ({CASTES[e.data.caste]})</span>
              </div>
            </div>
          ))}
          {colony && spawns.length === 0 && <div>{hex(colony.tip, 8)}…</div>}
        </Panel>
      </div>
    </div>
  );
}
