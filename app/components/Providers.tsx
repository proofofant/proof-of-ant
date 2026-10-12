"use client";

import "@/lib/polyfill";
import type { ReactNode } from "react";
import { ColonyProvider } from "@/lib/colony";
import { MinerProvider } from "@/lib/miner/MinerProvider";
import { SolanaProviders } from "@/lib/wallet";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SolanaProviders>
      <ColonyProvider>
        <MinerProvider>{children}</MinerProvider>
      </ColonyProvider>
    </SolanaProviders>
  );
}
