/**
 * StockChangeLabel — a bin's name with what this entry does to it, for the
 * selected value of a bin selector: "Product bin (+400 kg wet)" in green for an
 * addition, "Source bin (−100 kg wet)" in amber for a draw.
 *
 * Only a fresh, successful server projection can advertise a movement: pass
 * `available={false}` while the preview refetches or failed, and a blocked
 * projection or a mass that is missing, not finite or zero shows the name only.
 */
import { formatCompositionMass } from "@/components/forms/composition-ledger";
import type { AffectedStockPreview } from "@/types/output-stock";

export function StockChangeLabel({ name, preview, available }: {
  name: string;
  preview?: AffectedStockPreview;
  /** False while the projection is refetching or failed. */
  available: boolean;
}) {
  const amount = preview?.removedWetKg;
  const valid = available
    && !preview?.blockingMessage
    && typeof amount === "number"
    && Number.isFinite(amount)
    && amount !== 0;
  return (
    <span className="flex min-w-0 items-center gap-4">
      <span className="truncate">{name}</span>
      {valid && (
        <span className={`shrink-0 tabular-nums ${amount < 0 ? "text-[var(--st-ok)]" : "text-[var(--st-wait)]"}`}>
          ({amount < 0 ? "+" : "−"}{formatCompositionMass(Math.abs(amount))} wet)
        </span>
      )}
    </span>
  );
}
