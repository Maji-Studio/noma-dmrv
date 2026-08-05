/**
 * ProductionBatchLinks — the removal detail sheet's "Production batches"
 * field: each member credit batch that is registered as an Isometric
 * ProductionBatch, with a deep link to the facility-nested Certify page.
 *
 * The registered identities come from the local `certifier_production_batches`
 * journal (DB-only, lazy while the sheet is open). The deep link additionally
 * needs the facility mapping's `externalProjectId` + `externalFacilityId`,
 * read from the lightweight certifier summary the sheet already caches for
 * RegistryRecordLink. If either id is missing (facility unmapped since
 * registration), the identity is still shown and only the link is omitted.
 * Renders nothing until a registration exists — an unsubmitted removal has no
 * batches to point at.
 */
"use client";

import {
  useFacilityCertifierSummary,
  useRemovalProductionBatches,
} from "@/hooks/use-certification";
import { isometricRegistry } from "@/lib/isometric/links";

interface ProductionBatchLinksProps {
  removalId: string;
  facilityId: string;
  isProduction: boolean;
  enabled: boolean;
}

export function ProductionBatchLinks({
  removalId,
  facilityId,
  isProduction,
  enabled,
}: ProductionBatchLinksProps) {
  const { data: batches } = useRemovalProductionBatches(removalId, enabled);
  const { data: summary } = useFacilityCertifierSummary(facilityId, enabled);

  if (!batches || batches.length === 0) return null;

  const externalProjectId = summary?.mapping?.externalProjectId ?? null;
  const externalFacilityId = summary?.mapping?.externalFacilityId ?? null;
  const environment = isProduction ? "production" : "sandbox";

  return (
    <div className="flex flex-col gap-4">
      <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
        Production batches ({batches.length})
      </span>
      <ul className="body-small flex flex-col gap-4 text-[var(--color-text-primary)]">
        {batches.map((batch) => {
          const url =
            externalProjectId && externalFacilityId
              ? isometricRegistry.productionBatch({
                  environment,
                  externalProjectId,
                  externalFacilityId,
                  externalProductionBatchId: batch.externalProductionBatchId,
                })
              : null;
          return (
            <li
              key={batch.creditBatchId}
              className="flex flex-wrap items-center gap-x-12 gap-y-4"
            >
              <span className="font-mono text-[var(--color-text-secondary)]">
                {batch.creditBatchCode} · {batch.supplierReference}
              </span>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
                >
                  View on Isometric ↗
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
