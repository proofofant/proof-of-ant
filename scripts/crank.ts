/**
 * Keeper: advances epochs when they are over and, with --buybacks,
 * simulates creator-fee buybacks landing in the vault.
 *
 *   npm run local:crank -- --buybacks
 *   npm run devnet:crank -- --buybacks
 */
import { BN } from "@coral-xyz/anchor";
import { SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { CLUSTER, mintInfo, pdas, savedMint, setup } from "./common";

// Slower on hosted RPCs to save request credits.
const TICK_MS = CLUSTER === "localnet" ? 5_000 : 15_000;
const BUYBACK_EVERY_MS = 45_000;

async function main() {
  const { authority, connection, program } = setup();
  const mint = savedMint();
  const { colony, vault, epoch } = pdas(program.programId, mint);
  const { tokenProgram, decimals } = await mintInfo(connection, mint);
  const unit = 10 ** decimals;
  const depositorToken = getAssociatedTokenAddressSync(
    mint,
    authority.publicKey,
    false,
    tokenProgram
  );
  const buybacks = process.argv.includes("--buybacks");
  let lastBuyback = 0;

  console.log(
    `crank: colony ${colony.toBase58()}${
      buybacks ? " (simulated buybacks on)" : ""
    }`
  );

  for (;;) {
    try {
      const c = await program.account.colony.fetch(colony);
      const current = await program.account.epoch.fetch(
        epoch(c.epoch.toNumber())
      );
      const slot = await connection.getSlot();
      const now =
        (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);

      if (now - current.startTs.toNumber() >= c.epochDuration.toNumber()) {
        await program.methods
          .advanceEpoch()
          .accountsPartial({
            cranker: authority.publicKey,
            colony,
            vault,
            currentEpoch: epoch(c.epoch.toNumber()),
            nextEpoch: epoch(c.epoch.toNumber() + 1),
            slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
          })
          .rpc();
        console.log(
          `epoch ${c.epoch} closed: ${current.ants} ants, ${current.shares} shares`
        );
      }

      if (buybacks && Date.now() - lastBuyback > BUYBACK_EVERY_MS) {
        lastBuyback = Date.now();
        // Simulated buyback out of the dev wallet: never more than it holds.
        const held = Number(
          (
            await connection
              .getTokenAccountBalance(depositorToken)
              .catch(() => null)
          )?.value.amount ?? 0
        );
        const amount = Math.min(
          held,
          (5_000 + Math.floor(Math.random() * 25_000)) * unit
        );
        if (amount > 0) {
          await program.methods
            .depositRewards(new BN(amount))
            .accountsPartial({
              depositor: authority.publicKey,
              colony,
              mint,
              vault,
              depositorToken,
              tokenProgram,
            })
            .rpc();
          console.log(`buyback: +${amount / unit} into the vault`);
        }
      }
    } catch (e: any) {
      console.error("crank error:", e.message ?? e);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main();
