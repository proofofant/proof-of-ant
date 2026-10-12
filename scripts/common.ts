import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { ProofOfAnt } from "../target/types/proof_of_ant";
import { getMint } from "@solana/spl-token";
import { enablePollingConfirmation } from "../app/lib/confirm";

export const ROOT = resolve(__dirname, "..");
/** localnet (default) or devnet. */
export const CLUSTER = process.env.CLUSTER ?? "localnet";
/** RPC: $RPC_URL, else the one the frontend uses for this cluster (app/.env.<cluster>), else the default. */
function envRpc() {
  const f = resolve(ROOT, `app/.env.${CLUSTER}`);
  if (!existsSync(f)) return undefined;
  return readFileSync(f, "utf8").match(/^NEXT_PUBLIC_RPC_URL=(.+)$/m)?.[1].trim();
}
export const RPC =
  process.env.RPC_URL ?? envRpc() ?? (CLUSTER === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899");
export const MINT_FILE = resolve(ROOT, `.keys/${CLUSTER === "localnet" ? "local" : CLUSTER}-mint.json`);

export function loadKeypair(path: string) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

// Hosted RPCs (devnet) may not serve websockets: confirm by polling.
if (CLUSTER !== "localnet") enablePollingConfirmation(Connection);

export function setup() {
  // $KEYPAIR lets a server run the crank with its own key instead of the upgrade authority.
  const authority = loadKeypair(process.env.KEYPAIR ?? resolve(ROOT, ".keys/dev.json"));
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(readFileSync(resolve(ROOT, "target/idl/proof_of_ant.json"), "utf8"));
  const program = new anchor.Program<ProofOfAnt>(idl, provider);
  return { authority, connection, provider, program };
}

export function savedMint(): PublicKey {
  if (process.env.MINT) return new PublicKey(process.env.MINT);
  if (!existsSync(MINT_FILE)) throw new Error(`No ${CLUSTER} colony yet: run the ${CLUSTER} setup first`);
  return new PublicKey(JSON.parse(readFileSync(MINT_FILE, "utf8")).mint);
}

export const u64le = (n: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

export function pdas(programId: PublicKey, mint: PublicKey) {
  const find = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, programId)[0];
  const colony = find(Buffer.from("colony"), mint.toBuffer());
  return {
    colony,
    vault: find(Buffer.from("vault"), colony.toBuffer()),
    epoch: (i: number | bigint) => find(Buffer.from("epoch"), colony.toBuffer(), u64le(i)),
  };
}

/** The mint's token program (classic SPL or Token-2022, e.g. pump.fun coins) and decimals. */
export async function mintInfo(connection: Connection, mint: PublicKey) {
  const acc = await connection.getAccountInfo(mint);
  if (!acc) throw new Error(`mint ${mint.toBase58()} not found on ${CLUSTER}`);
  const tokenProgram = acc.owner;
  const { decimals, mintAuthority } = await getMint(connection, mint, "confirmed", tokenProgram);
  return { tokenProgram, decimals, mintAuthority };
}
