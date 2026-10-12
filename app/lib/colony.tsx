"use client";

import { getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  colonyPda,
  epochPda,
  eventParser,
  getProgram,
  minerPda,
  vaultPda,
  type Colony,
  type Epoch,
  type Miner,
} from "./chain";
import { IS_LOCAL, MINT, POLL_SCALE, PROGRAM_ID } from "./config";
import { useConnection, useSigner } from "./wallet";

export type ColonyEvent = {
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  sig: string;
  ts: number;
};

type ColonyState = {
  colony: Colony | null;
  epoch: Epoch | null;
  vaultAmount: bigint;
  now: number;
  events: ColonyEvent[];
  missing: boolean;
  /** SPL Token or Token-2022, read from the mint's owner. */
  tokenProgram: PublicKey | null;
  refresh: () => Promise<void>;
  /** Connected user's view of the colony. */
  me: {
    miner: Miner | null;
    tokenAccount: PublicKey | null;
    balance: bigint;
    sol: number;
  };
};

const Ctx = createContext<ColonyState | null>(null);
const POLL_MS = 3_000 * POLL_SCALE;
// Backfill: public RPCs count every tx in a batch call, so go smaller and slower there.
const HISTORY = IS_LOCAL ? 200 : 100;
const HISTORY_BATCH = IS_LOCAL ? 50 : 10;
const HISTORY_GAP_MS = IS_LOCAL ? 0 : 800;

function parse(logs: string[], sig: string, ts: number): ColonyEvent[] {
  const out: ColonyEvent[] = [];
  let i = 0;
  try {
    for (const ev of eventParser.parseLogs(logs)) out.push({ id: `${sig}:${i++}`, name: ev.name, data: ev.data, sig, ts });
  } catch {}
  return out;
}

export function ColonyProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const { publicKey } = useSigner();
  const program = useMemo(() => getProgram(connection), [connection]);

  const [colony, setColony] = useState<Colony | null>(null);
  const [epoch, setEpoch] = useState<Epoch | null>(null);
  const [vaultAmount, setVault] = useState(0n);
  const [missing, setMissing] = useState(!MINT);
  const [tokenProgram, setTokenProgram] = useState<PublicKey | null>(null);
  const [events, setEvents] = useState<ColonyEvent[]>([]);
  // 0 until mounted: the clock is read in an effect, never during prerender.
  const [now, setNow] = useState(0);
  const [me, setMe] = useState<ColonyState["me"]>({ miner: null, tokenAccount: null, balance: 0n, sol: 0 });
  const seen = useRef(new Set<string>());

  const addEvents = useCallback((evs: ColonyEvent[]) => {
    const mine = MINT ? colonyPda().toBase58() : "";
    // The program can host several colonies: keep only ours.
    const fresh = evs.filter((e) => !seen.current.has(e.id) && e.data?.colony?.toBase58?.() === mine);
    fresh.forEach((e) => seen.current.add(e.id));
    if (fresh.length) setEvents((prev) => [...fresh, ...prev].sort((a, b) => b.ts - a.ts).slice(0, 500));
  }, []);

  const lastEpoch = useRef(0);
  const load = useCallback(async () => {
    if (!MINT) return;
    // One batched read for everything we poll; a second one only when the epoch moved.
    const ata = publicKey && tokenProgram ? getAssociatedTokenAddressSync(MINT, publicKey, false, tokenProgram) : null;
    const keys = [colonyPda(), epochPda(lastEpoch.current), vaultPda(), ...(publicKey ? [minerPda(publicKey), publicKey] : []), ...(ata ? [ata] : [])];
    const infos = await connection.getMultipleAccountsInfo(keys);
    if (!infos[0]) {
      setMissing(true);
      return;
    }
    setMissing(false);
    const c = program.coder.accounts.decode<Colony>("colony", infos[0].data);
    let epochInfo = infos[1];
    if (c.epoch.toNumber() !== lastEpoch.current || !epochInfo) {
      lastEpoch.current = c.epoch.toNumber();
      epochInfo = await connection.getAccountInfo(epochPda(c.epoch));
    }
    if (!tokenProgram) {
      const owner = (await connection.getAccountInfo(c.mint))?.owner ?? null;
      setTokenProgram((tp) => (tp && owner && tp.equals(owner) ? tp : owner));
    }
    setColony(c);
    if (epochInfo) setEpoch(program.coder.accounts.decode<Epoch>("epoch", epochInfo.data));
    const vault = infos[2] ? unpackAccount(keys[2], infos[2], infos[2].owner) : null;
    setVault(vault?.amount ?? 0n);

    if (publicKey) {
      const minerInfo = infos[3], walletInfo = infos[4], ataInfo = ata ? infos[5] : null;
      const acc = ata && ataInfo ? unpackAccount(ata, ataInfo, ataInfo.owner) : null;
      setMe({
        miner: minerInfo ? program.coder.accounts.decode<Miner>("miner", minerInfo.data) : null,
        tokenAccount: acc ? ata : null,
        balance: acc?.amount ?? 0n,
        sol: (walletInfo?.lamports ?? 0) / 1e9,
      });
    } else {
      setMe({ miner: null, tokenAccount: null, balance: 0n, sol: 0 });
    }
  }, [program, connection, publicKey, tokenProgram]);

  // Coalesce bursts (the miner refreshes after every ant) into one read at a time.
  // The loop always runs the latest `load`, never one captured before the wallet connected.
  const loadRef = useRef(load);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    inflight.current = (async () => {
      try {
        do {
          again.current = false;
          await loadRef.current();
        } while (again.current);
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  // New wallet or token program: swap in the new loader and read right away.
  useEffect(() => {
    loadRef.current = load;
    refresh().catch((e) => console.warn("colony refresh failed:", e?.message ?? e));
  }, [load, refresh]);

  // Accounts: poll. Clock: tick every second.
  useEffect(() => {
    refresh().catch((e) => console.warn("colony refresh failed:", e?.message ?? e));
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => refresh().catch((e) => console.warn("colony refresh failed:", e?.message ?? e)), POLL_MS);
    const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [refresh]);

  // Events: backfill from the colony's transaction history, then follow new ones
  // (log stream on localnet; signature polling elsewhere, hosted RPCs lack websockets).
  useEffect(() => {
    if (!MINT) return;
    let stop = false;
    let newest: string | undefined;
    const load = async (sigs: { signature: string; err: unknown; blockTime?: number | null }[]) => {
      for (let i = 0; i < sigs.length && !stop; i += HISTORY_BATCH) {
        if (i && HISTORY_GAP_MS) await new Promise((r) => setTimeout(r, HISTORY_GAP_MS));
        const chunk = sigs.slice(i, i + HISTORY_BATCH).filter((s) => !s.err);
        const get = () => connection.getTransactions(chunk.map((s) => s.signature), { maxSupportedTransactionVersion: 0 });
        // One retry: public RPCs rate-limit big batch calls.
        const txs = await get().catch(() => new Promise<Awaited<ReturnType<typeof get>>>((r) => setTimeout(() => get().then(r, () => r([])), 1500)));
        addEvents(
          txs.flatMap((tx, j) =>
            tx?.meta?.logMessages ? parse(tx.meta.logMessages, chunk[j].signature, tx.blockTime ?? chunk[j].blockTime ?? 0) : []
          )
        );
      }
    };
    (async () => {
      const sigs = await connection.getSignaturesForAddress(colonyPda(), { limit: HISTORY }).catch(() => []);
      newest = sigs[0]?.signature;
      await load(sigs);
    })();

    if (IS_LOCAL) {
      const sub = connection.onLogs(PROGRAM_ID, (l) => {
        if (!l.err) addEvents(parse(l.logs, l.signature, Math.floor(Date.now() / 1000)));
      });
      return () => {
        stop = true;
        connection.removeOnLogsListener(sub).catch(() => {});
      };
    }
    const t = setInterval(async () => {
      const sigs = await connection.getSignaturesForAddress(colonyPda(), newest ? { until: newest, limit: 50 } : { limit: 50 }).catch(() => []);
      if (!sigs.length || stop) return;
      newest = sigs[0].signature;
      await load(sigs);
    }, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [connection, addEvents]);

  const value = useMemo(
    () => ({ colony, epoch, vaultAmount, now, events, missing, tokenProgram, refresh, me }),
    [colony, epoch, vaultAmount, now, events, missing, tokenProgram, refresh, me]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useColony() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useColony outside ColonyProvider");
  return c;
}
