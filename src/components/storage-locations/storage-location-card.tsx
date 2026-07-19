"use client";

import {
  ArrowDownIcon,
  ArrowsClockwiseIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  PencilSimpleIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { formatDateTime, formatMass } from "@/lib/format-utils";
import {
  binAccentStyle,
  binCapacityPercent,
  binCurrentMassKg,
  binNeedsReconciliation,
} from "./bin-display";

interface StorageLocationCardProps {
  storageLocation: StorageLocationWithFacility;
  onView: (storageLocation: StorageLocationWithFacility) => void;
  onEdit: (storageLocation: StorageLocationWithFacility) => void;
  onDelete: (storageLocationId: string) => void;
  onReconcile: (storageLocation: StorageLocationWithFacility) => void;
}

/** One muted line describing what kind of material the bin holds. */
function contentsLabel(s: StorageLocationWithFacility): string | null {
  if (s.type === "feedstock_bin") {
    return s.feedstockInventory.feedstockTypes.join(", ") || null;
  }
  if (s.type === "biochar_bin") {
    return s.biocharInventory.downstreamFormulations.join(", ") || null;
  }
  return s.productInventory.formulationNames.join(", ") || null;
}

export function StorageLocationCard({
  storageLocation,
  onView,
  onEdit,
  onDelete,
  onReconcile,
}: StorageLocationCardProps) {
  const currentMassKg = binCurrentMassKg(storageLocation);
  const capacityPercent = binCapacityPercent(storageLocation);
  const needsReconciliation = binNeedsReconciliation(storageLocation);
  const isEmpty = currentMassKg === 0;
  const hasCapacity = storageLocation.capacityKg != null && storageLocation.capacityKg > 0;
  const { lastActivity } = storageLocation;
  const contents = contentsLabel(storageLocation);

  return (
    <article
      style={binAccentStyle(storageLocation.type)}
      className={`group flex flex-col bg-[var(--panel-bg)] [border:var(--panel-border)] [border-left:4px_solid_var(--bin-accent)] [box-shadow:var(--panel-shadow)] transition-colors hover:[border-color:var(--bin-accent)] cursor-pointer ${
        isEmpty ? "opacity-65" : ""
      }`}
      onClick={() => onView(storageLocation)}
    >
      <div className="flex flex-col gap-12 p-16">
        {/* Header: code + last activity */}
        <div className="flex items-center justify-between gap-8">
          <span className="inline-flex items-center bg-[var(--bin-soft)] px-8 py-4 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--bin-ink)]">
            {storageLocation.code}
          </span>
          {lastActivity && (
            <span
              className={`inline-flex shrink-0 items-center gap-4 body-caption ${
                lastActivity.type === "in"
                  ? "text-[var(--color-signal-green)]"
                  : "text-[var(--color-signal-orange)]"
              }`}
              title={`${lastActivity.label} · ${
                lastActivity.type === "in" ? "+" : "−"
              }${formatMass(lastActivity.massKg)}`}
            >
              {lastActivity.type === "in" ? (
                <ArrowUpIcon size={12} weight="bold" />
              ) : (
                <ArrowDownIcon size={12} weight="bold" />
              )}
              {formatDateTime(lastActivity.date)}
            </span>
          )}
        </div>

        {/* Name */}
        <h3 className="title-heading-3 truncate text-[var(--color-text-primary)]">
          {storageLocation.name}
        </h3>

        {/* Current mass + capacity context */}
        <div className="flex items-baseline justify-between gap-8">
          <span
            className={`title-heading-2 ${
              needsReconciliation
                ? "text-[var(--color-signal-red)]"
                : isEmpty
                  ? "text-[var(--color-text-tertiary)]"
                  : "text-[var(--color-text-primary)]"
            }`}
          >
            {isEmpty ? "Empty" : formatMass(currentMassKg)}
          </span>
          {/* Capacity context only when a capacity is set — uncapped stores
              (e.g. biochar piles) just show their mass. */}
          {hasCapacity && (
            <span className="shrink-0 body-caption text-[var(--color-text-tertiary)]">
              {capacityPercent}% of {formatMass(storageLocation.capacityKg)}
            </span>
          )}
        </div>

        {/* Capacity meter — omitted entirely for uncapped bins */}
        {hasCapacity && (
          <div
            className="h-6 w-full bg-[var(--bin-track)]"
            role="progressbar"
            aria-valuenow={capacityPercent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Fill level"
          >
            <div
              className="h-full bg-[var(--bin-accent)] transition-[width] duration-500"
              style={{ width: `${capacityPercent ?? 0}%` }}
            />
          </div>
        )}

        {/* Contents */}
        {contents && (
          <p className="truncate body-caption text-[var(--color-text-secondary)]">
            {contents}
          </p>
        )}

        {/* Needs-reconciliation alert — negative derived stock (issue #194).
            Deep-links straight to the reconcile sheet. */}
        {needsReconciliation && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReconcile(storageLocation);
            }}
            className="flex items-center gap-4 self-start body-caption font-medium text-[var(--color-signal-red)] underline decoration-dotted underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
          >
            <WarningIcon size={12} weight="fill" />
            Needs reconciliation
          </button>
        )}

        {/* Signals */}
        {storageLocation.type === "feedstock_bin" &&
          storageLocation.feedstockInventory.pendingDryMassKg > 0 && (
            <p className="flex items-center gap-4 body-caption text-[var(--clr-orange)]">
              <WarningIcon size={12} weight="fill" />
              {formatMass(storageLocation.feedstockInventory.pendingDryMassKg)}{" "}
              pending completion
            </p>
          )}

        {storageLocation.type === "product_bin" &&
          storageLocation.productInventory.appliedApplicationCount > 0 && (
            <p className="flex items-center gap-4 body-caption text-[var(--color-signal-green)]">
              <CheckCircleIcon size={12} weight="fill" />
              Applied{" "}
              {formatMass(storageLocation.productInventory.appliedDryMassKg)}
              <span className="mx-2">·</span>
              {storageLocation.productInventory.appliedApplicationCount}{" "}
              {storageLocation.productInventory.appliedApplicationCount === 1
                ? "application"
                : "applications"}
            </p>
          )}
      </div>

      {/* Actions footer */}
      <div
        className="flex items-center justify-end gap-4 border-t border-[var(--color-border-tertiary)] px-12 py-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onReconcile(storageLocation)}
          className="inline-flex h-32 w-32 items-center justify-center border border-[var(--color-border-tertiary)] text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--bin-accent)] hover:text-[var(--bin-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
          aria-label={`Reconcile ${storageLocation.name}`}
          title="Reconcile stock"
        >
          <ArrowsClockwiseIcon size={15} />
        </button>
        <button
          type="button"
          onClick={() => onEdit(storageLocation)}
          className="inline-flex h-32 w-32 items-center justify-center border border-[var(--color-border-tertiary)] text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--bin-accent)] hover:text-[var(--bin-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
          aria-label={`Edit ${storageLocation.name}`}
        >
          <PencilSimpleIcon size={15} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(storageLocation.id)}
          className="inline-flex h-32 w-32 items-center justify-center border border-[var(--color-border-tertiary)] text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-signal-red)] hover:text-[var(--color-signal-red)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
          aria-label={`Delete ${storageLocation.name}`}
        >
          <TrashIcon size={15} />
        </button>
      </div>
    </article>
  );
}
