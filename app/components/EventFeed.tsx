"use client";

import Link from "next/link";
import { CASTES, fmtToken, short } from "@/lib/chain";
import { useColony, type ColonyEvent } from "@/lib/colony";
import { TICKER } from "@/lib/config";
import { PixelIcon, casteColor } from "./ui";

export function describe(e: ColonyEvent): { text: string; color?: string } | null {
  const d = e.data;
  switch (e.name) {
    case "AntHatched": {
      const caste = CASTES[d.caste];
      return {
        text: caste === "queen" ? `queen discovered by ${short(d.owner)}` : `${caste} spawned by ${short(d.owner)}`,
        color: casteColor(caste),
      };
    }
    case "RewardsDeposited":
      return { text: `reward vault funded +${fmtToken(d.amount, 0)} ${TICKER}`, color: "var(--green)" };
    case "Claimed":
      return d.amount.isZero() ? null : { text: `${short(d.owner)} claimed ${fmtToken(d.amount)} ${TICKER}` };
    case "EpochFinalized":
      return { text: `epoch ${d.index} closed · ${d.ants} ants · budget ${fmtToken(d.budget, 0)}`, color: "var(--text-2)" };
    case "EpochStarted":
      return { text: `epoch ${d.index} opened · new challenge`, color: "var(--dim)" };
    case "EpochExpired":
      return { text: `epoch ${d.index} expired · ${fmtToken(d.released, 0)} back to vault`, color: "var(--dim)" };
    case "SessionSet":
      return d.session.toBase58() === "11111111111111111111111111111111" ? null : { text: `new miner joined ${short(d.owner)}` };
  }
  return null;
}

const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString("en-GB", { hour12: false });

export function EventFeed({ limit = 8, filter, showAll = true }: {
  limit?: number;
  filter?: (e: ColonyEvent) => boolean;
  showAll?: boolean;
}) {
  const { events } = useColony();
  const rows = events
    .filter((e) => !filter || filter(e))
    .map((e) => ({ e, d: describe(e) }))
    .filter((r) => r.d)
    .slice(0, limit);

  return (
    <div>
      {rows.length === 0 && <div className="empty">no colony events yet</div>}
      {rows.map(({ e, d }) => (
        <div key={e.id} style={{ display: "flex", gap: 14, alignItems: "center", padding: "4px 0", fontSize: 12 }}>
          <span className="faint num">[{clock(e.ts)}]</span>
          <PixelIcon name="ant" size={12} color={d!.color ?? "var(--text-2)"} />
          <span style={{ color: d!.color ?? "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d!.text}
          </span>
        </div>
      ))}
      {showAll && rows.length > 0 && (
        <div style={{ marginTop: 8, textAlign: "right" }}>
          <Link href="/app/activity" className="label" style={{ color: "var(--text-2)" }}>view all →</Link>
        </div>
      )}
    </div>
  );
}
