import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { createHash } from "crypto";
import { expect } from "chai";
import { ProofOfAnt } from "../target/types/proof_of_ant";

const u64le = (n: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The same hash the program checks: sha256(challenge ‖ wallet ‖ counter ‖ nonce). */
function antHash(challenge: number[], wallet: PublicKey, counter: bigint, nonce: bigint) {
  return createHash("sha256")
    .update(Buffer.from(challenge))
    .update(wallet.toBuffer())
    .update(u64le(counter))
    .update(u64le(nonce))
    .digest();
}

function mine(
  challenge: number[],
  wallet: PublicKey,
  counter: bigint,
  target: bigint,
  start = 0n,
  // Extra predicate, e.g. "must NOT be valid for the next counter".
  extra: (nonce: bigint) => boolean = () => true
): bigint {
  for (let nonce = start; ; nonce++) {
    const h = antHash(challenge, wallet, counter, nonce).readBigUInt64BE(0);
    if (h < target && extra(nonce)) return nonce;
  }
}

async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e: any) {
    expect(e.error?.errorCode?.code ?? e.toString()).to.contain(code);
    return;
  }
  expect.fail(`expected ${code}`);
}

// TOKEN_2022=1 runs the suite on a Token-2022 mint, as pump.fun coins are.
const TOKEN = process.env.TOKEN_2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

describe("proof-of-ant", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.proofOfAnt as Program<ProofOfAnt>;
  const conn = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const pid = program.programId;
  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, pid)[0];

  const miner = Keypair.generate();
  const hungry = Keypair.generate(); // holds less than min_hold

  let mint: PublicKey;
  let colony: PublicKey;
  let vault: PublicKey;
  let minerAta: PublicKey;
  let hungryAta: PublicKey;
  let payerAta: PublicKey;

  const epochPda = (i: number) => pda(Buffer.from("epoch"), colony.toBuffer(), u64le(i));
  const minerPda = (w: PublicKey) => pda(Buffer.from("miner"), colony.toBuffer(), w.toBuffer());
  const workPda = (i: number, w: PublicKey) =>
    pda(Buffer.from("work"), colony.toBuffer(), u64le(i), w.toBuffer());

  // ~8 hashes per ant: fast enough for tests.
  const INITIAL_TARGET = 2n ** 61n;
  // Difficulty floor just above the start, so the first easing hits it.
  const MAX_TARGET = INITIAL_TARGET + INITIAL_TARGET / 8n;
  const params = {
    initialTarget: new BN(INITIAL_TARGET.toString()),
    maxTarget: new BN(MAX_TARGET.toString()),
    targetAntsPerEpoch: 5,
    epochDuration: new BN(2),
    emissionBps: 1000, // 10% of the free vault per epoch
    minHold: new BN(100),
    maxAntsPerEpoch: 5,
    claimWindow: new BN(2),
  };

  async function dig(who: Keypair, ata: PublicKey, epochIndex: number, nonce: bigint, digger: Keypair = who) {
    return program.methods
      .dig(new BN(nonce.toString()))
      .accountsPartial({
        digger: digger.publicKey,
        owner: who.publicKey,
        colony,
        epoch: epochPda(epochIndex),
        miner: minerPda(who.publicKey),
        work: workPda(epochIndex, who.publicKey),
        ownerToken: ata,
      })
      .signers([digger])
      .rpc();
  }

  async function digOne(epochIndex: number) {
    const ep = await program.account.epoch.fetch(epochPda(epochIndex));
    const m = await program.account.miner.fetchNullable(minerPda(miner.publicKey));
    const counter = BigInt(m?.counter.toString() ?? 0);
    const nonce = mine(ep.challenge, miner.publicKey, counter, BigInt(ep.target.toString()));
    await dig(miner, minerAta, epochIndex, nonce);
  }

  async function advance(currentIndex: number) {
    return program.methods
      .advanceEpoch()
      .accountsPartial({
        cranker: payer.publicKey,
        colony,
        vault,
        currentEpoch: epochPda(currentIndex),
        nextEpoch: epochPda(currentIndex + 1),
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
      })
      .rpc();
  }

  before(async () => {
    for (const kp of [miner, hungry]) {
      await conn.confirmTransaction(
        await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL),
        "confirmed"
      );
    }
    mint = await createMint(conn, payer, payer.publicKey, null, 6, undefined, undefined, TOKEN);
    minerAta = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, miner.publicKey, false, undefined, undefined, TOKEN)).address;
    hungryAta = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, hungry.publicKey, false, undefined, undefined, TOKEN)).address;
    payerAta = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey, false, undefined, undefined, TOKEN)).address;
    await mintTo(conn, payer, mint, minerAta, payer, 1_000, [], undefined, TOKEN);
    await mintTo(conn, payer, mint, hungryAta, payer, 50, [], undefined, TOKEN);
    await mintTo(conn, payer, mint, payerAta, payer, 10_000_000, [], undefined, TOKEN);

    colony = pda(Buffer.from("colony"), mint.toBuffer());
    vault = pda(Buffer.from("vault"), colony.toBuffer());
  });

  it("founds a colony", async () => {
    await program.methods
      .initColony(params)
      .accountsPartial({
        authority: payer.publicKey,
        mint,
        colony,
        vault,
        epoch: epochPda(0),
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        tokenProgram: TOKEN,
      })
      .rpc();

    const c = await program.account.colony.fetch(colony);
    expect(c.epoch.toNumber()).to.eq(0);
    const e = await program.account.epoch.fetch(epochPda(0));
    expect(BigInt(e.target.toString())).to.eq(INITIAL_TARGET);
    expect(Buffer.from(e.challenge).equals(Buffer.alloc(32))).to.be.false;
  });

  it("lets only sane params through", async () => {
    const setParams = (p: typeof params) =>
      program.methods.setParams(p).accountsPartial({ authority: payer.publicKey, colony }).rpc();
    await expectError(setParams({ ...params, maxTarget: new BN((INITIAL_TARGET - 1n).toString()) }), "BadParams");
    await setParams(params);
    const c = await program.account.colony.fetch(colony);
    expect(BigInt(c.maxTarget.toString())).to.eq(MAX_TARGET);
  });

  it("refuses ants from wallets that hold too little", async () => {
    const ep = await program.account.epoch.fetch(epochPda(0));
    const nonce = mine(ep.challenge, hungry.publicKey, 0n, INITIAL_TARGET);
    await expectError(dig(hungry, hungryAta, 0, nonce), "NotEnoughFood");
  });

  it("rejects a hash above the target", async () => {
    const ep = await program.account.epoch.fetch(epochPda(0));
    let bad = 0n;
    while (antHash(ep.challenge, miner.publicKey, 0n, bad).readBigUInt64BE(0) < INITIAL_TARGET) bad++;
    await expectError(dig(miner, minerAta, 0, bad), "WeakProof");
  });

  it("hatches ants and chains them into the pheromone trail", async () => {
    const before = await program.account.colony.fetch(colony);
    await digOne(0);
    await digOne(0);
    await digOne(0);

    const m = await program.account.miner.fetch(minerPda(miner.publicKey));
    expect(m.counter.toNumber()).to.eq(3);
    expect(m.castes.reduce((a, b) => a + b.toNumber(), 0)).to.eq(3);

    const e = await program.account.epoch.fetch(epochPda(0));
    const w = await program.account.work.fetch(workPda(0, miner.publicKey));
    expect(e.ants.toNumber()).to.eq(3);
    expect(w.shares.toString()).to.eq(e.shares.toString());

    const after = await program.account.colony.fetch(colony);
    expect(Buffer.from(after.tip).equals(Buffer.from(before.tip))).to.be.false;
  });

  it("does not accept the same solution twice", async () => {
    const ep = await program.account.epoch.fetch(epochPda(0));
    const target = BigInt(ep.target.toString());
    const counter = 3n;
    // A nonce valid now but not valid for the next counter value.
    const nonce = mine(ep.challenge, miner.publicKey, counter, target, 0n, (n) =>
      antHash(ep.challenge, miner.publicKey, counter + 1n, n).readBigUInt64BE(0) >= target
    );
    await dig(miner, minerAta, 0, nonce);
    await expectError(dig(miner, minerAta, 0, nonce), "WeakProof");
  });

  it("enforces the per-wallet cap per epoch", async () => {
    await digOne(0); // 5th ant
    await expectError(digOne(0), "EpochCapReached");
  });

  it("feeds the colony with bought-back tokens", async () => {
    await program.methods
      .depositRewards(new BN(1_000_000))
      .accountsPartial({
        depositor: payer.publicKey,
        colony,
        mint,
        vault,
        depositorToken: payerAta,
        tokenProgram: TOKEN,
      })
      .rpc();
    expect(Number((await getAccount(conn, vault, undefined, TOKEN)).amount)).to.eq(1_000_000);
  });

  it("closes the epoch, locks the budget and retargets", async () => {
    await sleep(2500);
    await advance(0);

    const e0 = await program.account.epoch.fetch(epochPda(0));
    expect(e0.finalized).to.be.true;
    expect(e0.budget.toNumber()).to.eq(100_000);

    const c = await program.account.colony.fetch(colony);
    expect(c.epoch.toNumber()).to.eq(1);
    expect(c.reserved.toNumber()).to.eq(100_000);

    const e1 = await program.account.epoch.fetch(epochPda(1));
    expect(Buffer.from(e1.challenge).equals(Buffer.from(e0.challenge))).to.be.false;
    // The epoch ran long with few ants → easier, but capped by the floor.
    expect(BigInt(e1.target.toString())).to.eq(MAX_TARGET);

    await expectError(advance(1), "EpochNotOver");
  });

  it("pays the miner and refunds the work receipt rent", async () => {
    const before = Number((await getAccount(conn, minerAta, undefined, TOKEN)).amount);
    await program.methods
      .claim(new BN(0))
      .accountsPartial({
        owner: miner.publicKey,
        colony,
        mint,
        vault,
        epoch: epochPda(0),
        work: workPda(0, miner.publicKey),
        ownerToken: minerAta,
        tokenProgram: TOKEN,
      })
      .signers([miner])
      .rpc();

    const after = Number((await getAccount(conn, minerAta, undefined, TOKEN)).amount);
    expect(after - before).to.eq(100_000); // only miner → whole budget
    expect(await conn.getAccountInfo(workPda(0, miner.publicKey))).to.be.null;

    const c = await program.account.colony.fetch(colony);
    expect(c.reserved.toNumber()).to.eq(0);
  });

  it("lets a session key dig for its owner, and nobody else", async () => {
    const session = Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(session.publicKey, LAMPORTS_PER_SOL), "confirmed");

    const ep = await program.account.epoch.fetch(epochPda(1));
    const target = BigInt(ep.target.toString());
    let m = await program.account.miner.fetch(minerPda(miner.publicKey));
    let nonce = mine(ep.challenge, miner.publicKey, BigInt(m.counter.toString()), target);

    // Not authorized yet.
    await expectError(dig(miner, minerAta, 1, nonce, session), "NotYourAnt");

    await program.methods
      .setSession(session.publicKey)
      .accountsPartial({ owner: miner.publicKey, colony, miner: minerPda(miner.publicKey) })
      .signers([miner])
      .rpc();

    const antsBefore = m.totalAnts.toNumber();
    await dig(miner, minerAta, 1, nonce, session);
    m = await program.account.miner.fetch(minerPda(miner.publicKey));
    expect(m.totalAnts.toNumber()).to.eq(antsBefore + 1); // credited to the owner

    // Revoke → the session can no longer dig.
    await program.methods
      .setSession(PublicKey.default)
      .accountsPartial({ owner: miner.publicKey, colony, miner: minerPda(miner.publicKey) })
      .signers([miner])
      .rpc();
    nonce = mine(ep.challenge, miner.publicKey, BigInt(m.counter.toString()), target);
    await expectError(dig(miner, minerAta, 1, nonce, session), "NotYourAnt");
  });

  it("expires old epochs only after the claim window", async () => {
    const expire = (i: number) =>
      program.methods.expireEpoch(new BN(i)).accountsPartial({ colony, epoch: epochPda(i) }).rpc();

    await expectError(expire(0), "ClaimWindowOpen");
    await sleep(2500);
    await advance(1);
    await expire(0);

    const e0 = await program.account.epoch.fetch(epochPda(0));
    expect(e0.expired).to.be.true;
    await expectError(expire(0), "AlreadyExpired");
  });
});
