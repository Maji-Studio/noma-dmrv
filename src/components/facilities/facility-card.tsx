"use client";

import {
  Factory,
  MapPin,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import type { FacilityWithRelations } from "@/data-access/facilities";
import { formatMass } from "@/lib/format-utils";

interface FacilityCardProps {
  facility: FacilityWithRelations;
  onView: (facility: FacilityWithRelations) => void;
  onEdit: (facility: FacilityWithRelations) => void;
  onDelete: (facilityId: string) => void;
}

export function FacilityCard({
  facility,
  onView,
  onEdit,
  onDelete,
}: FacilityCardProps) {
  return (
    <article
      className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] transition-colors hover:border-[var(--color-border-primary)] cursor-pointer"
      onClick={() => onView(facility)}
    >
      <div className="flex flex-1 flex-col gap-16 p-20">
        {/* Header: badge + country */}
        <div className="flex items-center justify-between gap-12">
          <span className="inline-flex items-center gap-6 border border-[var(--clr-purple-20)] bg-[var(--clr-purple-10)] px-10 py-4 text-[11px] uppercase tracking-[0.12em] text-[var(--clr-purple)]">
            <Factory size={12} weight="bold" />
            {facility.code}
          </span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {facility.country}
          </span>
        </div>

        {/* Name + location */}
        <div>
          <h3 className="title-heading-3 text-[var(--color-text-primary)]">
            {facility.name}
          </h3>
          {facility.location && (
            <p className="mt-6 flex items-center gap-6 body-caption text-[var(--color-text-tertiary)]">
              <MapPin size={12} />
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
          <Button size="small" variant="default" onClick={() => onEdit(facility)}>
            <PencilSimple size={16} />
            Edit
          </Button>
          <Button
            size="small"
            variant="default"
            aria-label={`Delete facility ${facility.code}`}
            className="border-[var(--color-signal-red)] text-[var(--color-signal-red)] hover:bg-[var(--clr-red-10)]"
            onClick={() => onDelete(facility.id)}
          >
            <Trash size={16} />
          </Button>
        </div>
      </div>
    </article>
  );
}
