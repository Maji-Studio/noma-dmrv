import { formatMass } from "@/lib/format-utils";
import type { TransportLeg } from "@/db/schema";

/** Compact one-line description shared by the summary and editor list rows. */
export function TransportLegLine({ leg }: { leg: TransportLeg }) {
  const fuel =
    leg.calculationMethodType === "energy_usage"
      ? leg.fuelType
      : leg.vehicleType;

  return (
    <div className="flex flex-col gap-4">
      <div className="body-medium">
        {leg.originName ?? "—"} → {leg.destinationName ?? "—"}
      </div>
      <div className="body-small text-[var(--color-text-secondary)]">
        {leg.distanceKm} km · {leg.transportMethodType.replace(/_/g, " ")}
        {fuel ? <> · {fuel}</> : null}
      </div>
      {leg.loadMassKg != null && (
        <div className="body-small text-[var(--color-text-secondary)]">
          Load: {formatMass(leg.loadMassKg)}
        </div>
      )}
    </div>
  );
}
