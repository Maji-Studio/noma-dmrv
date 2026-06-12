"use client";

import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Package,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { formatMass } from "@/lib/format-utils";
import {
  formatStorageLocationType,
  type StorageLocationType,
} from "@/schemas/storage-locations";

interface StorageLocationCardProps {
  storageLocation: StorageLocationWithFacility;
  onView: (storageLocation: StorageLocationWithFacility) => void;
  onEdit: (storageLocation: StorageLocationWithFacility) => void;
  onDelete: (storageLocationId: string) => void;
}

function getTypeAccent(type: StorageLocationType) {
  if (type === "feedstock_bin")
    return "border-[var(--clr-orange-20)] bg-[var(--clr-orange-10)] text-[var(--clr-orange)]";
  if (type === "biochar_bin")
    return "border-[var(--clr-purple-20)] bg-[var(--clr-purple-10)] text-[var(--clr-purple)]";
  if (type === "ingredient_bin")
    return "border-[var(--clr-pink-20)] bg-[var(--clr-pink-10)] text-[var(--clr-pink)]";
  return "border-[var(--clr-rose-20)] bg-[var(--clr-rose-10)] text-[var(--clr-pink)]";
}

function getDryMass(s: StorageLocationWithFacility) {
  if (s.type === "feedstock_bin" || s.type === "ingredient_bin")
    return s.feedstockInventory.currentDryMassKg;
  if (s.type === "biochar_bin") return s.biocharInventory.currentMassKg;
  return s.productInventory.currentMassKg;
}


function getCapacityPercent(s: StorageLocationWithFacility) {
  if (!s.capacityKg || s.capacityKg <= 0) return null;
  return Math.round(
    Math.max(0, Math.min(100, (getDryMass(s) / s.capacityKg) * 100))
  );
}

function formatTimeAgo(date: Date) {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export function StorageLocationCard({
  storageLocation,
  onView,
  onEdit,
  onDelete,
}: StorageLocationCardProps) {
  const accent = getTypeAccent(storageLocation.type);
  const capacityPercent = getCapacityPercent(storageLocation);
  const { lastActivity } = storageLocation;

  return (
    <article
      className="flex flex-col bg-[var(--panel-bg)] [border:var(--panel-border)] [box-shadow:var(--panel-shadow)] transition-colors hover:[border-color:var(--edge-soft)] cursor-pointer"
      onClick={() => onView(storageLocation)}
    >
      <div className="flex flex-1 flex-col gap-16 p-20">
        {/* Header: badge + type */}
        <div className="flex items-center justify-between gap-12">
          <span
            className={`inline-flex items-center gap-6 border px-10 py-4 text-[11px] uppercase tracking-[0.12em] ${accent}`}
          >
            <Package size={12} weight="bold" />
            {storageLocation.code}
          </span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {formatStorageLocationType(storageLocation.type)}
          </span>
        </div>

        {/* Name */}
        <h3 className="title-heading-3 text-[var(--color-text-primary)]">
          {storageLocation.name}
        </h3>

        {/* Primary metric: dry mass */}
        <div className="flex items-end justify-between gap-12">
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Dry mass
            </p>
            <p className="title-heading-3 text-[var(--color-text-primary)]">
              {formatMass(getDryMass(storageLocation))}
            </p>
          </div>
          {storageLocation.capacityKg != null && (
            <div className="text-right">
              <p className="body-caption text-[var(--color-text-tertiary)]">
                Capacity
              </p>
              <p className="body-small text-[var(--color-text-primary)]">
                {formatMass(storageLocation.capacityKg)}
                {capacityPercent != null && (
                  <span className="ml-6 text-[var(--color-text-tertiary)]">
                    ({capacityPercent}%)
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Feedstock types (feedstock + ingredient bins) */}
        {(storageLocation.type === "feedstock_bin" || storageLocation.type === "ingredient_bin") &&
          storageLocation.feedstockInventory.feedstockTypes.length > 0 && (
            <div className="flex items-center gap-6 text-[var(--color-text-tertiary)]">
              <Package size={12} weight="bold" />
              <span className="body-caption truncate">
                {storageLocation.feedstockInventory.feedstockTypes.join(", ")}
              </span>
            </div>
          )}

        {storageLocation.type === "product_bin" &&
          storageLocation.productInventory.appliedApplicationCount > 0 && (
            <div className="flex items-center gap-6 text-[var(--color-signal-green)]">
              <CheckCircle size={12} weight="fill" />
              <span className="body-caption">
                Applied {formatMass(storageLocation.productInventory.appliedDryMassKg)}
                <span className="mx-4">&middot;</span>
                {storageLocation.productInventory.appliedApplicationCount} successful
                {storageLocation.productInventory.appliedApplicationCount === 1
                  ? " application"
                  : " applications"}
              </span>
              {storageLocation.productInventory.lastAppliedAt && (
                <span className="ml-auto truncate text-[var(--color-text-tertiary)]">
                  {formatTimeAgo(storageLocation.productInventory.lastAppliedAt)}
                </span>
              )}
            </div>
          )}

        {/* Last activity */}
        {lastActivity && (
          <div
            className={`flex items-center gap-6 body-caption ${
              lastActivity.type === "in"
                ? "text-[var(--color-signal-green)]"
                : "text-[var(--color-signal-orange)]"
            }`}
          >
            {lastActivity.type === "in" ? (
              <ArrowUp size={12} weight="bold" />
            ) : (
              <ArrowDown size={12} weight="bold" />
            )}
            <span>
              {formatTimeAgo(lastActivity.date)}
              <span className="mx-4">&middot;</span>
              {lastActivity.type === "in" ? "+" : "−"}
              {formatMass(lastActivity.massKg)}
            </span>
            <span className="ml-auto truncate max-w-[100px] text-[var(--color-text-tertiary)]" title={lastActivity.label}>
              {lastActivity.label}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-12">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {storageLocation.facilityName}
        </span>

        <div className="flex items-center gap-8" onClick={(e) => e.stopPropagation()}>
          <Button size="small" variant="default" onClick={() => onEdit(storageLocation)}>
            <PencilSimple size={16} />
            Edit
          </Button>
          <Button
            size="small"
            variant="default"
            className="border-[var(--color-signal-red)] text-[var(--color-signal-red)] hover:bg-[var(--clr-red-10)]"
            onClick={() => onDelete(storageLocation.id)}
          >
            <Trash size={16} />
          </Button>
        </div>
      </div>
    </article>
  );
}
