"use client";

import { NoColony } from "@/components/NoColony";
import { Panel, PixelIcon, Stat, Stats } from "@/components/ui";
import { big, explorer, fmtToken, projectedBudget, short } from "@/lib/chain";
import { useColony } from "@/lib/colony";
import { TICKER } from "@/lib/config";

const FLOW = ["Fees", "Buyback", "Vault", "Rewards"];

export default function Vault() {
  const { colony, vaultAmount, events } = useColony();
  const reserved = colony ? big(colony.reserved) : 0n;
  const free = vaultAmount > reserved ? vaultAmount - reserved : 0n;
  const deposits = events.filter((e) => e.name === "RewardsDeposited");
  const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString("en-GB", { hour12: false });

  return (
    <div className="grid">
      <NoColony />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "stretch" }}>
        <Panel title={<span className="icon-label" style={{ margin: 0 }}><PixelIcon name="vault" size={16} />Reward vault</span>} flush>
          <Stats cols={2} style={{ border: 0, borderTop: "1px solid var(--line)" }}>
            <Stat label="Total stored" value={`${fmtToken(vaultAmount, 0)} ${TICKER}`} />
            <Stat label="Free" value={`${fmtToken(free, 0)} ${TICKER}`} sub="feeds future epochs" />
            <Stat label="Reserved" value={`${fmtToken(reserved, 0)}`} sub="locked for finalized epochs" />
            <Stat label="Next epoch budget" value={colony ? `${fmtToken(projectedBudget(colony, vaultAmount), 0)}` : "—"} sub={colony ? `${colony.emissionBps / 100}% of free` : undefined} />
          </Stats>
        </Panel>
        <Panel title="Flow">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            {FLOW.map((f, i) => (
              <span key={f} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="tag" style={{ padding: "6px 12px", color: i === 2 ? "var(--green)" : "var(--text)" }}>{f}</span>
                {i < FLOW.length - 1 && <span className="dim">⟶</span>}
              </span>
            ))}
          </div>
          <div className="dim" style={{ fontSize: 12, lineHeight: 1.75 }}>
            pump.fun pays the dev creator fees in SOL. They are used to buy back ${TICKER} and the tokens go into this vault through{" "}
            <code className="green">deposit_rewards</code>, so every buyback is an on-chain event below. The vault is owned by the
            program: nobody can withdraw it except through <code className="green">claim</code>. Each epoch locks {colony ? colony.emissionBps / 100 : 10}% of
            the free balance, so payouts are smooth and the vault never empties at once.
          </div>
          {colony && (
            <div style={{ marginTop: 14, fontSize: 11 }}>
              <a className="dim" href={explorer("address", colony.vault.toBase58())} target="_blank" rel="noreferrer">vault {short(colony.vault, 6)} ↗</a>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Deposit history" right={<span className="label">{deposits.length} buybacks</span>} flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Time</th><th className="right">Amount</th><th>From</th><th className="right">Tx</th></tr>
            </thead>
            <tbody>
              {deposits.length === 0 && <tr><td colSpan={4} className="empty">no deposits yet</td></tr>}
              {deposits.map((e) => (
                <tr key={e.id}>
                  <td className="dim">{clock(e.ts)}</td>
                  <td className="right green">+{fmtToken(e.data.amount, 0)} {TICKER}</td>
                  <td>{short(e.data.depositor)}</td>
                  <td className="right"><a href={explorer("tx", e.sig)} target="_blank" rel="noreferrer" className="dim">{short(e.sig)} ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
