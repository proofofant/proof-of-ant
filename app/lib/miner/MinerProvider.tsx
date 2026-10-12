"use client";

import { BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_SLOT_HASHES_PUBKEY, SystemProgram } from "@solana/web3.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CASTES,
  CASTE_SHARES,
  colonyPda,
  epochPda,
  fmtHashrate,
  fmtToken,
  getProgram,
  hex,
  keypairWallet,
  minerPda,
  vaultPda,
  workPda,
  type Caste,
} from "../chain";
import { useColony } from "../colony";
import { POLL_SCALE, TICKER } from "../config";
import { useConnection, useSigner } from "../wallet";
import { fromU64, midstate, toU64, type U64 } from "./sha256";
import type { StartMsg, WorkerMsg } from "./worker";

export type Power = "low" | "normal" | "max";
const DUTY: Record<Power, number> = { low: 0.35, normal: 0.75, max: 1 };
const SESSION_FUND_SOL = 0.02;
const SESSION_MIN_SOL = 0.004;

export type LogLine = { id: number; t: number; text: string; kind?: "ok" | "bad" | "dim" | "accent" | "gold" };
export type Blocker = null | "connect" | "food" | "session" | "sol" | "colony";

type Round = {
  job: number;
  epoch: number;
  epochStart: number;
  duration: number;
  counter: bigint;
  target: bigint;
  mid: Uint32Array;
  ownerToken: PublicKey;
};
/** Solutions allowed in flight before the miner waits for confirmations. */
const MAX_PIPELINE = 3;
// Hosted RPC free tiers allow ~1 sendTransaction/s: space the digs out off localnet.
const SEND_GAP_MS = POLL_SCALE > 1 ? 1100 : 0;
let nextSend = 0;
async function sendSlot() {
  const now = Date.now();
  const at = Math.max(now, nextSend);
  nextSend = at + SEND_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

type MinerState = {
  running: boolean;
  submitting: boolean;
  threads: number;
  maxThreads: number;
  power: Power;
  hashrate: number;
  history: number[];
  tried: number;
  valid: number;
  failed: number;
  best: Caste | null;
  log: LogLine[];
  blocker: Blocker;
  session: { pubkey: PublicKey; sol: number } | null;
  startedAt: number | null;
  setThreads: (n: number) => void;
  setPower: (p: Power) => void;
  start: () => void;
  stop: () => void;
  reset: () => void;
  authorizeSession: () => Promise<void>;
};

const Ctx = createContext<MinerState | null>(null);

function casteOf(hash: Uint8Array, target: bigint): number {
  const h = new DataView(hash.buffer, hash.byteOffset).getBigUint64(0, false);
  if (h < target >> 16n) return 3;
  if (h < target >> 8n) return 2;
  if (h < target >> 4n) return 1;
  return 0;
}

const errCode = (e: unknown) => {
  const x = e as { error?: { errorCode?: { code?: string } }; message?: string };
  return x?.error?.errorCode?.code ?? x?.message?.split("\n")[0] ?? String(e);
};

function loadSession(owner: PublicKey): Keypair {
  const key = `poa.session.${owner.toBase58()}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {}
  const kp = Keypair.generate();
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(kp.secretKey)));
  } catch {}
  return kp;
}

export function MinerProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const signer = useSigner();
  const { refresh } = useColony();

  // The core count is only known in the browser: read it after hydration.
  const [maxThreads, setMaxThreads] = useState(4);
  const [threads, setThreadsState] = useState(3);
  useEffect(() => {
    const cores = Math.max(1, navigator.hardwareConcurrency || 4);
    setMaxThreads(cores);
    setThreadsState(Math.max(1, Math.min(8, cores - 1)));
  }, []);
  const [power, setPowerState] = useState<Power>("normal");
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hashrate, setHashrate] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [tried, setTried] = useState(0);
  const [valid, setValid] = useState(0);
  const [failed, setFailed] = useState(0);
  const [best, setBest] = useState<Caste | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [blocker, setBlocker] = useState<Blocker>(null);
  const [session, setSession] = useState<MinerState["session"]>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const workers = useRef<Worker[]>([]);
  const runningRef = useRef(false);
  const roundRef = useRef<Round | null>(null);
  const jobSeq = useRef(0);
  const hashAcc = useRef(0);
  const logSeq = useRef(0);
  const settings = useRef({ threads, power });
  settings.current = { threads, power };
  const signerRef = useRef(signer);
  signerRef.current = signer;

  const say = useCallback((text: string, kind?: LogLine["kind"]) => {
    setLog((l) => [...l.slice(-199), { id: logSeq.current++, t: Date.now(), text, kind }]);
  }, []);

  const stopWorkers = useCallback(() => {
    jobSeq.current++;
    workers.current.forEach((w) => w.postMessage({ type: "stop" }));
  }, []);

  /** Who signs `dig`: the burner itself, or the owner's session key. */
  const digger = useCallback(() => {
    const s = signerRef.current;
    if (!s.wallet || !s.publicKey) return null;
    if (s.kind === "burner") return { wallet: s.wallet, key: s.publicKey, session: null as Keypair | null };
    const kp = loadSession(s.publicKey);
    return { wallet: keypairWallet(kp), key: kp.publicKey, session: kp };
  }, []);

  const startRoundRef = useRef<() => Promise<void>>(async () => {});
  const launchRef = useRef<(r: Omit<Round, "job">) => void>(() => {});
  const onFoundRef = useRef<(job: number, nonce: U64, hash: Uint8Array) => Promise<void>>(async () => {});

  const ensureWorkers = useCallback((n: number) => {
    while (workers.current.length < n) {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<WorkerMsg>) => {
        const m = e.data;
        if (m.job !== roundRef.current?.job) return;
        hashAcc.current += m.hashes;
        setTried((t) => t + m.hashes);
        if (m.type === "found") onFoundRef.current(m.job, m.nonce, m.hash);
      };
      workers.current.push(w);
    }
    while (workers.current.length > n) workers.current.pop()!.terminate();
  }, []);

  /** Point every worker at `round` (a fresh job id invalidates older results). */
  const launch = (round: Omit<Round, "job">) => {
    const job = ++jobSeq.current;
    roundRef.current = { ...round, job };
    ensureWorkers(settings.current.threads);
    const duty = DUTY[settings.current.power];
    workers.current.forEach((w) => {
      const start = { hi: (Math.random() * 2 ** 32) >>> 0, lo: 0 };
      w.postMessage({
        type: "start", job, mid: round.mid, counter: toU64(round.counter), target: toU64(round.target), start, duty,
      } satisfies StartMsg);
    });
  };

  launchRef.current = launch;

  startRoundRef.current = async () => {
    if (!runningRef.current) return;
    const s = signerRef.current;
    if (!s.wallet || !s.publicKey) {
      setBlocker("connect");
      say("no wallet connected", "bad");
      return halt();
    }
    const owner = s.publicKey;
    const d = digger()!;
    const program = getProgram(connection, d.wallet);
    try {
      let colony = await program.account.colony.fetchNullable(colonyPda());
      if (!colony) {
        setBlocker("colony");
        say("colony not found", "bad");
        return halt();
      }
      let epoch = await program.account.epoch.fetch(epochPda(colony.epoch));

      // Holding requirement ("an ant needs food").
      // The program checks one token account, so use the fullest one.
      const accounts = await connection
        .getParsedTokenAccountsByOwner(owner, { mint: colony.mint })
        .then((r) => r.value)
        .catch(() => []);
      const amountOf = (a: (typeof accounts)[number]) => BigInt(a.account.data.parsed.info.tokenAmount.amount);
      const fullest = accounts.sort((a, b) => (amountOf(b) > amountOf(a) ? 1 : -1))[0];
      const bal = fullest ? amountOf(fullest) : 0n;
      if (!fullest || bal < BigInt(colony.minHold.toString())) {
        setBlocker("food");
        say(`need ≥ ${fmtToken(colony.minHold, 0)} ${TICKER} to mine (have ${fmtToken(bal, 0)})`, "bad");
        return halt();
      }

      // Session key must be authorized and funded (not needed for burners).
      const miner = await program.account.miner.fetchNullable(minerPda(owner));
      if (d.session) {
        const sol = (await connection.getBalance(d.key)) / LAMPORTS_PER_SOL;
        setSession({ pubkey: d.key, sol });
        if (!miner || !miner.session.equals(d.key)) {
          setBlocker("session");
          say("session key not authorized: approve it once in your wallet", "bad");
          return halt();
        }
        if (sol < SESSION_MIN_SOL) {
          setBlocker("sol");
          say(`session key low on SOL (${sol.toFixed(4)})`, "bad");
          return halt();
        }
      }

      // Anyone may close an epoch that is over; the miner does it itself.
      const now = Math.floor(Date.now() / 1000);
      if (now - epoch.startTs.toNumber() >= colony.epochDuration.toNumber()) {
        say(`epoch ${colony.epoch} over → advance_epoch`, "dim");
        await program.methods
          .advanceEpoch()
          .accountsPartial({
            cranker: d.key,
            colony: colonyPda(),
            vault: vaultPda(),
            currentEpoch: epochPda(colony.epoch),
            nextEpoch: epochPda(colony.epoch.addn(1)),
            slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
          })
          .rpc()
          .catch((e) => say(`advance skipped (${errCode(e)})`, "dim"));
        colony = await program.account.colony.fetch(colonyPda());
        epoch = await program.account.epoch.fetch(epochPda(colony.epoch));
      }

      setBlocker(null);
      const counter = BigInt(miner?.counter.toString() ?? 0);
      launch({
        epoch: colony.epoch.toNumber(),
        epochStart: epoch.startTs.toNumber(),
        duration: colony.epochDuration.toNumber(),
        counter,
        target: BigInt(epoch.target.toString()),
        mid: midstate(Uint8Array.from(epoch.challenge), owner.toBytes()),
        ownerToken: fullest.pubkey,
      });
      say(`challenge ${hex(epoch.challenge, 4)}… · epoch ${colony.epoch} · counter ${counter}`, "dim");
    } catch (e) {
      say(`round failed: ${errCode(e)}`, "bad");
      setTimeout(() => startRoundRef.current(), 3000);
    }
  };

  // Submission pipeline: solutions are sent in counter order while the
  // workers already search for the next counter.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const generation = useRef(0);
  const parked = useRef<Omit<Round, "job"> | null>(null);

  const submit = async (r: Round, nonce: bigint, caste: number, gen: number) => {
    const s = signerRef.current;
    const d = digger();
    try {
      if (gen !== generation.current || !s.publicKey || !d) return;
      await sendSlot();
      if (gen !== generation.current) return;
      const sig = await getProgram(connection, d.wallet)
        .methods.dig(new BN(nonce.toString()))
        .accountsPartial({
          digger: d.key,
          owner: s.publicKey,
          colony: colonyPda(),
          epoch: epochPda(r.epoch),
          miner: minerPda(s.publicKey),
          work: workPda(r.epoch, s.publicKey),
          ownerToken: r.ownerToken,
        })
        .rpc();
      say(`tx confirmed ${sig.slice(0, 8)}… · caste ${CASTES[caste]} · +${CASTE_SHARES[caste]} shares`,
        caste === 3 ? "gold" : caste > 0 ? "accent" : "ok");
      setValid((v) => v + 1);
      setBest((b) => (b === null || CASTES.indexOf(b) < caste ? CASTES[caste] : b));
      refresh().catch(() => {});
    } catch (e) {
      if (gen !== generation.current) return;
      // Everything queued after this one was mined on a wrong counter.
      generation.current++;
      parked.current = null;
      stopWorkers();
      roundRef.current = null;
      setFailed((f) => f + 1);
      say(`dig rejected: ${errCode(e)}`, "bad");
    } finally {
      pending.current--;
      setSubmitting(pending.current > 0);
      if (runningRef.current && pending.current === 0 && !roundRef.current) {
        const next = parked.current;
        parked.current = null;
        if (next) launch(next);
        else startRoundRef.current();
      } else if (runningRef.current && parked.current && pending.current < MAX_PIPELINE) {
        const next = parked.current;
        parked.current = null;
        launch(next);
      }
    }
  };

  onFoundRef.current = async (job, nonce, hash) => {
    const r = roundRef.current;
    if (!r || r.job !== job) return;
    const n = fromU64(nonce);
    const caste = casteOf(hash, r.target);
    say(`nonce ${n} → valid share`, "ok");

    // The next counter is known (+1), so keep digging while this one lands.
    const { job: _job, ...rest } = r;
    void _job;
    const next = { ...rest, counter: r.counter + 1n };
    pending.current++;
    setSubmitting(true);
    if (pending.current < MAX_PIPELINE) launch(next);
    else {
      stopWorkers();
      roundRef.current = null;
      parked.current = next;
    }
    const gen = generation.current;
    chain.current = chain.current.then(() => submit(r, n, caste, gen));
  };

  function halt() {
    runningRef.current = false;
    setRunning(false);
    stopWorkers();
    roundRef.current = null;
    parked.current = null;
  }

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setStartedAt(Date.now());
    say("miner booted");
    say(`workers online ${".".repeat(6)} ${settings.current.threads}`);
    startRoundRef.current();
  }, [say]);

  const stop = useCallback(() => {
    halt();
    say("miner stopped", "dim");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say]);

  const reset = useCallback(() => {
    setTried(0);
    setValid(0);
    setFailed(0);
    setBest(null);
    setLog([]);
    setHistory([]);
  }, []);

  const authorizeSession = useCallback(async () => {
    const s = signerRef.current;
    if (!s.wallet || !s.publicKey || s.kind !== "adapter") return;
    const kp = loadSession(s.publicKey);
    const program = getProgram(connection, s.wallet);
    say("authorizing session key + funding it…", "dim");
    try {
      await program.methods
        .setSession(kp.publicKey)
        .accountsPartial({ owner: s.publicKey, colony: colonyPda(), miner: minerPda(s.publicKey) })
        .preInstructions([
          SystemProgram.transfer({
            fromPubkey: s.publicKey,
            toPubkey: kp.publicKey,
            lamports: SESSION_FUND_SOL * LAMPORTS_PER_SOL,
          }),
        ])
        .rpc();
      say(`session ${kp.publicKey.toBase58().slice(0, 6)}… authorized, ${SESSION_FUND_SOL} SOL for fees`, "ok");
      setBlocker(null);
      setSession({ pubkey: kp.publicKey, sol: (await connection.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL });
    } catch (e) {
      say(`session not authorized: ${errCode(e)}`, "bad");
    }
  }, [connection, say]);

  const setThreads = useCallback((n: number) => {
    setThreadsState(Math.max(1, Math.min(maxThreads, n)));
  }, [maxThreads]);
  const setPower = useCallback((p: Power) => setPowerState(p), []);

  // Apply thread/power changes to a running miner: same round, new workers.
  useEffect(() => {
    if (runningRef.current && roundRef.current) {
      const { job: _job, ...rest } = roundRef.current;
      void _job;
      stopWorkers();
      launchRef.current(rest);
    }
  }, [threads, power, stopWorkers]);

  // Hashrate meter + periodic log line.
  useEffect(() => {
    let last = performance.now();
    let ticks = 0;
    const t = setInterval(() => {
      const now = performance.now();
      const rate = (hashAcc.current * 1000) / (now - last);
      hashAcc.current = 0;
      last = now;
      setHashrate((h) => (runningRef.current ? (h ? h * 0.6 + rate * 0.4 : rate) : 0));
      if (runningRef.current) {
        setHistory((hs) => [...hs.slice(-39), rate]);
        if (++ticks % 15 === 0 && rate > 0) say(`hashrate ${".".repeat(12)} ${fmtHashrate(rate)}`, "dim");
      }
    }, 1000);
    return () => clearInterval(t);
  }, [say]);

  // Restart when someone else opens a new epoch (our challenge is stale).
  useEffect(() => {
    const t = setInterval(async () => {
      const r = roundRef.current;
      if (!runningRef.current || !r) return;
      const c = await getProgram(connection).account.colony.fetchNullable(colonyPda()).catch(() => null);
      if (!c || roundRef.current?.job !== r.job || pending.current > 0) return;
      const over = Date.now() / 1000 - r.epochStart >= r.duration;
      if (c.epoch.toNumber() !== r.epoch || over) {
        say(c.epoch.toNumber() !== r.epoch ? `epoch ${c.epoch} opened → new challenge` : `epoch ${r.epoch} is over`, "accent");
        stopWorkers();
        roundRef.current = null;
        startRoundRef.current();
      }
    }, 4000 * POLL_SCALE);
    return () => clearInterval(t);
  }, [connection, say, stopWorkers]);

  // Stop when the wallet changes.
  useEffect(() => {
    if (runningRef.current) {
      halt();
      say("wallet changed: miner stopped", "dim");
    }
    setSession(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer.publicKey?.toBase58()]);

  useEffect(() => () => workers.current.forEach((w) => w.terminate()), []);

  const value = useMemo<MinerState>(
    () => ({
      running, submitting, threads, maxThreads, power, hashrate, history, tried, valid, failed, best, log,
      blocker, session, startedAt, setThreads, setPower, start, stop, reset, authorizeSession,
    }),
    [running, submitting, threads, maxThreads, power, hashrate, history, tried, valid, failed, best, log,
      blocker, session, startedAt, setThreads, setPower, start, stop, reset, authorizeSession]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMiner() {
  const m = useContext(Ctx);
  if (!m) throw new Error("useMiner outside MinerProvider");
  return m;
}
