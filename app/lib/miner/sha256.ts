/**
 * SHA-256 specialised for the Proof of Ant message:
 *
 *   challenge (32) ‖ wallet (32) ‖ counter u64 LE (8) ‖ nonce u64 LE (8)  = 80 bytes
 *
 * The first 64 bytes never change while mining, so their compression
 * ("midstate") is computed once. Each nonce then costs a single compression
 * of the second block, the same trick Bitcoin ASICs use.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const W = new Uint32Array(64);

/** One SHA-256 compression of the 16 words in W[0..15] into `state` (in place). */
function compress(state: Uint32Array) {
  for (let i = 16; i < 64; i++) {
    const w15 = W[i - 15], w2 = W[i - 2];
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3];
  let e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0; state[5] = (state[5] + f) | 0;
  state[6] = (state[6] + g) | 0; state[7] = (state[7] + h) | 0;
}

const bswap = (x: number) =>
  ((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24);

/** Midstate after the first block: challenge ‖ wallet. */
export function midstate(challenge: Uint8Array, wallet: Uint8Array): Uint32Array {
  const block = new Uint8Array(64);
  block.set(challenge, 0);
  block.set(wallet, 32);
  const dv = new DataView(block.buffer);
  for (let i = 0; i < 16; i++) W[i] = dv.getUint32(i * 4, false);
  const state = IV.slice();
  compress(state);
  return state;
}

/** u64 as two u32 halves. */
export type U64 = { hi: number; lo: number };
export const toU64 = (n: bigint): U64 => ({
  hi: Number((n >> 32n) & 0xffffffffn),
  lo: Number(n & 0xffffffffn),
});
export const fromU64 = ({ hi, lo }: U64) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);

const out = new Uint32Array(8);

/**
 * Hash the second block for (counter, nonce) on top of `mid`.
 * Returns the internal state array (valid until the next call).
 */
export function hashNonce(mid: Uint32Array, counter: U64, nonce: U64): Uint32Array {
  W[0] = bswap(counter.lo); W[1] = bswap(counter.hi);
  W[2] = bswap(nonce.lo); W[3] = bswap(nonce.hi);
  W[4] = 0x80000000;
  for (let i = 5; i < 15; i++) W[i] = 0;
  W[15] = 640; // message length in bits
  out.set(mid);
  compress(out);
  return out;
}

/** h = first 8 bytes of the digest, big endian, compared to target (hi, lo). */
export const below = (s: Uint32Array, t: U64) => {
  const h0 = s[0] >>> 0;
  return h0 < t.hi >>> 0 || (h0 === t.hi >>> 0 && s[1] >>> 0 < t.lo >>> 0);
};

export function digestBytes(s: Uint32Array): Uint8Array {
  const b = new Uint8Array(32);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < 8; i++) dv.setUint32(i * 4, s[i] >>> 0, false);
  return b;
}
