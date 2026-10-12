import {
  Connection,
  TransactionExpiredBlockheightExceededError,
  type BlockheightBasedTransactionConfirmationStrategy,
  type Commitment,
  type RpcResponseAndContext,
  type SignatureResult,
  type TransactionConfirmationStrategy,
} from "@solana/web3.js";

/**
 * Confirm by polling getSignatureStatuses instead of a websocket subscription.
 * Hosted RPCs such as Alchemy don't serve Solana websocket subscriptions, and
 * web3.js would otherwise wait on one until the blockhash expires.
 */
async function pollConfirm(
  this: Connection,
  strategy: TransactionConfirmationStrategy | string,
  commitment?: Commitment
): Promise<RpcResponseAndContext<SignatureResult>> {
  const signature = typeof strategy === "string" ? strategy : strategy.signature;
  const lastValid = typeof strategy === "string" ? undefined : (strategy as BlockheightBasedTransactionConfirmationStrategy).lastValidBlockHeight;
  const want = commitment === "finalized" ? ["finalized"] : ["confirmed", "finalized"];
  const deadline = Date.now() + 90_000;
  for (let i = 0; ; i++) {
    const { context, value } = await this.getSignatureStatuses([signature]);
    const st = value[0];
    if (st?.err) return { context, value: { err: st.err } };
    if (st?.confirmationStatus && want.includes(st.confirmationStatus)) return { context, value: { err: null } };
    if (lastValid !== undefined && i % 5 === 4 && (await this.getBlockHeight("confirmed")) > lastValid)
      throw new TransactionExpiredBlockheightExceededError(signature);
    if (Date.now() > deadline) throw new Error(`confirmation timed out: ${signature}`);
    await new Promise((r) => setTimeout(r, 600));
  }
}

/**
 * Switch every Connection of the given class to polling confirmation. Scripts pass
 * their own web3.js Connection, which can be a different copy than the app's.
 */
export function enablePollingConfirmation(C: { prototype: object } = Connection) {
  (C.prototype as { confirmTransaction: typeof pollConfirm }).confirmTransaction = pollConfirm;
}
