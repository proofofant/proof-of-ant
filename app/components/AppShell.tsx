"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { fmtDuration } from "@/lib/chain";
import { useColony } from "@/lib/colony";
import { CLUSTER, IS_TEST } from "@/lib/config";
import { useMiner } from "@/lib/miner/MinerProvider";
import { PixelIcon, Walker } from "./ui";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/app", label: "Overview", icon: "overview" },
  { href: "/app/mine", label: "Mine", icon: "mine" },
  { href: "/app/rewards", label: "Rewards", icon: "rewards" },
  { href: "/app/colony", label: "Colony", icon: "colony" },
  { href: "/app/leaderboard", label: "Leaderboard", icon: "leaderboard" },
  { href: "/app/vault", label: "Vault", icon: "vault" },
  { href: "/app/activity", label: "Activity", icon: "activity" },
  { href: "/app/docs", label: "Docs", icon: "docs" },
];

export function Brand() {
  return (
    <Link href="/" className="brand">
      <PixelIcon name="ant" size={18} color="var(--text)" />
      PROOF OF ANT
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { colony, epoch, now, missing } = useColony();
  const miner = useMiner();
  const left = colony && epoch && now ? epoch.startTs.toNumber() + colony.epochDuration.toNumber() - now : 0;

  return (
    <>
      <header className="topbar">
        <Brand />
        <div className="meta">
          {IS_TEST && (
            <>
              <span>{CLUSTER.toUpperCase()}</span>
              <span>•</span>
            </>
          )}
          <span>EPOCH {colony ? String(colony.epoch.toNumber()).padStart(3, "0") : "---"}</span>
          <span>•</span>
          <span>NEXT {colony ? fmtDuration(left) : "--"}</span>
          <span>•</span>
          {missing ? <span className="red">COLONY NOT FOUND</span> : <span className="green">COLONY ONLINE</span>}
          {miner.running && (
            <>
              <span>•</span>
              <span className="green">MINING<span className="blink">_</span></span>
            </>
          )}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <WalletButton compact />
        </div>
      </header>
      <div className="shell">
        <nav className="sidebar">
          {NAV.map((n) => {
            const active = n.href === "/app" ? path === "/app" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={`nav-item ${active ? "active" : ""}`}>
                <PixelIcon name={n.icon} size={12} />
                {n.label}
              </Link>
            );
          })}
          <div className="side-extra" style={{ marginTop: "auto", padding: "0 6px" }}>
            {miner.running ? <Walker caste="worker" scale={1.5} /> : <PixelIcon name="ant" size={28} color="var(--text-2)" />}
          </div>
        </nav>
        <main className="main">{children}</main>
      </div>
    </>
  );
}
