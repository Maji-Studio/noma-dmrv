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

import { Factory, Gauge } from "@phosphor-icons/react/dist/ssr";
import { EmissionEstimatesForm } from "@/components/admin/emission-estimates-form";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFacilityCertifierMapping } from "@/hooks/use-certification";

export default function AdminEmissionEstimatesPage() {
  const { facilityId, selectedFacility } = useFacilityContext();

  const {
    data: mappingData,
    isLoading: mappingLoading,
    isError: mappingError,
  } = useFacilityCertifierMapping(facilityId ?? "", !!facilityId);

  return (
    <div className="container-max flex flex-col gap-32 py-32">
      <header className="flex flex-col gap-8">
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Admin
        </span>
        <h1 className="title-heading-2">Emission estimates</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
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
        <div className="flex flex-col items-center justify-center gap-16 border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-white)] py-56">
          <Factory size={48} className="text-[var(--color-text-tertiary)]" />
          <div className="text-center">
            <h3 className="title-heading-3 mb-8">Select a facility</h3>
            <p className="body-small text-[var(--color-text-secondary)]">
              Choose a facility from the sidebar to configure its emission
              estimates.
            </p>
          </div>
        </div>
      )}

      {facilityId && mappingLoading && (
        <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
          <p className="body-medium text-[var(--color-text-tertiary)]">
            Loading facility configuration…
          </p>
        </section>
      )}

      {facilityId && mappingData && (
        <section className="flex flex-col gap-24 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-24">
          <div className="flex items-center gap-12 border-b border-[var(--color-border-tertiary)] pb-16">
            <span className="flex size-32 items-center justify-center border border-[var(--color-border-tertiary)] text-[var(--color-text-primary)]">
              <Gauge size={18} weight="bold" />
            </span>
            <div className="flex flex-col gap-2">
              <h2 className="title-heading-3">Configuration</h2>
              <p className="body-caption text-[var(--color-text-tertiary)]">
                Used the next time a credit batch is submitted from this
                facility.
              </p>
            </div>
          </div>
          <EmissionEstimatesForm
            key={facilityId}
            facilityId={facilityId}
            mapping={mappingData.mapping}
          />
        </section>
      )}

      {facilityId && !mappingLoading && !mappingData && (
        <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
          <p
            className="body-medium text-[var(--color-text-secondary)]"
            role={mappingError ? 'alert' : 'status'}
            aria-live={mappingError ? 'assertive' : 'polite'}
          >
            {mappingError
              ? "Couldn't load this facility's Isometric configuration. Refresh the page to try again."
              : "No Isometric configuration is available for this facility."}
          </p>
        </div>
      )}
    </div>
  );
}
