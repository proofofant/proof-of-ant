/// <reference lib="webworker" />
import { below, digestBytes, hashNonce, type U64 } from "./sha256";

export type StartMsg = {
  type: "start";
  job: number;
  mid: Uint32Array;
  counter: U64;
  target: U64;
  start: U64;
  /** 0..1: fraction of time spent hashing (power mode). */
  duty: number;
};
export type WorkerMsg =
  | { type: "progress"; job: number; hashes: number }
  | { type: "found"; job: number; nonce: U64; hash: Uint8Array; hashes: number };

const CHUNK = 65_536;
let job = -1;

self.onmessage = (e: MessageEvent<StartMsg | { type: "stop" }>) => {
  const msg = e.data;
  if (msg.type === "stop") {
    job = -1;
    return;
  }
  job = msg.job;
  run(msg);
};

function run(m: StartMsg) {
  const nonce = { hi: m.start.hi >>> 0, lo: m.start.lo >>> 0 };
  const step = () => {
    if (job !== m.job) return;
    const t0 = performance.now();
    for (let i = 0; i < CHUNK; i++) {
      const s = hashNonce(m.mid, m.counter, nonce);
      if (below(s, m.target)) {
        self.postMessage({
          type: "found",
          job: m.job,
          nonce: { ...nonce },
          hash: digestBytes(s),
          hashes: i + 1,
        } satisfies WorkerMsg);
        job = -1;
        return;
      }
      nonce.lo = (nonce.lo + 1) >>> 0;
      if (nonce.lo === 0) nonce.hi = (nonce.hi + 1) >>> 0;
    }
    self.postMessage({ type: "progress", job: m.job, hashes: CHUNK } satisfies WorkerMsg);
    // Yield to receive "stop"; sleep proportionally in low-power modes.
    const busy = performance.now() - t0;
    setTimeout(step, m.duty >= 1 ? 0 : (busy * (1 - m.duty)) / m.duty);
  };
  step();
}
