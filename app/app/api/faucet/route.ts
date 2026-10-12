import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transferChecked,
} from "@solana/spl-token";
import { readFileSync } from "fs";
import { enablePollingConfirmation } from "@/lib/confirm";

/** Test-network faucet so a fresh wallet can mine: SOL for fees plus 5,000 test tokens. */
const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER;
// Localnet SOL is free (airdrop); devnet SOL comes out of the dev wallet, so keep it small.
const SOL = CLUSTER === "localnet" ? 2 : 0.1;
const TOKENS = 5_000;
const COOLDOWN_MS = 60 * 60 * 1000;
const lastDrip = new Map<string, number>();
if (CLUSTER !== "localnet") enablePollingConfirmation();

export async function POST(request: Request) {
  const devTools = CLUSTER === "localnet" || process.env.NEXT_PUBLIC_DEV_TOOLS === "1";
  if (!devTools || !process.env.FAUCET_KEYPAIR || !process.env.NEXT_PUBLIC_MINT) {
    return Response.json({ error: "faucet is only available on test networks" }, { status: 404 });
  }
  let wallet: PublicKey;
  try {
    wallet = new PublicKey((await request.json()).wallet);
  } catch {
    return Response.json({ error: "bad wallet" }, { status: 400 });
  }
  const key = wallet.toBase58();
  if (CLUSTER === "devnet" && Date.now() - (lastDrip.get(key) ?? 0) < COOLDOWN_MS) {
    return Response.json({ error: "already dripped, try again in an hour" }, { status: 429 });
  }

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(process.env.FAUCET_KEYPAIR, "utf8")))
  );
  const connection = new Connection(process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
  const mint = new PublicKey(process.env.NEXT_PUBLIC_MINT);

  let tokens = 0;
  try {
    if (CLUSTER === "localnet") {
      await connection.confirmTransaction(await connection.requestAirdrop(wallet, SOL * LAMPORTS_PER_SOL), "confirmed");
    } else if ((await connection.getBalance(wallet)) < SOL * LAMPORTS_PER_SOL) {
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: wallet, lamports: SOL * LAMPORTS_PER_SOL })
        ),
        [authority]
      );
    }
    // Hosted RPC free tiers allow ~1 sendTransaction/s.
    const pause = () => new Promise((r) => setTimeout(r, CLUSTER === "devnet" ? 1100 : 0));
    await pause();
    // A test mint is ours to mint; a real coin (pump.fun, Token-2022) is handed out
    // from the dev wallet's own balance while it lasts.
    const tokenProgram = (await connection.getAccountInfo(mint))!.owner;
    const { decimals, mintAuthority } = await getMint(connection, mint, "confirmed", tokenProgram);
    const amount = BigInt(TOKENS) * 10n ** BigInt(decimals);
    const source = getAssociatedTokenAddressSync(mint, authority.publicKey, false, tokenProgram);
    const ours = mintAuthority?.equals(authority.publicKey) ?? false;
    const held = ours ? amount : await getAccount(connection, source, "confirmed", tokenProgram).then((a) => a.amount, () => 0n);
    if (held >= amount) {
      const ata = await getOrCreateAssociatedTokenAccount(
        connection, authority, mint, wallet, false, "confirmed", undefined, tokenProgram
      );
      await pause();
      if (ours) await mintTo(connection, authority, mint, ata.address, authority, amount, [], undefined, tokenProgram);
      else
        await transferChecked(
          connection, authority, source, mint, ata.address, authority, amount, decimals, [], undefined, tokenProgram
        );
      tokens = TOKENS;
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message.split("\n")[0] }, { status: 500 });
  }
  lastDrip.set(key, Date.now());
  return Response.json({ ok: true, sol: SOL, tokens });
}
