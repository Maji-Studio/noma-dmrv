/**
 * What the product's stock projection refuses or flags for one bin, placed
 * under that bin's selector.
 *
 * The product form no longer draws a stock preview per bin: the movement rides
 * inside the selector as a stock change label. Refusals, blockers and
 * discrepancies are not optional, so they stay visible at both detail levels,
 * next to the bin they concern.
 */
"use client";

import { StockNotice } from "@/components/storage-locations/stock-figures";
import { formatMassKg } from "@/lib/format-utils";
import type { AffectedStockPreview } from "@/types/output-stock";

type Blocker = NonNullable<AffectedStockPreview["blockers"]>[number];

/** Where the record that blocks this movement can be opened, when it has a page. */
function blockerHref(blocker: Blocker): string | null {
  switch (blocker.entity) {
    case "binMovement":
      return null;
    case "application":
      return `/applications?ids=${blocker.id}`;
    case "ghgStatement":
      return `/certification/ghg-statements?statement=${blocker.id}`;
    default:
      return `/certification/removals?removal=${blocker.id}`;
  }
}

/** True when the projection has something the operator must see for this bin. */
export function binNeedsAttention(preview: AffectedStockPreview | undefined, hideBlockingMessage = false): boolean {
  if (!preview) return false;
  return (!hideBlockingMessage && Boolean(preview.blockingMessage))
    || Boolean(preview.blockers?.length)
    || preview.discrepancySolidsKg > 0;
}

export function AffectedBinNotices({
  preview,
  hideBlockingMessage = false,
}: {
  preview: AffectedStockPreview | undefined;
  /** The same sentence already shows as the error on the field to change. */
  hideBlockingMessage?: boolean;
}) {
  if (!preview || !binNeedsAttention(preview, hideBlockingMessage)) return null;
  const blockers = preview.blockers ?? [];
  return (
    <div className="flex flex-col gap-6" aria-live="polite">
      {preview.discrepancySolidsKg > 0 && (
        <StockNotice>
          Count exceeds tracked solids by {formatMassKg(preview.discrepancySolidsKg)}. This discrepancy adds no stock.
        </StockNotice>
      )}
      {!hideBlockingMessage && preview.blockingMessage && (
        <StockNotice tone="error" role="alert">{preview.blockingMessage}</StockNotice>
      )}
      {blockers.length > 0 && (
        <ul aria-label={`Records blocking ${preview.binName}`} className="flex flex-wrap gap-x-12 gap-y-4 body-caption">
          {blockers.map((blocker) => {
            const href = blockerHref(blocker);
            return (
              <li key={`${blocker.entity}:${blocker.id}`}>
                {href
                  ? <a className="text-[var(--color-interaction)] underline" href={href}>{blocker.code}</a>
                  : blocker.code}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
