"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useEffect, useRef, useState } from "react";
import { short } from "@/lib/chain";
import { useColony } from "@/lib/colony";
import { CLUSTER, FAUCET_LABEL, IS_TEST } from "@/lib/config";
import { useSigner, useWallet } from "@/lib/wallet";

export function WalletButton({ compact }: { compact?: boolean }) {
  const { publicKey, kind, enableBurner, disconnect } = useSigner();
  const { wallets, select, connect, wallet: selected } = useWallet();
  const { refresh } = useColony();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // After select(), connect once the adapter is set.
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (pending && selected) {
      setPending(false);
      connect().catch(() => {});
    }
  }, [pending, selected, connect]);

  const installed = wallets.filter((w) => w.readyState === WalletReadyState.Installed);

  async function faucet() {
    if (!publicKey) return;
    setBusy("faucet");
    try {
      const r = await fetch("/api/faucet", { method: "POST", body: JSON.stringify({ wallet: publicKey.toBase58() }) });
      const res = await r.json();
      if (!r.ok) throw new Error(res.error);
      if (!res.tokens) alert("Faucet is out of tokens: you got SOL only. Buy the token to mine.");
      await refresh();
    } catch (e) {
      alert(`Faucet failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} style={{ gap: 8 }}>
        <span className={publicKey ? "green" : "dim"}>●</span>
        {publicKey ? short(publicKey) : compact ? "Connect" : "Connect wallet"}
      </button>
      {open && (
        <div className="wallet-menu">
          {publicKey ? (
            <>
              <div className="label" style={{ padding: "6px 10px" }}>
                {kind === "burner" ? "dev burner wallet" : "connected"}
              </div>
              <div style={{ padding: "0 10px 6px", fontSize: 11, wordBreak: "break-all" }}>{publicKey.toBase58()}</div>
              <button onClick={() => navigator.clipboard?.writeText(publicKey.toBase58())}>Copy address</button>
              {IS_TEST && (
                <button onClick={faucet} disabled={busy === "faucet"}>
                  {busy === "faucet" ? "Dripping…" : `Dev faucet: ${FAUCET_LABEL}`}
                </button>
              )}
              <button className="red" onClick={() => { disconnect(); setOpen(false); }}>Disconnect</button>
            </>
          ) : (
            <>
              <div className="label" style={{ padding: "6px 10px" }}>choose a wallet</div>
              {installed.length === 0 && (
                <div className="dim" style={{ padding: "4px 10px 8px", fontSize: 12 }}>
                  No Solana wallet detected. Install Phantom, Solflare or Backpack.
                </div>
              )}
              {installed.map((w) => (
                <button key={w.adapter.name} onClick={() => { select(w.adapter.name); setPending(true); setOpen(false); }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.adapter.icon} alt="" width={18} height={18} />
                  {w.adapter.name}
                </button>
              ))}
              {IS_TEST && (
                <button onClick={() => { enableBurner(); setOpen(false); }}>
                  <span className="green">⌁</span> Dev burner wallet ({CLUSTER})
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
