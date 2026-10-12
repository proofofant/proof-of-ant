import { AnchorProvider, BN, BorshCoder, EventParser, Program, type IdlAccounts } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { DECIMALS, MINT, PROGRAM_ID } from "./config";
import idl from "./idl.json";
import type { ProofOfAnt } from "./proof_of_ant";

export type Colony = IdlAccounts<ProofOfAnt>["colony"];
export type Epoch = IdlAccounts<ProofOfAnt>["epoch"];
export type Miner = IdlAccounts<ProofOfAnt>["miner"];
export type Work = IdlAccounts<ProofOfAnt>["work"];

export const CASTES = ["worker", "soldier", "winged", "queen"] as const;
export type Caste = (typeof CASTES)[number];
export const CASTE_SHARES = [1, 16, 256, 65_536];

/** Read-only wallet so the program can be used before anyone connects. */
const READONLY: AnchorWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction | VersionedTransaction>(t: T) => t,
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(t: T[]) => t,
};

/** Wrap a local keypair (burner or session key) as an Anchor wallet. */
export function keypairWallet(kp: Keypair): AnchorWallet {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  };
  return {
    publicKey: kp.publicKey,
    signTransaction: async (tx) => sign(tx),
    signAllTransactions: async (txs) => txs.map(sign),
  };
}

export function getProgram(connection: Connection, wallet?: AnchorWallet | null) {
  const provider = new AnchorProvider(connection, wallet ?? READONLY, { commitment: "confirmed" });
  return new Program<ProofOfAnt>({ ...(idl as ProofOfAnt), address: PROGRAM_ID.toBase58() }, provider);
}

export const eventParser = new EventParser(PROGRAM_ID, new BorshCoder(idl as ProofOfAnt));

// ── PDAs ──
const u64le = (n: number | bigint | BN) => new BN(n.toString()).toArrayLike(Buffer, "le", 8);
const find = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

export const colonyPda = (mint: PublicKey = MINT!) => find(Buffer.from("colony"), mint.toBuffer());
export const vaultPda = (colony = colonyPda()) => find(Buffer.from("vault"), colony.toBuffer());
export const epochPda = (i: number | BN, colony = colonyPda()) =>
  find(Buffer.from("epoch"), colony.toBuffer(), u64le(i));
export const minerPda = (owner: PublicKey, colony = colonyPda()) =>
  find(Buffer.from("miner"), colony.toBuffer(), owner.toBuffer());
export const workPda = (i: number | BN, owner: PublicKey, colony = colonyPda()) =>
  find(Buffer.from("work"), colony.toBuffer(), u64le(i), owner.toBuffer());

// ── math ──
export const TWO64 = 1n << 64n;
export const big = (b: BN | number) => BigInt(b.toString());

/** Expected hashes per ant at a given target. */
export const hashesPerAnt = (target: BN) => Number(TWO64 / (big(target) || 1n));

/** Colony hashrate estimate from the open epoch: ants × hashes/ant ÷ elapsed. */
export function colonyHashrate(epoch: Epoch, nowSec: number) {
  const elapsed = Math.max(1, nowSec - epoch.startTs.toNumber());
  return (epoch.ants.toNumber() * hashesPerAnt(epoch.target)) / elapsed;
}

/** Budget the open epoch would lock if it closed now. */
export function projectedBudget(colony: Colony, vaultAmount: bigint) {
  const free = vaultAmount > big(colony.reserved) ? vaultAmount - big(colony.reserved) : 0n;
  return (free * BigInt(colony.emissionBps)) / 10_000n;
}

export function lifetimeShares(m: Miner) {
  return m.castes.reduce((s, c, i) => s + c.toNumber() * CASTE_SHARES[i], 0);
}

export function bestCaste(m: Miner): Caste | null {
  for (let i = 3; i >= 0; i--) if (m.castes[i].toNumber() > 0) return CASTES[i];
  return null;
}

// ── formatting ──
export function fmtToken(raw: bigint | BN | number, digits = 2) {
  const v = Number(typeof raw === "bigint" ? raw : big(raw as BN)) / 10 ** DECIMALS;
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: v < 1000 ? digits : 0 });
}

export function fmtHashrate(hps: number) {
  const units = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s"];
  let i = 0;
  while (hps >= 1000 && i < units.length - 1) {
    hps /= 1000;
    i++;
  }
  return `${hps.toFixed(hps < 10 ? 2 : hps < 100 ? 1 : 0)} ${units[i]}`;
}

export const short = (k: PublicKey | string, n = 4) => {
  const s = k.toString();
  return `${s.slice(0, n)}…${s.slice(-n)}`;
};

export function fmtDuration(sec: number) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

export function fmtAgo(tsSec: number, nowSec: number) {
  const d = Math.max(0, nowSec - tsSec);
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export const hex = (b: number[] | Uint8Array, n = 8) =>
  Array.from(b.slice(0, n), (x) => x.toString(16).padStart(2, "0")).join("");

/** Solana Explorer link for a tx or address on the configured cluster. */
export function explorer(kind: "tx" | "address", id: string) {
  const cluster = process.env.NEXT_PUBLIC_CLUSTER ?? "localnet";
  const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
  const q =
    cluster === "mainnet" ? "" : cluster === "localnet" ? `?cluster=custom&customUrl=${encodeURIComponent(rpc)}` : `?cluster=${cluster}`;
  return `https://explorer.solana.com/${kind}/${id}${q}`;
}
