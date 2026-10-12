/**
 * Founds a colony: a test mint, the colony, initial vault food, and the
 * frontend env (app/.env.<cluster>, also copied to app/.env.local).
 *
 *   npm run local:validator && npm run local:setup     # localnet
 *   npm run devnet:setup                                # devnet (fund .keys/dev.json first)
 *   MINT=<address> npm run devnet:setup                 # devnet, on an existing token (e.g. a pump.fun coin)
 *
 * With MINT the token is not created: the colony is founded on that mint, and the
 * initial vault food comes from the dev wallet's own balance, if it has any.
 */
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { copyFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { CLUSTER, MINT_FILE, ROOT, RPC, mintInfo, pdas, setup } from "./common";

const INITIAL_FOOD = 500_000;

async function main() {
  const { authority, connection, program } = setup();

  if (CLUSTER === "localnet") {
    await connection.confirmTransaction(
      await connection.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL),
      "confirmed"
    );
  } else {
    const sol = (await connection.getBalance(authority.publicKey)) / LAMPORTS_PER_SOL;
    console.log(`${CLUSTER}: authority ${authority.publicKey.toBase58()} has ${sol} SOL`);
    if (sol < 0.5) throw new Error("fund the authority with at least 0.5 SOL first");
  }

  const existing = process.env.MINT ? new PublicKey(process.env.MINT) : null;
  const mint = existing ?? (await createMint(connection, authority, authority.publicKey, null, 6));
  const { tokenProgram, decimals } = await mintInfo(connection, mint);
  const UNIT = 10 ** decimals;
  const { colony, vault, epoch } = pdas(program.programId, mint);
  if (await connection.getAccountInfo(colony)) throw new Error(`a colony already exists for ${mint.toBase58()}`);
  console.log(`mint ${mint.toBase58()} (${tokenProgram.equals(TOKEN_PROGRAM_ID) ? "spl-token" : "token-2022"}, ${decimals} decimals)`);

  // A JS miner does ~1-3 MH/s per thread: aim for an ant every few seconds.
  const hashesPerAnt = 8_000_000n;
  const params = {
    initialTarget: new BN(((1n << 64n) / hashesPerAnt).toString()),
    // Difficulty floor: never fewer than 1M hashes per ant, however quiet the colony.
    maxTarget: new BN(((1n << 64n) / 1_000_000n).toString()),
    targetAntsPerEpoch: 600,
    epochDuration: new BN(1800),
    emissionBps: 1000,
    minHold: new BN(1_000 * UNIT),
    maxAntsPerEpoch: 3000,
    claimWindow: new BN(48),
  };

  await program.methods
    .initColony(params)
    .accountsPartial({
      authority: authority.publicKey,
      mint,
      colony,
      vault,
      epoch: epoch(0),
      slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
      tokenProgram,
    })
    .rpc();

  // Initial food: as if the first creator fees were already bought back. A test mint
  // is minted here; an existing token feeds from what the dev wallet holds.
  const ata = await getOrCreateAssociatedTokenAccount(
    connection, authority, mint, authority.publicKey, false, "confirmed", undefined, tokenProgram
  );
  if (!existing) {
    await mintTo(connection, authority, mint, ata.address, authority, 100_000_000 * UNIT, [], undefined, tokenProgram);
  }
  const held = (await connection.getTokenAccountBalance(ata.address)).value.amount;
  const food = BigInt(Math.min(Number(held), INITIAL_FOOD * UNIT));
  if (food > 0n) {
    await program.methods
      .depositRewards(new BN(food.toString()))
      .accountsPartial({
        depositor: authority.publicKey,
        colony,
        mint,
        vault,
        depositorToken: ata.address,
        tokenProgram,
      })
      .rpc();
    console.log(`vault fed with ${Number(food) / UNIT} tokens`);
  } else {
    console.log("dev wallet holds no tokens: the vault starts empty");
  }

  writeFileSync(MINT_FILE, JSON.stringify({ mint: mint.toBase58(), colony: colony.toBase58() }, null, 2));
  const env = resolve(ROOT, `app/.env.${CLUSTER}`);
  writeFileSync(
    env,
    [
      `NEXT_PUBLIC_CLUSTER=${CLUSTER}`,
      `NEXT_PUBLIC_RPC_URL=${RPC}`,
      `NEXT_PUBLIC_PROGRAM_ID=${program.programId.toBase58()}`,
      `NEXT_PUBLIC_MINT=${mint.toBase58()}`,
      `NEXT_PUBLIC_TOKEN_DECIMALS=${decimals}`,
      `FAUCET_KEYPAIR=${resolve(ROOT, ".keys/dev.json")}`,
      "NEXT_PUBLIC_DEV_TOOLS=1",
      "",
    ].join("\n")
  );
  copyFileSync(env, resolve(ROOT, "app/.env.local"));

  console.log("colony founded");
  console.log("  mint  ", mint.toBase58());
  console.log("  colony", colony.toBase58());
  console.log("  vault ", vault.toBase58());
  console.log(`wrote app/.env.${CLUSTER} (active as app/.env.local)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
