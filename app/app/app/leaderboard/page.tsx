"use client";

import { useMemo } from "react";
import { NoColony } from "@/components/NoColony";
import { Panel, Sprite, casteColor } from "@/components/ui";
import { bestCaste, fmtToken, lifetimeShares, short } from "@/lib/chain";
import { useColony } from "@/lib/colony";
import { TICKER } from "@/lib/config";
import { useMiners } from "@/lib/hooks";
import { useSigner } from "@/lib/wallet";

export default function Leaderboard() {
  const miners = useMiners();
  const { events } = useColony();
  const { publicKey } = useSigner();
  const me = publicKey?.toBase58();

  // Rewards per wallet from the Claimed events we have seen.
  const earned = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const e of events)
      if (e.name === "Claimed") {
        const k = e.data.owner.toBase58();
        m.set(k, (m.get(k) ?? 0n) + BigInt(e.data.amount.toString()));
      }
    return m;
  }, [events]);

  const rows = (miners ?? [])
    .map((m) => ({ owner: m.account.owner.toBase58(), ants: m.account.totalAnts.toNumber(), shares: lifetimeShares(m.account), best: bestCaste(m.account) }))
    .filter((r) => r.ants > 0)
    .sort((a, b) => b.shares - a.shares)
    .slice(0, 100);

  return (
    <div className="grid">
      <NoColony />
      <Panel title="Leaderboard · all time" right={<span className="label">{rows.length} miners</span>} flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Wallet</th>
                <th className="right">Ants</th>
                <th className="right">Shares</th>
                <th>Best caste</th>
                <th className="right">Rewards claimed</th>
              </tr>
            </thead>
            <tbody>
              {miners === null && <tr><td colSpan={6} className="empty">loading miners…</td></tr>}
              {miners && rows.length === 0 && <tr><td colSpan={6} className="empty">no miners yet: be the first ant</td></tr>}
              {rows.map((r, i) => (
                <tr key={r.owner} style={r.owner === me ? { background: "var(--panel-2)" } : undefined}>
                  <td className={i < 3 ? "gold" : "dim"}>{i + 1}</td>
                  <td>{short(r.owner)} {r.owner === me && <span className="tag green" style={{ marginLeft: 6 }}>you</span>}</td>
                  <td className="right">{r.ants.toLocaleString("en-US")}</td>
                  <td className="right">{r.shares.toLocaleString("en-US")}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: casteColor(r.best), textTransform: "lowercase" }}>
                      {r.best && <Sprite name={r.best} scale={0.5} />}
                      {r.best}
                    </span>
                  </td>
                  <td className="right">{fmtToken(earned.get(r.owner) ?? 0n)} {TICKER}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
