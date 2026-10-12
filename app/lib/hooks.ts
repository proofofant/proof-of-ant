"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { colonyPda, epochPda, getProgram, minerPda, workPda, type Epoch, type Miner, type Work } from "./chain";
import { useColony } from "./colony";
import { IS_LOCAL, POLL_SCALE } from "./config";
import { useConnection, useSigner } from "./wallet";

/** Poll an async loader every `ms` while mounted. */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], baseMs = 4000) {
  const ms = baseMs * POLL_SCALE;
  const [data, setData] = useState<T | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    const go = () => run().then((d) => live && setData(d)).catch(() => {});
    go();
    const t = setInterval(go, ms);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [run, ms]);
  return data;
}

/** The connected user's work receipt for the open epoch. */
export function useCurrentWork() {
  const { connection } = useConnection();
  const { publicKey } = useSigner();
  const { colony } = useColony();
  const epoch = colony?.epoch.toNumber();
  return usePoll<Work | null>(
    async () => (publicKey && epoch !== undefined ? getProgram(connection).account.work.fetchNullable(workPda(epoch, publicKey)) : null),
    [connection, publicKey?.toBase58(), epoch],
    3000
  );
}

export type Receipt = { epochIndex: number; work: Work; epoch: Epoch };

/**
 * All unclaimed work receipts of the connected user, with their epochs. Receipts
 * are PDAs, so derive them for every epoch still inside the claim window and read
 * them in one batch (no getProgramAccounts, which free RPC tiers often block).
 */
export function useReceipts(): { receipts: Receipt[] | null; reload: () => void } {
  const { connection } = useConnection();
  const { publicKey } = useSigner();
  const { colony } = useColony();
  const [nonce, setNonce] = useState(0);
  const current = colony?.epoch.toNumber();
  const claimWindow = colony?.claimWindow.toNumber();
  const receipts = usePoll<Receipt[]>(
    async () => {
      if (!publicKey || current === undefined || claimWindow === undefined) return [];
      const program = getProgram(connection);
      const from = Math.max(0, current - claimWindow);
      const indexes = Array.from({ length: current - from + 1 }, (_, i) => from + i);
      const works = await program.account.work.fetchMultiple(indexes.map((i) => workPda(i, publicKey)));
      const mine = indexes.map((i, k) => ({ i, work: works[k] })).filter((x): x is { i: number; work: Work } => !!x.work);
      const epochs = await program.account.epoch.fetchMultiple(mine.map((x) => epochPda(x.i)));
      return mine
        .map((x, k) => ({ epochIndex: x.i, work: x.work, epoch: epochs[k]! }))
        .filter((r) => r.epoch)
        .sort((a, b) => b.epochIndex - a.epochIndex);
    },
    [connection, publicKey?.toBase58(), nonce, current, claimWindow],
    5000
  );
  return { receipts, reload: () => setNonce((n) => n + 1) };
}

/**
 * All miners of the colony (for the leaderboard). Uses getProgramAccounts on localnet or
 * when the RPC serves it (NEXT_PUBLIC_RPC_GPA=1), else the miners seen in the event history.
 */
const GPA = IS_LOCAL || process.env.NEXT_PUBLIC_RPC_GPA === "1";

export function useMiners() {
  const { connection } = useConnection();
  const { events } = useColony();
  const owners = useMemo(
    () => [...new Set(events.filter((e) => e.name === "AntHatched").map((e) => e.data.owner.toBase58() as string))],
    [events]
  );
  return usePoll<{ key: string; account: Miner }[]>(
    async () => {
      const program = getProgram(connection);
      try {
        if (!GPA) throw new Error("getProgramAccounts off");
        const all = await program.account.miner.all([{ memcmp: { offset: 8 + 32, bytes: colonyPda().toBase58() } }]);
        return all.map((m) => ({ key: m.publicKey.toBase58(), account: m.account }));
      } catch {
        const keys = owners.map((o) => minerPda(new PublicKey(o)));
        const accs = await program.account.miner.fetchMultiple(keys);
        return accs.flatMap((a, i) => (a ? [{ key: keys[i].toBase58(), account: a }] : []));
      }
    },
    [connection, owners.join()],
    10000
  );
}

/** Distinct wallets that hatched an ant in the given epoch (from the event feed). */
export function useActiveMiners(epochIndex?: number) {
  const { events } = useColony();
  return useMemo(() => {
    const s = new Set<string>();
    for (const e of events)
      if (e.name === "AntHatched" && e.data.epoch.toNumber() === epochIndex) s.add(e.data.owner.toBase58());
    return s.size;
  }, [events, epochIndex]);
}
