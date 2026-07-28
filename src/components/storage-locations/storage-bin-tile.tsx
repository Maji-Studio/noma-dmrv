/**
 * StorageBinTile — one bin on the storage board, drawn as a silo.
 *
 * A vertical gauge on the left edge carries the fill level, so a wall of tiles
 * reads as a bar chart of the facility. The tile leads with the *material* it
 * holds rather than the bin code: an operator looking for somewhere to put pine
 * chips scans for "Pine chips", not for "FB-004". The code is still on the tile
 * — evidence, exports and radio traffic all reference it — but demoted to the
 * identity line beneath the headline.
 *
 * Colour is spent once, on the gauge. The type icon repeats it small; the
 * headline stays in ordinary ink so the material reads as content rather than
 * as a category badge.
 *
 * Every mass here is fixed kg (`formatMassKg`), matching the detail sheet the
 * tile opens: a tile reading "1.5 t" above a sheet reading "1,470 kg" for the
 * same bin is the incoherence that rule prevents. Facility-wide roll-ups (the
 * filter rail) keep auto-tonne `formatMass`.
 */
"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { RowActionsMenu } from "@/components/ui";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { formatDate, formatDateTime, formatMassKg } from "@/lib/format-utils";
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
}

export function StorageBinTile({
  bin,
  actions,
  onView,
  onReconcile,
}: StorageBinTileProps) {
  const massKg = binCurrentMassKg(bin);
  const fillPercent = binCapacityPercent(bin);
  const needsReconciliation = binNeedsReconciliation(bin);
  const isEmpty = massKg === 0;
  const isArchived = bin.archivedAt != null;
  const material = binMaterialName(bin);
  const { Icon, ink } = BIN_TYPE_META[bin.type];

  return (
    <article
      style={binAccentStyle(bin.type)}
      // Reachable by keyboard, same contract as `application-card.tsx`: the
      // whole tile opens the detail sheet, so it has to answer Enter and Space.
      role="button"
      tabIndex={0}
      onClick={() => onView(bin)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // Only when the tile itself has focus — Space on the nested actions
        // menu belongs to that menu.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onView(bin);
      }}
      // Named for the bin, not for the material: several tiles can hold the same
      // material, and a screen reader moving between them needs them distinct.
      aria-label={`${bin.code} ${bin.name}`}
      className={`group flex cursor-pointer items-stretch bg-[var(--panel-bg)] [border:var(--panel-border)] transition-colors hover:[border-color:var(--bin-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] ${
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
          <h3 className="min-w-0 flex-1 truncate body-small font-semibold" title={material}>
            {material}
          </h3>
          <span className="shrink-0">
            <RowActionsMenu label={`Actions for ${bin.code}`} actions={actions} />
          </span>
        </div>

        {/* Identity: the bin the material sits in. The archived marker is its
            own element so it stays findable as an exact string. */}
        <p className="flex items-center gap-6 body-caption text-[var(--color-text-tertiary)]">
          {/* Both truncate. A long code must not squeeze the name to nothing,
              and a long name must not push the code off the tile. */}
          <span className="label-micro min-w-0 truncate">{bin.code}</span>
          <span className="min-w-0 truncate">{bin.name}</span>
          {isArchived && (
            <span className="label-micro shrink-0 border border-[var(--color-border-primary)] px-6">
              Archived
            </span>
          )}
        </p>

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
            {isEmpty ? "Empty" : formatMassKg(massKg)}
          </span>
          {needsReconciliation ? (
            <ReconcileLink bin={bin} onReconcile={onReconcile} />
          ) : (
            <LastActivity bin={bin} />
          )}
        </div>
      </div>
    </article>
  );
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
 * Last inventory event on the bin. The arrow carries direction; neither
 * direction is a status, so neither takes a status colour — material arriving
 * and material leaving are both an ordinary day.
 */
function LastActivity({ bin }: { bin: StorageLocationWithFacility }) {
  const { lastActivity } = bin;
  if (!lastActivity) return null;

  const sign = lastActivity.type === "in" ? "+" : "−";
  return (
    <span
      className="flex shrink-0 items-center gap-4 body-caption text-[var(--color-text-tertiary)]"
      title={`${lastActivity.label} · ${sign}${formatMassKg(
        lastActivity.massKg,
      )} · ${formatDateTime(lastActivity.date)}`}
    >
      {lastActivity.type === "in" ? (
        <ArrowUpIcon size={12} weight="bold" />
      ) : (
        <ArrowDownIcon size={12} weight="bold" />
      )}
      {formatDate(lastActivity.date)}
    </span>
  );
}
