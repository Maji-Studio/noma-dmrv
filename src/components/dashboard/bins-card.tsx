/**
 * A short overview of the facility's storage bins beside To do and Recent
 * activity, in the same row anatomy. It reuses the storage board's read
 * (`useStorageLocations`) and the tile's figure rules: a bin's name, its
 * kind, and the stock it holds, wet mass first. Most recently active first,
 * at most BIN_ROWS rows, then a link to Storage bins.
 */
"use client";

import { PackageIcon, WarningOctagonIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { EmptyState } from "@/components/ui/empty-state";
import { BIN_TYPE_META, binCurrentMassKg, binMaterialName } from "@/components/storage-locations/bin-display";
import { massBasisLabel, outputStockFigure } from "@/components/storage-locations/stock-preview-shared";
import { useOutputStockBalance } from "@/hooks/use-output-stock";
import { useStorageLocations } from "@/hooks/use-storage-locations";
import { LOAD_FAILED, MISSING_VALUE } from "@/lib/copy-utils";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { formatMassKg } from "@/lib/format-utils";
import { EMPTY_STOCK_LABEL, isMassEmpty, isOutputStockEmpty } from "@/lib/stock-display";
import { recordHref } from "@/lib/record-links";
import { DashRow, DashSection, RowsSkeleton, SectionLink, shortDay } from "./shared";

const BIN_ROWS = 5;
/** The KPI band's short basis ("2.4 t dry"), so a row reads "200 kg wet". */
const WET = "wet";

export function BinsCard({ facilityId }: { facilityId: string }) {
  // Most recently touched first: the board's own `lastActivityAt` sort (latest
  // intake, draw, loss, count or product movement; bins never touched last).
  const { data, isLoading, error, refetch } = useStorageLocations(
    { facilityId, archived: false, page: 1, pageSize: BIN_ROWS, sortBy: "lastActivityAt", sortOrder: "desc" },
    { enabled: !!facilityId },
  );
  const listHref = `/storage-bins?facility=${encodeURIComponent(facilityId)}`;
  const bins = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <DashSection
      title="Bins"
      headingId="dashboard-bins"
      // No basis caption beside the heading; each figure carries "wet"
      // itself. Bins hold stock across batches, so the batch filter does not
      // narrow them.
      action={total > 0 ? <SectionLink href={listHref}>Open storage bins</SectionLink> : undefined}
    >
      {isLoading ? (
        <RowsSkeleton />
      ) : error ? (
        <div className="p-16">
          <EmptyState
            padding="sm"
            icon={<WarningOctagonIcon size={32} weight="bold" />}
            title="The bins could not be loaded."
            action={
              <Button variant="default" size="small" onClick={() => void refetch()}>
                Try again
              </Button>
            }
          />
        </div>
      ) : bins.length === 0 ? (
        <div className="p-16">
          <EmptyState
            padding="sm"
            icon={<PackageIcon size={32} weight="bold" />}
            title="No storage bins yet"
            action={<SectionLink href={listHref}>Open storage bins</SectionLink>}
          />
        </div>
      ) : (
        <ul className="@container flex flex-col" aria-label="Bins">
          {bins.map((bin) => (
            <BinRow key={bin.id} bin={bin} facilityId={facilityId} />
          ))}
        </ul>
      )}
    </DashSection>
  );
}

/** One bin in the shared row: name, then kind and stock, like the board's tile. */
function BinRow({ bin, facilityId }: { bin: StorageLocationWithFacility; facilityId: string }) {
  const { timeZone } = useFacilityClock(facilityId);
  const feedstock = bin.type === "feedstock_bin";
  const output = useOutputStockBalance(feedstock ? null : { storageLocationId: bin.id, facilityId: bin.facilityId });
  return (
    <DashRow
      row={{
        id: bin.id,
        title: binTitle(bin),
        subtitle: binSubtitle(bin),
        // One line: the name, then the last movement's day and the stock.
        meta: [
          bin.lastActivity ? shortDay(bin.lastActivity.date, timeZone) : null,
          binFigure(bin, output.data, !!output.error),
        ]
          .filter(Boolean)
          .join(" · "),
        href: recordHref("storageBin", bin.id, { facilityId }),
      }}
    />
  );
}

/**
 * The tile's figure rules (storage-bin-tile.tsx TileFigure), for a row. Each
 * figure names its basis, short like the KPI band ("200 kg wet"); an output bin with no wet estimate
 * keeps "dry biochar", since it is not wet.
 */
function binFigure(
  bin: StorageLocationWithFacility,
  stock: { beforeDryKg: number; beforeEstimatedWetKg: number | null } | undefined,
  readFailed: boolean,
): string | null {
  if (bin.type === "feedstock_bin") {
    const wetKg = binCurrentMassKg(bin);
    if (isMassEmpty(wetKg)) return EMPTY_STOCK_LABEL;
    return wetKg == null ? LOAD_FAILED : `${formatMassKg(wetKg)} ${WET}`;
  }
  // Until the stock read lands the row shows the day alone.
  if (!stock) return readFailed ? LOAD_FAILED : null;
  const wetKg = stock.beforeEstimatedWetKg;
  if (isOutputStockEmpty(wetKg, stock.beforeDryKg)) return EMPTY_STOCK_LABEL;
  return outputStockFigure(wetKg, stock.beforeDryKg).replace(massBasisLabel("wet"), WET);
}

export function binTitle(bin: StorageLocationWithFacility): string {
  return bin.name.trim() || bin.code;
}

/**
 * The line under the title: "Feedstock bin · Forestry waste", "Product bin ·
 * Pure biochar", "Biochar bin". What the bin holds is left out when it only
 * repeats the bin's kind or its name.
 */
export function binSubtitle(bin: StorageLocationWithFacility): string {
  const kind = BIN_TYPE_META[bin.type].label;
  const material = binMaterialName(bin);
  const repeats = [kind, binTitle(bin)].some((text) => text.toLowerCase() === material.toLowerCase());
  return repeats || material === MISSING_VALUE.notSet ? `${kind} bin` : `${kind} bin · ${material}`;
}
