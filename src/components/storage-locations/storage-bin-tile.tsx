/**
 * StorageBinTile — one bin on the storage board, drawn as a silo.
 *
 * A vertical gauge on the left edge carries the fill level, so a wall of tiles
 * reads as a bar chart of the facility. The tile leads with the *material* it
 * holds, then names the bin holding it: an operator looking for somewhere to put
 * pine chips scans for "Pine chips" and then for "North hopper".
 *
 * The bin code appears nowhere on the tile's face. It is a lookup key for
 * evidence and exports, not something to read a wall of tiles by, and a column
 * of codes crowds out the two words that actually identify the bin. It stays
 * reachable where it is useful: the detail sheet and this tile's actions menu.
 *
 * Colour is spent once, on the gauge. The type icon repeats it small; the
 * headline stays in ordinary ink so the material reads as content rather than
 * as a category badge.
 *
 * The figure is the wet mass, because that is what an operator finds on site.
 * Biochar and product bins track dry biochar, so it reads under the wet
 * estimate as a smaller secondary figure, the same pair the detail sheet's
 * stock card shows. Without a wet estimate the dry biochar is the only honest
 * figure and takes its place.
 *
 * Every mass here is fixed kg (`formatMassKg`), matching the detail sheet the
 * tile opens: a tile reading "1.5 t" above a sheet reading "1,470 kg" for the
 * same bin is the incoherence that rule prevents. Facility-wide roll-ups (the
 * filter rail) keep auto-tonne `formatMass`.
 */
"use client";

import { RowActionsMenu } from "@/components/ui";
import { handleRowActivationClick } from "@/components/ui/data-table/data-table-helpers";
import { SecondaryFigure } from "@/components/ui/secondary-figure";
import { StatusBadge } from "@/components/ui/status-badge";
import { DRY_BIOCHAR_LABEL } from "@/components/biochar-products/product-composition-components";
import { RecordLockChip } from "@/components/record-locks/record-lock-chip";
import type { RecordLockView } from "@/lib/record-lock-view";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { useOutputStockBalance } from "@/hooks/use-output-stock";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate, formatDateTime, formatMassKg } from "@/lib/format-utils";
import { formatWetDryMass } from "@/lib/mass-moisture";
import { formatWetEstimate } from "./stock-preview-shared";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import {
  BIN_TYPE_META,
  binAccentStyle,
  binCapacityPercent,
  binCurrentMassKg,
  binMaterialName,
  binNeedsReconciliation,
} from "./bin-display";

/** Mirrors the (unexported) `RowAction` shape of `RowActionsMenu`. */
export interface BinRowAction {
  label: string;
  onSelect?: () => void;
  destructive?: boolean;
  icon?: React.ReactNode;
}

interface StorageBinTileProps {
  bin: StorageLocationWithFacility;
  actions: BinRowAction[];
  onView: (bin: StorageLocationWithFacility) => void;
  onReconcile: (bin: StorageLocationWithFacility) => void;
  /** Open or In use, from the board's one batched lock read. */
  lock?: RecordLockView;
}

export function StorageBinTile({
  bin,
  actions,
  onView,
  onReconcile,
  lock,
}: StorageBinTileProps) {
  const output = useOutputStockBalance(bin.type === "feedstock_bin" || bin.archivedAt != null ? null : { storageLocationId: bin.id, facilityId: bin.facilityId });
  const massKg = bin.type === "feedstock_bin" ? binCurrentMassKg(bin) : bin.archivedAt != null ? (bin.type === "biochar_bin" ? bin.biocharInventory.dryMassKg : bin.productInventory.dryMassKg) ?? null : output.data?.beforeDryKg ?? null;
  // An archived bin has no posting read, so it has no wet estimate either.
  const wetEstimateKg = bin.type === "feedstock_bin" || bin.archivedAt != null ? null : output.data?.beforeEstimatedWetKg ?? null;
  const fillPercent = bin.type === "feedstock_bin" ? binCapacityPercent(bin) : null;
  const needsReconciliation = binNeedsReconciliation(bin);
  // A known positive wet estimate is stock, even where the dry biochar rounds to nothing.
  const hasWetStock = wetEstimateKg != null && wetEstimateKg > 0;
  const isEmpty = !hasWetStock && massKg === 0;
  // An active output bin's figures arrive with its stock read; until then the slot stays blank.
  const loading = bin.type !== "feedstock_bin" && bin.archivedAt == null && !output.data && !output.error;
  const isArchived = bin.archivedAt != null;
  const material = binMaterialName(bin);
  const { Icon, ink } = BIN_TYPE_META[bin.type];

  return (
    <article
      style={binAccentStyle(bin.type)}
      // Pointer-only convenience: the material heading below is the link and
      // the only keyboard / screen-reader target. No role or tabIndex here, so
      // the actions menu is not nested inside an interactive element.
      // Same guard as DataTable rows: nested controls (actions menu,
      // Reconcile) and portaled menus keep their own press.
      onClick={(event) => handleRowActivationClick(event, () => onView(bin))}
      // Named for the bin, not for the material: several tiles can hold the same
      // material, and a screen reader moving between them needs them distinct.
      // Bin names are unique per org (`guardStorageLocationName`), so the name
      // alone identifies it — no need to read the code aloud either.
      aria-label={bin.name}
      className={`group flex cursor-pointer items-stretch bg-[var(--panel-bg)] [border:var(--panel-border)] transition-colors hover:[border-color:var(--bin-accent)] ${
        isEmpty ? "opacity-70" : ""
      } ${needsReconciliation ? "[border-color:var(--st-bad-border)]" : ""}`}
    >
      {/* The gauge column stays reserved on every tile so the grid keeps one
          left edge, but an uncapped bin paints nothing in it: there is no fill
          level to show, and a hatched fallback reads as a real striped bar. */}
      <div
        className={`w-10 shrink-0 ${
          fillPercent == null ? "" : "relative bg-[var(--bin-track)]"
        }`}
        role={fillPercent == null ? undefined : "progressbar"}
        aria-valuenow={fillPercent ?? undefined}
        aria-valuemin={fillPercent == null ? undefined : 0}
        aria-valuemax={fillPercent == null ? undefined : 100}
        aria-label={fillPercent == null ? undefined : `${bin.name} fill level`}
        title={
          fillPercent == null
            ? undefined
            : `${fillPercent}% of ${formatMassKg(bin.capacityKg)}`
        }
      >
        {fillPercent != null && (
          <div
            className="absolute inset-x-0 bottom-0 bg-[var(--bin-accent)]"
            style={{ height: `${fillPercent}%` }}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 px-12 py-10">
        <div className="flex items-center gap-6">
          <span style={{ color: ink }} className="shrink-0">
            <Icon size={16} weight="bold" />
          </span>
          <h3 className="min-w-0 flex-1 body-small font-semibold">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onView(bin);
              }}
              title={material}
              // Visible text first (WCAG 2.5.3), then the bin: two bins can hold
              // the same material, and a bare "Biochar" repeats down the board.
              aria-label={`${material}, ${bin.name}`}
              className="block max-w-full cursor-pointer truncate text-left underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
            >
              {material}
            </button>
          </h3>
          {lock && <RecordLockChip level={lock.level} className="shrink-0" />}
          <span className="shrink-0">
            <RowActionsMenu label={`Actions for ${bin.code}`} actions={actions} />
          </span>
        </div>

        {/* Identity: the bin the material sits in, by the name operators
            actually say out loud. The code is a lookup key for evidence and
            exports, not something to scan a wall of tiles by, so it lives on
            the detail sheet and on this tile's actions menu instead. */}
        <p className="flex items-center gap-6 body-caption text-[var(--color-text-tertiary)]">
          <span className="min-w-0 truncate">{bin.name}</span>
          {isArchived && (
            <StatusBadge status="archived" size="small" className="shrink-0" />
          )}
        </p>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-8">
            <span
              className={`body-large font-semibold tabular-nums ${
                needsReconciliation
                  ? "text-[var(--color-signal-red)]"
                  : isEmpty
                    ? "text-[var(--color-text-tertiary)]"
                    : "text-[var(--color-text-primary)]"
              }`}
            >
              {!loading && <TileFigure feedstock={bin.type === "feedstock_bin"} massKg={massKg} wetEstimateKg={wetEstimateKg} />}
            </span>
            {needsReconciliation && (
              <ReconcileLink bin={bin} onReconcile={onReconcile} />
            )}
          </div>
          {!isEmpty && !loading && massKg != null && wetEstimateKg != null && (
            <SecondaryFigure label={DRY_BIOCHAR_LABEL} value={formatMassKg(massKg)} />
          )}
        </div>

        {output.error && <p role="alert" className="body-caption">{output.error.message}</p>}
        <LastActivity bin={bin} />
      </div>
    </article>
  );
}

/**
 * The tile's one figure. A feedstock bin's stock is its wet mass. An output
 * bin leads with its wet estimate, and falls back to the dry biochar it tracks
 * when nothing dates a moisture. A positive wet estimate wins over a dry
 * biochar that rounds to nothing, so the tile never says Empty over wet stock
 * the sheet shows.
 */
function TileFigure({ feedstock, massKg, wetEstimateKg }: { feedstock: boolean; massKg: number | null; wetEstimateKg: number | null }) {
  if (!feedstock && wetEstimateKg != null && wetEstimateKg > 0) return `≈ ${formatWetEstimate(wetEstimateKg)} kg wet`;
  if (massKg == null) return MISSING_VALUE.notAvailable;
  if (massKg === 0) return "Empty";
  if (feedstock) return `${formatMassKg(massKg)} wet`;
  return wetEstimateKg == null ? `${formatMassKg(massKg)} dry biochar` : `≈ ${formatWetEstimate(wetEstimateKg)} kg wet`;
}

/**
 * When the derived count has gone negative, the fix outranks the history — the
 * slot that normally carries "when did this last move" carries the way out.
 */
function ReconcileLink({
  bin,
  onReconcile,
}: {
  bin: StorageLocationWithFacility;
  onReconcile: (bin: StorageLocationWithFacility) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onReconcile(bin);
      }}
      className="flex shrink-0 items-center gap-4 body-caption font-medium text-[var(--color-signal-red)] underline decoration-dotted underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
    >
      <WarningIcon size={12} weight="fill" />
      Reconcile
    </button>
  );
}

/**
 * When the bin last moved. Named in words rather than marked with a direction
 * arrow: a bare glyph beside a date asks the reader to learn a legend, and the
 * direction is the least useful part of it on a board scanned for what is
 * moving. The record itself, including direction and mass, is on the tooltip
 * and in full in the detail sheet.
 */
function LastActivity({ bin }: { bin: StorageLocationWithFacility }) {
  const { lastActivity } = bin;

  if (!lastActivity) {
    // Worth saying: under the board's default order this bin sorts last, and
    // silence here would leave that unexplained.
    return (
      <p className="truncate body-caption text-[var(--color-text-tertiary)]">
        No activity yet
      </p>
    );
  }

  const sign = lastActivity.type === "in" ? "+" : "−";
  const activityMass =
    bin.type === "feedstock_bin"
      ? formatMassKg(lastActivity.massKg)
      : formatWetDryMass({
          wetKg: lastActivity.massKg,
          dryKg: lastActivity.massDryKg,
          separator: " | ",
          unitSpacing: "compact",
        });
  return (
    <p
      className="truncate body-caption text-[var(--color-text-tertiary)]"
      title={`${lastActivity.label} · ${sign}${activityMass} · ${formatDateTime(
        lastActivity.date,
      )}`}
    >
      Last activity: {formatDate(lastActivity.date)}
    </p>
  );
}
