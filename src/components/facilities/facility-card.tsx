"use client";

import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  FactoryIcon,
  MapPinIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
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
              <span className="inline-flex items-center gap-6 border border-[var(--color-border-primary)] bg-[var(--color-background-secondary)] px-10 py-4 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
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
          <h3 className="title-heading-3 text-[var(--color-text-primary)]">
            {facility.name}
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
            <p className="body-caption text-[var(--color-text-tertiary)]">Feedstock</p>
            <p className="body-small text-[var(--color-text-primary)]">
              {formatMass(facility.inventorySummary.feedstockDryKg)}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-12">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {facility.address || "No address"}
        </span>

        <div className="flex items-center gap-8" onClick={(e) => e.stopPropagation()}>
          {isArchived ? (
            <Button
              size="small"
              variant="default"
              aria-label={`Restore facility ${facility.code}`}
              onClick={() => onRestore(facility.id)}
            >
              <ArrowCounterClockwiseIcon size={16} />
              Restore
            </Button>
          ) : (
            <>
              <Button size="small" variant="default" onClick={() => onEdit(facility)}>
                <PencilSimpleIcon size={16} />
                Edit
              </Button>
              <Button
                size="small"
                variant="default"
                aria-label={`Archive facility ${facility.code}`}
                className="border-[var(--color-signal-red)] text-[var(--color-signal-red)] hover:bg-[var(--clr-red-10)]"
                onClick={() => onArchive(facility.id)}
              >
                <ArchiveIcon size={16} />
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
