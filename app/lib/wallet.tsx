"use client";

import {
  ConnectionProvider,
  WalletProvider,
  useAnchorWallet,
  useConnection,
  useWallet,
  type AnchorWallet,
} from "@solana/wallet-adapter-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { keypairWallet } from "./chain";
import { IS_TEST, RPC_URL } from "./config";

const BURNER_KEY = "poa.burner";

type Signer = {
  /** Connected wallet usable by Anchor, or null. */
  wallet: AnchorWallet | null;
  publicKey: PublicKey | null;
  kind: "adapter" | "burner" | null;
  enableBurner: () => void;
  disconnect: () => void;
};

const SignerCtx = createContext<Signer | null>(null);

function loadBurner(): Keypair | null {
  try {
    const raw = localStorage.getItem(BURNER_KEY);
    return raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : null;
  } catch {
    return null;
  }
}

function SignerProvider({ children }: { children: ReactNode }) {
  const adapter = useAnchorWallet();
  const { disconnect: disconnectAdapter } = useWallet();
  const [burner, setBurner] = useState<Keypair | null>(null);

  useEffect(() => {
    try {
      if (IS_TEST && localStorage.getItem(`${BURNER_KEY}.on`) === "1") setBurner(loadBurner());
    } catch {}
  }, []);

  const enableBurner = useCallback(() => {
    let kp = loadBurner();
    if (!kp) {
      kp = Keypair.generate();
      try {
        localStorage.setItem(BURNER_KEY, JSON.stringify(Array.from(kp.secretKey)));
      } catch {}
    }
    try {
      localStorage.setItem(`${BURNER_KEY}.on`, "1");
    } catch {}
    setBurner(kp);
  }, []);

  const disconnect = useCallback(() => {
    try {
      localStorage.removeItem(`${BURNER_KEY}.on`);
    } catch {}
    setBurner(null);
    disconnectAdapter().catch(() => {});
  }, [disconnectAdapter]);

  const value = useMemo<Signer>(() => {
    const wallet = adapter ?? (burner ? keypairWallet(burner) : null);
    return {
      wallet,
      publicKey: wallet?.publicKey ?? null,
      kind: adapter ? "adapter" : burner ? "burner" : null,
      enableBurner,
      disconnect,
    };
  }, [adapter, burner, enableBurner, disconnect]);

  return <SignerCtx.Provider value={value}>{children}</SignerCtx.Provider>;
}

export function SolanaProviders({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      {/* Wallet Standard wallets (Phantom, Solflare, Backpack…) are detected automatically. */}
      <WalletProvider wallets={[]} autoConnect>
        <SignerProvider>{children}</SignerProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function useSigner() {
  const s = useContext(SignerCtx);
  if (!s) throw new Error("useSigner outside SolanaProviders");
  return s;
}

export { useConnection, useWallet };
