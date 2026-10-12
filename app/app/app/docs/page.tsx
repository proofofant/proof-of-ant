"use client";

import { useEffect, useRef, useState } from "react";
import { Panel, Sprite } from "@/components/ui";
import { CASTES, CASTE_SHARES, short } from "@/lib/chain";
import { useColony } from "@/lib/colony";
import { MINT, PROGRAM_ID, TICKER } from "@/lib/config";

const toHex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (data: Uint8Array) => toHex(await crypto.subtle.digest("SHA-256", data as BufferSource));
const enc = new TextEncoder();

/** PoW: many ants guess in parallel, a lottery. Real SHA-256 on random nonces. */
function PowDemo() {
  const LANES = 6;
  const [lanes, setLanes] = useState<{ h: string; hit: boolean }[]>(() => Array.from({ length: LANES }, () => ({ h: "", hit: false })));
  const [tries, setTries] = useState(0);
  const [hits, setHits] = useState(0);
  useEffect(() => {
    let live = true;
    const t = setInterval(async () => {
      const next = await Promise.all(
        Array.from({ length: LANES }, async (_, i) => {
          const h = await sha(enc.encode(`lane${i}:${Math.random()}`));
          return { h, hit: h.startsWith("0") };
        })
      );
      if (!live) return;
      setLanes(next);
      setTries((n) => n + LANES);
      setHits((n) => n + next.filter((l) => l.hit).length);
    }, 160);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return (
    <div>
      {lanes.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 10, fontSize: 11, padding: "3px 0", color: l.hit ? "var(--green)" : "var(--dim)" }}>
          <span className="faint">ant {i + 1}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{l.h.slice(0, 24) || "…"}</span>
          {l.hit && <span>✓ below target</span>}
        </div>
      ))}
      <div className="dim" style={{ fontSize: 11, marginTop: 10 }}>
        {tries.toLocaleString("en-US")} guesses · {hits} hits (target: hash starts with 0 → 1/16)
      </div>
    </div>
  );
}

/** PoH: one sequential chain; each step needs the previous output. */
function PohDemo() {
  const [chain, setChain] = useState<string[]>([]);
  const [n, setN] = useState(0);
  const head = useRef<string>("genesis");
  useEffect(() => {
    let live = true;
    const t = setInterval(async () => {
      // 200 sequential hashes per tick: impossible to split across cores.
      let h = head.current;
      for (let i = 0; i < 200; i++) h = await sha(enc.encode(h));
      if (!live) return;
      head.current = h;
      setN((x) => x + 200);
      setChain((c) => [h, ...c].slice(0, 6));
    }, 400);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return (
    <div>
      {chain.map((h, i) => (
        <div key={h} style={{ fontSize: 11, padding: "3px 0", color: i === 0 ? "var(--green)" : "var(--dim)" }}>
          <span className="faint">#{(n - i * 200).toLocaleString("en-US")}</span> {h.slice(0, 28)}…
        </div>
      ))}
      <div className="dim" style={{ fontSize: 11, marginTop: 10 }}>
        {n.toLocaleString("en-US")} sequential hashes · verification can be split into segments and checked in parallel
      </div>
    </div>
  );
}

const SECTIONS: [string, React.ReactNode][] = [
  [
    "How mining works",
    <>
      Every epoch the program publishes a fresh <code>challenge</code> derived from the latest SlotHash, so nobody can mine
      in advance. Your browser searches for a nonce such that the first 8 bytes of
      <pre className="green" style={{ whiteSpace: "pre-wrap", margin: "10px 0" }}>sha256(challenge ‖ your_wallet ‖ counter ‖ nonce)</pre>
      are below the epoch&apos;s <code>target</code>. The program re-computes the hash with the <code>sol_sha256</code> syscall and,
      if it holds, hatches an ant. Your wallet is inside the hash, so a solution can&apos;t be stolen from the mempool, and the
      counter goes up with every ant, so it can&apos;t be replayed. The miner hashes the first 64 bytes once (the midstate) and
      only the last block per nonce, the same trick Bitcoin ASICs use.
    </>,
  ],
  [
    "Difficulty",
    <>
      When an epoch closes the target is rescaled so the colony converges to the planned number of ants per epoch (at most
      ×2 easier or ÷2 harder per step), just like Bitcoin&apos;s retarget. A difficulty floor keeps quiet epochs from making
      ants free: however empty the colony gets, an ant never costs less than the floor. The colony hashrate on the overview is an estimate:
      ants × hashes-per-ant ÷ elapsed time.
    </>,
  ],
  [
    "Rewards",
    <>
      pump.fun creator fees buy back ${TICKER}, which goes into the program-owned vault. When an epoch closes it locks a share
      of the free vault (10% by default) as its budget and splits it by shares. You claim per epoch whenever you like; unclaimed
      rewards go back to the vault after the claim window. To mine and to claim you must hold the minimum ${TICKER} balance
      (&quot;an ant needs food&quot;), which makes multi-wallet farming expensive.
    </>,
  ],
  [
    "Session keys",
    <>
      Approving a wallet popup for every ant would be unbearable. You approve once: <code>set_session</code> authorizes a local
      key and funds it with a little SOL for fees. That key can only <code>dig</code> for you. Ants and rewards always belong to
      your wallet, and you can revoke it at any time.
    </>,
  ],
];

export default function Docs() {
  const { colony } = useColony();
  return (
    <div className="grid" style={{ maxWidth: 1100 }}>
      <Panel title="Proof of Work vs Proof of History">
        <div className="dim" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.7 }}>
          Bitcoin uses proof of work as consensus: whoever finds the lucky hash first writes the block. Solana&apos;s proof of
          history is not consensus but a clock: one sequential hash chain proves time passed between events. Proof of Ant uses
          both: <span className="text">PoW</span> to hatch ants, and a <span className="text">PoH-style pheromone chain</span> to
          order them.
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <div className="panel" style={{ background: "var(--panel-2)" }}>
            <div className="h-section">PoW · parallel lottery</div>
            <PowDemo />
          </div>
          <div className="panel" style={{ background: "var(--panel-2)" }}>
            <div className="h-section">PoH · sequential clock</div>
            <PohDemo />
          </div>
        </div>
      </Panel>

      <Panel title="Castes">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Caste</th><th>Hash must be below</th><th className="right">Odds</th><th className="right">Shares</th></tr>
            </thead>
            <tbody>
              {CASTES.map((c, i) => (
                <tr key={c}>
                  <td><span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><Sprite name={c} scale={0.75} />{c}</span></td>
                  <td className="dim">{["target", "target / 16", "target / 256", "target / 65,536"][i]}</td>
                  <td className="right">{["1", "1/16", "1/256", "1/65,536"][i]}</td>
                  <td className="right">{CASTE_SHARES[i].toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {SECTIONS.map(([t, body]) => (
        <Panel key={t} title={t}>
          <div className="dim" style={{ fontSize: 12, lineHeight: 1.8 }}>{body}</div>
        </Panel>
      ))}

      <Panel title="Addresses">
        <div className="kv" style={{ fontSize: 12 }}>
          <span>Program</span><span>{PROGRAM_ID.toBase58()}</span>
          <span>Token mint</span><span>{MINT?.toBase58() ?? "—"}</span>
          <span>Vault</span><span>{colony ? colony.vault.toBase58() : "—"}</span>
          <span>Authority</span><span>{colony ? short(colony.authority, 6) : "—"}</span>
        </div>
      </Panel>
    </div>
  );
}
