"use client";

import { useState } from "react";
import { EventFeed } from "@/components/EventFeed";
import { Panel, PixelIcon } from "@/components/ui";
import type { ColonyEvent } from "@/lib/colony";

const FILTERS: Record<string, (e: ColonyEvent) => boolean> = {
  all: () => true,
  ants: (e) => e.name === "AntHatched",
  queens: (e) => e.name === "AntHatched" && e.data.caste === 3,
  vault: (e) => e.name === "RewardsDeposited" || e.name === "Claimed",
  epochs: (e) => e.name.startsWith("Epoch"),
};

export default function Activity() {
  const [f, setF] = useState("all");
  return (
    <Panel
      title={<span className="icon-label" style={{ margin: 0 }}><PixelIcon name="pheromone-chain" size={16} />Colony activity</span>}
      right={
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.keys(FILTERS).map((k) => (
            <button key={k} className={`btn btn-sm ${f === k ? "btn-primary" : ""}`} onClick={() => setF(k)}>{k}</button>
          ))}
        </div>
      }
    >
      <EventFeed limit={300} filter={FILTERS[f]} showAll={false} />
    </Panel>
  );
}
