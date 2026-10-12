"use client";

import { useColony } from "@/lib/colony";
import { CLUSTER, IS_TEST, MINT } from "@/lib/config";

/** Banner when the configured colony is missing on the cluster. */
export function NoColony() {
  const { missing } = useColony();
  if (!missing) return null;
  return (
    <div className="panel" style={{ borderColor: "var(--red)", marginBottom: 16 }}>
      <div className="red" style={{ marginBottom: 6 }}>COLONY NOT FOUND{IS_TEST && ` ON ${CLUSTER.toUpperCase()}`}</div>
      <div className="dim" style={{ fontSize: 12 }}>
        {!IS_TEST ? (
          <>The colony is not live yet. Check back soon.</>
        ) : MINT ? (
          <>No colony for mint {MINT.toBase58()}. Locally: <code>npm run local:validator</code>, then <code>npm run local:setup</code>.</>
        ) : (
          <>NEXT_PUBLIC_MINT is not set. Run <code>npm run local:setup</code> to found a local colony.</>
        )}
      </div>
    </div>
  );
}
