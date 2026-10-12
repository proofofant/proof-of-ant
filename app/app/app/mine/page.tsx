"use client";

import { useEffect, useRef, useState } from "react";
import { NoColony } from "@/components/NoColony";
import { Panel, PixelIcon, Sparkline, Sprite, Stat, Stats, casteColor } from "@/components/ui";
import { WalletButton } from "@/components/WalletButton";
import { fmtHashrate, fmtToken, hashesPerAnt } from "@/lib/chain";
import { useColony } from "@/lib/colony";
import { CLUSTER, IS_TEST, TICKER } from "@/lib/config";
import { useMiner, type Power } from "@/lib/miner/MinerProvider";
import { useSigner } from "@/lib/wallet";

function Elapsed({ since }: { since: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = since ? Math.floor((Date.now() - since) / 1000) : 0;
  const p = (n: number) => String(n).padStart(2, "0");
  return <>{p(Math.floor(s / 3600))}:{p(Math.floor((s % 3600) / 60))}:{p(s % 60)}</>;
}

const clock = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour12: false });

export default function Mine() {
  const m = useMiner();
  const { publicKey, kind } = useSigner();
  const { colony, epoch, me } = useColony();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [m.log.length]);

  const expectedSec = epoch && m.hashrate > 0 ? hashesPerAnt(epoch.target) / m.hashrate : null;

  return (
    <div className="grid">
      <NoColony />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
        <Panel title="Mining terminal">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <span className={m.running ? "green big" : "dim big"} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <PixelIcon name={m.running ? "mining-chip" : "ant"} size={16} />
              {m.running ? "ACTIVE" : "IDLE"}
            </span>
            <span className="big num green"><Elapsed since={m.running ? m.startedAt : null} /></span>
          </div>

          <div className="label icon-label"><PixelIcon name="cooling-fan" size={16} />Threads</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 16 }}>
            <button className="btn btn-sm" onClick={() => m.setThreads(m.threads - 1)} aria-label="fewer threads">−</button>
            <span className="mid num" style={{ width: 48, textAlign: "center" }}>{m.threads}</span>
            <button className="btn btn-sm" onClick={() => m.setThreads(m.threads + 1)} aria-label="more threads">+</button>
            <span className="dim" style={{ fontSize: 11, marginLeft: 8 }}>of {m.maxThreads} cores</span>
          </div>

          <div className="label icon-label"><PixelIcon name="power" size={16} />Power mode</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 20 }}>
            {(["low", "normal", "max"] as Power[]).map((p) => (
              <button
                key={p}
                className={`btn btn-sm ${m.power === p ? "btn-primary" : ""}`}
                onClick={() => m.setPower(p)}
                style={{ marginLeft: -1 }}
              >
                {p}
              </button>
            ))}
          </div>

          <Blocker />

          <div style={{ display: "flex", gap: 10 }}>
            {m.running ? (
              <button className="btn btn-danger" style={{ flex: 1 }} onClick={m.stop}>Stop mining</button>
            ) : (
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={m.start} disabled={!publicKey}>
                Start mining
              </button>
            )}
            <button className="btn" onClick={m.reset}>Reset</button>
          </div>

          <div className="kv" style={{ marginTop: 20, fontSize: 12 }}>
            <span>Difficulty</span>
            <span>{epoch ? `${(hashesPerAnt(epoch.target) / 1e6).toFixed(1)}M hashes / ant` : "—"}</span>
            <span>Next ant in</span>
            <span>{expectedSec ? `~${expectedSec < 60 ? expectedSec.toFixed(0) + "s" : (expectedSec / 60).toFixed(1) + "m"}` : "—"}</span>
            <span>Signer</span>
            <span>{kind === "burner" ? "dev burner" : m.session ? `session ${m.session.pubkey.toBase58().slice(0, 6)}… · ${m.session.sol.toFixed(4)} SOL` : "—"}</span>
          </div>
        </Panel>

        <Panel title={<span className="icon-label" style={{ margin: 0 }}><PixelIcon name="hashrate" size={16} />Mining output</span>} style={{ display: "flex", flexDirection: "column" }}>
          <div ref={logRef} className="log" style={{ height: 380 }}>
            {m.log.length === 0 && (
              <div className="dim">
                {"> "}press START MINING to boot the miner<span className="blink">_</span>
              </div>
            )}
            {m.log.map((l) => (
              <div key={l.id}>
                <span className="t">[{clock(l.t)}]</span>
                <span className={l.kind === "ok" ? "green" : l.kind === "bad" ? "red" : l.kind === "dim" ? "dim" : l.kind === "gold" ? "gold" : l.kind === "accent" ? "green" : undefined}>
                  {l.text}
                </span>
              </div>
            ))}
            {m.running && <div className="green">{"> "}<span className="blink">_</span></div>}
          </div>
        </Panel>
      </div>

      <Stats cols={5}>
        <div className="stat">
          <span className="label">Current hashrate</span>
          <div style={{ display: "flex", alignItems: "end", gap: 12, justifyContent: "space-between" }}>
            <span className="mid">{fmtHashrate(m.hashrate)}</span>
            <Sparkline values={m.history} />
          </div>
        </div>
        <Stat size="mid" label="Valid shares" value={m.valid} sub="ants hatched this session" />
        <Stat size="mid" label="Hashes tried" value={<span className="dim">{m.tried.toLocaleString("en-US")}</span>} sub={m.failed ? <span className="red">{m.failed} tx rejected</span> : "below target = ant"} />
        <Stat size="mid" label="Lifetime ants" value={me.miner?.totalAnts.toNumber() ?? 0} />
        <div className="stat" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {m.best && <Sprite name={m.best} scale={1} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">Best rarity</span>
            <span className="mid" style={{ color: casteColor(m.best), textTransform: "uppercase" }}>{m.best ?? "—"}</span>
          </div>
        </div>
      </Stats>

      {colony && (
        <div className="dim" style={{ fontSize: 11 }}>
          Mining needs ≥ {fmtToken(colony.minHold, 0)} {TICKER} in your wallet. Max {colony.maxAntsPerEpoch} ants per wallet per epoch.
          Your wallet is part of every hash, so a solution can't be stolen or reused.
          {IS_TEST && ` ${CLUSTER}: use the dev faucet in the wallet menu.`}
        </div>
      )}
    </div>
  );
}

function Blocker() {
  const m = useMiner();
  const { publicKey } = useSigner();
  if (!publicKey)
    return (
      <div className="panel" style={{ marginBottom: 16, background: "var(--panel-2)" }}>
        <div style={{ marginBottom: 10 }}>Connect a wallet to start mining.</div>
        <WalletButton />
      </div>
    );
  if (m.blocker === "session" || m.blocker === "sol")
    return (
      <div className="panel" style={{ marginBottom: 16, background: "var(--panel-2)", borderColor: "var(--green)" }}>
        <div style={{ marginBottom: 6 }}>{m.blocker === "session" ? "One-time approval" : "Top up the session key"}</div>
        <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
          A local session key digs for you, so there is no wallet popup per ant. Your wallet stays in every hash and keeps the
          ants and rewards. 0.02 SOL covers ~3,000 digs.
        </div>
        <button className="btn btn-primary btn-sm" onClick={async () => { await m.authorizeSession(); m.start(); }}>
          Approve session key →
        </button>
      </div>
    );
  if (m.blocker === "food")
    return (
      <div className="panel" style={{ marginBottom: 16, background: "var(--panel-2)", borderColor: "var(--red)" }}>
        <div className="red" style={{ marginBottom: 6 }}>Not enough food</div>
        <div className="dim" style={{ fontSize: 12 }}>Hold the minimum token balance to feed your ants, then start again.</div>
      </div>
    );
  return null;
}
