import { formatMass } from "@/lib/format-utils";
import type { TransportLeg } from "@/db/schema";

/** Compact one-line description shared by the summary and editor list rows. */
export function TransportLegLine({ leg }: { leg: TransportLeg }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="body-medium">
        {leg.originName?.trim() || "—"} → {leg.destinationName?.trim() || "—"}
      </div>
      <div className="body-small text-[var(--color-text-secondary)]">
        {leg.distanceKm} km · {leg.transportMethodType.replace(/_/g, " ")}
        {leg.vehicleType ? <> · {leg.vehicleType}</> : null}
      </div>
      {leg.loadMassKg != null && (
        <div className="body-small text-[var(--color-text-secondary)]">
          Load: {formatMass(leg.loadMassKg)}
        </div>
      )}
    </div>
  );
}
