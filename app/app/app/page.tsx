"use client";

import Link from "next/link";
import { ColonyMap } from "@/components/ColonyMap";
import { EventFeed } from "@/components/EventFeed";
import { NoColony } from "@/components/NoColony";
import { Panel, Sprite, Stat, Stats } from "@/components/ui";
import {
  CASTES,
  colonyHashrate,
  fmtAgo,
  fmtDuration,
  fmtHashrate,
  fmtToken,
  projectedBudget,
  short,
} from "@/lib/chain";
import { useColony } from "@/lib/colony";
import { TICKER } from "@/lib/config";
import { useActiveMiners, useCurrentWork } from "@/lib/hooks";
import { useMiner } from "@/lib/miner/MinerProvider";
import { useSigner } from "@/lib/wallet";

export default function Overview() {
  const { colony, epoch, vaultAmount, now, events, me } = useColony();
  const { publicKey } = useSigner();
  const miner = useMiner();
  const work = useCurrentWork();
  const active = useActiveMiners(colony?.epoch.toNumber());

  const budget = colony ? projectedBudget(colony, vaultAmount) : 0n;
  const left = colony && epoch && now ? epoch.startTs.toNumber() + colony.epochDuration.toNumber() - now : 0;
  const queen = events.find((e) => e.name === "AntHatched" && CASTES[e.data.caste] === "queen");
  const myShares = work?.shares.toNumber() ?? 0;
  const totalShares = epoch?.shares.toNumber() ?? 0;
  const estReward = totalShares ? (budget * BigInt(myShares)) / BigInt(totalShares) : 0n;
  const fed = colony ? me.balance >= BigInt(colony.minHold.toString()) : false;

  return (
    <div className="grid">
      <NoColony />
      <Panel title="Colony status" flush>
        <Stats cols={4} style={{ border: 0, borderTop: "1px solid var(--line)" }}>
          <Stat label="Epoch" value={colony ? String(colony.epoch.toNumber()).padStart(3, "0") : "—"} />
          <Stat label="Time remaining" value={colony ? fmtDuration(left) : "—"} />
          <Stat label="Reward budget" value={`${fmtToken(budget, 0)} ${TICKER}`} sub="if the epoch closed now" />
          <Stat label="Total shares" value={totalShares.toLocaleString("en-US")} />
          <Stat label="Active miners" value={active.toLocaleString("en-US")} sub="this epoch" />
          <Stat label="Colony hashrate" value={epoch ? fmtHashrate(colonyHashrate(epoch, now)) : "—"} sub="est. from ants × difficulty" />
          <Stat label="Total ants" value={colony?.totalAnts.toNumber().toLocaleString("en-US") ?? "—"} />
          <div className="stat" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Sprite name="queen" scale={1.25} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span className="label">Latest queen</span>
              {queen ? (
                <>
                  <span className="gold">{short(queen.data.owner)}</span>
                  <span className="dim" style={{ fontSize: 11 }}>{fmtAgo(queen.ts, now)}</span>
                </>
              ) : (
                <span className="dim">none yet</span>
              )}
            </div>
          </div>
        </Stats>
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Panel title="Your node">
          {publicKey ? (
            <div className="kv">
              <span>Wallet</span>
              <span>{short(publicKey)} <span className="tag tag-solid" style={{ marginLeft: 8 }}>connected</span></span>
              <span>Mining status</span>
              <span className={miner.running ? "green" : "dim"}>{miner.running ? "● active" : "○ idle"}</span>
              <span>Your shares</span>
              <span>{myShares.toLocaleString("en-US")}</span>
              <span>Est. reward (epoch)</span>
              <span>{fmtToken(estReward)} {TICKER}</span>
              <span>Ant balance</span>
              <span>{fmtToken(me.balance, 0)} {TICKER}</span>
              <span>Required balance</span>
              <span className={fed ? "green" : "red"}>
                {fed ? "PASSED" : `NEED ${colony ? fmtToken(colony.minHold, 0) : "…"}`}
              </span>
            </div>
          ) : (
            <div className="empty">
              Connect a wallet to see your node.
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <Link href="/app/mine" className="btn btn-primary btn-sm">
              {miner.running ? "Open terminal →" : "Start mining →"}
            </Link>
          </div>
        </Panel>
        <Panel title="Recent colony events">
          <EventFeed limit={7} />
        </Panel>
      </div>

      <Panel title="Colony" right={<Link href="/app/colony" className="label">full map →</Link>} flush>
        <ColonyMap compact />
      </Panel>
    </div>
  );
}
