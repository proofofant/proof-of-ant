"use client";

import { BN } from "@coral-xyz/anchor";
import { Transaction } from "@solana/web3.js";
import { useMemo, useState } from "react";
import { NoColony } from "@/components/NoColony";
import { Panel, Stat, Stats } from "@/components/ui";
import { WalletButton } from "@/components/WalletButton";
import {
  colonyPda,
  epochPda,
  fmtDuration,
  fmtToken,
  getProgram,
  projectedBudget,
  vaultPda,
  workPda,
} from "@/lib/chain";
import { useColony } from "@/lib/colony";
import { TICKER } from "@/lib/config";
import { useCurrentWork, useReceipts, type Receipt } from "@/lib/hooks";
import { useConnection, useSigner } from "@/lib/wallet";

const CLAIMS_PER_TX = 4;

const payout = (r: Receipt) =>
  r.epoch.expired || r.epoch.shares.isZero()
    ? 0n
    : (BigInt(r.epoch.budget.toString()) * BigInt(r.work.shares.toString())) / BigInt(r.epoch.shares.toString());

export default function Rewards() {
  const { connection } = useConnection();
  const { wallet, publicKey } = useSigner();
  const { colony, epoch, vaultAmount, now, events, me, refresh, tokenProgram } = useColony();
  const work = useCurrentWork();
  const { receipts, reload } = useReceipts();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const budget = colony ? projectedBudget(colony, vaultAmount) : 0n;
  const left = colony && epoch && now ? epoch.startTs.toNumber() + colony.epochDuration.toNumber() - now : 0;
  const myShares = work?.shares.toNumber() ?? 0;
  const totalShares = epoch?.shares.toNumber() ?? 0;
  const est = totalShares ? (budget * BigInt(myShares)) / BigInt(totalShares) : 0n;

  const claimable = (receipts ?? []).filter((r) => r.epoch.finalized);
  const totalClaimable = claimable.reduce((s, r) => s + payout(r), 0n);

  const claimed = useMemo(
    () =>
      publicKey
        ? events.filter((e) => e.name === "Claimed" && e.data.owner.toBase58() === publicKey.toBase58())
        : [],
    [events, publicKey]
  );

  async function claimAll() {
    if (!wallet || !publicKey || !me.tokenAccount || !colony || !tokenProgram) return;
    setBusy(true);
    setMsg(null);
    try {
      const program = getProgram(connection, wallet);
      const ixs = await Promise.all(
        claimable.map((r) =>
          program.methods
            .claim(new BN(r.epochIndex))
            .accountsPartial({
              owner: publicKey,
              colony: colonyPda(),
              mint: colony.mint,
              vault: vaultPda(),
              epoch: epochPda(r.epochIndex),
              work: workPda(r.epochIndex, publicKey),
              ownerToken: me.tokenAccount!,
              tokenProgram,
            })
            .instruction()
        )
      );
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const txs: Transaction[] = [];
      for (let i = 0; i < ixs.length; i += CLAIMS_PER_TX) {
        const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight });
        tx.add(...ixs.slice(i, i + CLAIMS_PER_TX));
        txs.push(tx);
      }
      // One wallet approval for every claim transaction.
      const signed = await wallet.signAllTransactions(txs);
      for (const tx of signed) {
        const sig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      }
      setMsg(`claimed ${fmtToken(totalClaimable)} ${TICKER} from ${claimable.length} epoch${claimable.length > 1 ? "s" : ""}`);
      reload();
      refresh().catch(() => {});
    } catch (e) {
      setMsg(`claim failed: ${(e as Error).message?.split("\n")[0]}`);
    } finally {
      setBusy(false);
    }
  }

  const rows = [
    ...(receipts ?? []).map((r) => ({
      epoch: r.epochIndex,
      shares: r.work.shares.toNumber(),
      budget: r.epoch.finalized ? BigInt(r.epoch.budget.toString()) : null,
      reward: r.epoch.finalized ? payout(r) : null,
      status: !r.epoch.finalized ? "mining" : r.epoch.expired ? "expired" : "claim",
    })),
    ...claimed.map((e) => ({
      epoch: e.data.epoch.toNumber(),
      shares: e.data.shares.toNumber(),
      budget: null,
      reward: BigInt(e.data.amount.toString()),
      status: "claimed",
    })),
  ].sort((a, b) => b.epoch - a.epoch);

  return (
    <div className="grid">
      <NoColony />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
        <Panel title="Current epoch" flush>
          <Stats cols={2} style={{ border: 0, borderTop: "1px solid var(--line)" }}>
            <Stat label="Epoch" value={colony ? String(colony.epoch.toNumber()).padStart(3, "0") : "—"} />
            <Stat label="Time remaining" value={colony ? fmtDuration(left) : "—"} />
          </Stats>
          <div className="kv" style={{ padding: 16, borderTop: "1px solid var(--line)" }}>
            <span>Reward budget</span>
            <span style={{ textAlign: "right" }}>{fmtToken(budget, 0)} {TICKER}</span>
            <span>Total shares</span>
            <span style={{ textAlign: "right" }}>{totalShares.toLocaleString("en-US")}</span>
            <span>Your shares</span>
            <span style={{ textAlign: "right" }}>{myShares.toLocaleString("en-US")}</span>
            <span>Est. reward</span>
            <span style={{ textAlign: "right" }} className="green">{fmtToken(est)} {TICKER}</span>
          </div>
        </Panel>

        <Panel title="Claim rewards" flush>
          <Stats cols={2} style={{ border: 0, borderTop: "1px solid var(--line)" }}>
            <Stat label="Available epochs" value={claimable.length} />
            <Stat label="Total claimable" value={`${fmtToken(totalClaimable)} ${TICKER}`} />
          </Stats>
          <div style={{ padding: 16, borderTop: "1px solid var(--line)" }}>
            {publicKey ? (
              <button className="btn btn-primary btn-block" style={{ height: 48 }} disabled={busy || claimable.length === 0} onClick={claimAll}>
                {busy ? "Claiming…" : "Claim rewards →"}
              </button>
            ) : (
              <WalletButton />
            )}
            <div className="dim" style={{ fontSize: 11, marginTop: 10 }}>
              {msg ?? `Claims are signed by your wallet (not the session key). ${CLAIMS_PER_TX} epochs per transaction, one approval. Each claim refunds the work receipt's rent.`}
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Your reward history" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Epoch</th>
                <th className="right">Your shares</th>
                <th className="right">Budget</th>
                <th className="right">Reward</th>
                <th className="right">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">{publicKey ? "no rewards yet: go dig" : "connect a wallet"}</td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={`${r.epoch}-${r.status}-${i}`}>
                  <td>{String(r.epoch).padStart(3, "0")}</td>
                  <td className="right">{r.shares.toLocaleString("en-US")}</td>
                  <td className="right dim">{r.budget !== null ? `${fmtToken(r.budget, 0)} ${TICKER}` : "—"}</td>
                  <td className="right">{r.reward !== null ? `${fmtToken(r.reward)} ${TICKER}` : "…"}</td>
                  <td className="right">
                    {r.status === "claim" ? (
                      <span className="tag tag-solid">claim</span>
                    ) : r.status === "mining" ? (
                      <span className="tag green">mining</span>
                    ) : (
                      <span className="tag dim">{r.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
