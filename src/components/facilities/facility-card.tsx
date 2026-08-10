"use client";

import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  FactoryIcon,
  MapPinIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { RowActionsMenu } from "@/components/ui";
import type { FacilityWithRelations } from "@/data-access/facilities";
import { formatMass } from "@/lib/format-utils";

interface FacilityCardProps {
  facility: FacilityWithRelations;
  onView: (facility: FacilityWithRelations) => void;
  onEdit: (facility: FacilityWithRelations) => void;
  onArchive: (facilityId: string) => void;
  onRestore: (facilityId: string) => void;
}

export function FacilityCard({
  facility,
  onView,
  onEdit,
  onArchive,
  onRestore,
}: FacilityCardProps) {
  const isArchived = facility.archivedAt != null;
  return (
    <article
      className="flex flex-col bg-[var(--panel-bg)] [border:var(--panel-border)] [box-shadow:var(--panel-shadow)] transition-colors hover:[border-color:var(--edge-soft)] cursor-pointer"
      onClick={() => onView(facility)}
    >
      <div className="flex flex-1 flex-col gap-16 p-20">
        {/* Header: badge + country */}
        <div className="flex items-center justify-between gap-12">
          <span className="inline-flex items-center gap-6 border border-[var(--clr-purple-20)] bg-[var(--clr-purple-10)] px-10 py-4 text-[11px] uppercase tracking-[0.12em] text-[var(--clr-purple)]">
            <FactoryIcon size={12} weight="bold" />
            {facility.code}
          </span>
          <span className="flex items-center gap-8">
            {isArchived && (
              <span className="inline-flex items-center gap-6 border border-[var(--color-border-primary)] bg-[var(--color-surface-light)] px-10 py-4 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
                <ArchiveIcon size={12} weight="bold" />
                Archived
              </span>
            )}
            <span className="body-caption text-[var(--color-text-tertiary)]">
              {facility.country}
            </span>
          </span>
        </div>

        {/* Name + location */}
        <div>
          {/* Defensive fallback: a stray whitespace-only name (legacy/manual
              data — the schema now trims on every write) would render blank, so
              fall back to the always-present code (#378). */}
          <h3 className="title-heading-3 text-[var(--color-text-primary)]">
            {facility.name?.trim() || facility.code}
          </h3>
          {facility.location && (
            <p className="mt-6 flex items-center gap-6 body-caption text-[var(--color-text-tertiary)]">
              <MapPinIcon size={12} />
              {facility.location}
            </p>
          )}
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-12">
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">Reactors</p>
            <p className="title-heading-3">{facility.reactorCount}</p>
          </div>
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">Storage</p>
            <p className="title-heading-3">{facility.storageLocationCount}</p>
          </div>
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">Feedstock, wet</p>
            <p className="body-small text-[var(--color-text-primary)]">
              {formatMass(facility.inventorySummary.feedstockWetKg)}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-12">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {facility.address || "No address"}
        </span>

        <RowActionsMenu
          label={`Actions for facility ${facility.code}`}
          actions={
            isArchived
              ? [
                  {
                    label: "Restore",
                    icon: <ArrowCounterClockwiseIcon size={16} />,
                    onSelect: () => onRestore(facility.id),
                  },
                ]
              : [
                  {
                    label: "Edit",
                    icon: <PencilSimpleIcon size={16} />,
                    onSelect: () => onEdit(facility),
                  },
                  {
                    label: "Archive",
                    icon: <ArchiveIcon size={16} />,
                    onSelect: () => onArchive(facility.id),
                  },
                ]
          }
        />
      </div>
    </article>
  );
}
