/**
 * Change a live colony's params (authority only). Unset values keep their current setting.
 *
 *   CLUSTER=devnet EPOCH=1800 TARGET_ANTS=600 MAX_ANTS=3000 npx tsx scripts/set-params.ts
 *
 * Also: CLAIM_WINDOW (epochs), EMISSION_BPS, MIN_HOLD (whole tokens).
 * Takes effect from the next epoch on.
 */
import { BN } from "@coral-xyz/anchor";
import { mintInfo, pdas, savedMint, setup } from "./common";

const num = (k: string) => (process.env[k] ? Number(process.env[k]) : undefined);

async function main() {
  const { connection, program } = setup();
  const mint = savedMint();
  const { colony } = pdas(program.programId, mint);
  const c = await program.account.colony.fetch(colony);
  const { decimals } = await mintInfo(connection, mint);
  const minHold = num("MIN_HOLD");

  const params = {
    // Only validated (≤ max_target): the live target keeps retargeting from where it is.
    initialTarget: c.maxTarget,
    maxTarget: c.maxTarget,
    targetAntsPerEpoch: num("TARGET_ANTS") ?? c.targetAntsPerEpoch,
    epochDuration: new BN(num("EPOCH") ?? c.epochDuration.toNumber()),
    emissionBps: num("EMISSION_BPS") ?? c.emissionBps,
    minHold: minHold !== undefined ? new BN(minHold).mul(new BN(10).pow(new BN(decimals))) : c.minHold,
    maxAntsPerEpoch: num("MAX_ANTS") ?? c.maxAntsPerEpoch,
    claimWindow: new BN(num("CLAIM_WINDOW") ?? c.claimWindow.toNumber()),
  };
  await program.methods.setParams(params).accountsPartial({ colony }).rpc();

  const n = await program.account.colony.fetch(colony);
  console.log(`colony ${colony.toBase58()} updated:`);
  console.log(`  epoch ${n.epochDuration}s, target ${n.targetAntsPerEpoch} ants/epoch, max ${n.maxAntsPerEpoch} per wallet`);
  console.log(`  claim window ${n.claimWindow} epochs, emission ${n.emissionBps} bps, min hold ${n.minHold.toNumber() / 10 ** decimals}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
