/**
 * Admin — Emission estimates
 * Per-facility genset yield + process-stage energy split used when
 * submitting credit batches to Isometric (Phase 3.7).
 *
 * The facility comes from the sidebar facility context — admin pages live
 * inside the (app) shell, so they follow the same "facility from context,
 * never a per-form picker" convention as the rest of the app.
 */
"use client";

import { EmissionEstimatesForm } from "@/components/admin/emission-estimates-form";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFacilityCertifierMapping } from "@/hooks/use-certification";

export default function AdminEmissionEstimatesPage() {
  const { facilityId, selectedFacility } = useFacilityContext();

  const { data: mappingData, isLoading: mappingLoading } =
    useFacilityCertifierMapping(facilityId ?? "", !!facilityId);

  return (
    <div className="container-max py-32 flex flex-col gap-24">
      <header className="flex flex-col gap-8">
        <h1 className="title-heading-2">Emission estimates</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[560px]">
          Per-facility genset yield and process-stage energy split. These feed
          the per-stage energy datapoints when a credit batch is submitted to
          Isometric.
        </p>
        {selectedFacility && (
          <div className="flex items-center gap-8 pt-4">
            <span className="title-chapter-title text-[var(--color-text-tertiary)]">
              Facility
            </span>
            <span className="body-small text-[var(--color-text-primary)]">
              {selectedFacility.code} — {selectedFacility.name}
            </span>
          </div>
        )}
      </header>

      {!facilityId && (
        <p className="body-medium text-[var(--color-text-secondary)]">
          Select a facility from the sidebar to configure its emission
          estimates.
        </p>
      )}
      {facilityId && mappingLoading && (
        <p className="body-medium text-[var(--color-text-secondary)]">
          Loading facility configuration…
        </p>
      )}
      {facilityId && mappingData && (
        <EmissionEstimatesForm
          key={facilityId}
          facilityId={facilityId}
          mapping={mappingData.mapping}
        />
      )}
    </div>
  );
}
