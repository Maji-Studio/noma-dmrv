/**
 * ProductionBatchLinks renders the removal detail sheet's "Isometric production batches"
 * field: each member credit batch that is registered as an Isometric
 * ProductionBatch, with a deep link to the facility-nested Certify page.
 *
 * The registered identities come from the local `certifier_production_batches`
 * journal (DB-only, lazy while the sheet is open), including immutable mapping
 * snapshots used for each deep link. Legacy rows without either snapshot still
 * show their identity and omit only the link.
 * Renders nothing until a registration exists — an unsubmitted removal has no
 * batches to point at.
 */
"use client";

import { useRemovalProductionBatches } from "@/hooks/use-certification";
import { DetailField } from "@/components/ui/detail-panel";
import { isometricRegistry } from "@/lib/isometric/links";
import { IsometricLink } from "./isometric-link";

interface ProductionBatchLinksProps {
  removalId: string;
  isProduction: boolean;
  enabled: boolean;
}

export function ProductionBatchLinks({
  removalId,
  isProduction,
  enabled,
}: ProductionBatchLinksProps) {
  const { data: batches } = useRemovalProductionBatches(removalId, enabled);

  if (!batches || batches.length === 0) return null;

  const environment = isProduction ? "production" : "sandbox";

  return (
    <DetailField
      label={`Isometric production batches (${batches.length})`}
      value={
        <ul className="flex flex-col gap-4">
          {batches.map((batch) => {
            const url =
              batch.externalProjectId && batch.externalFacilityId
                ? isometricRegistry.productionBatch({
                    environment,
                    externalProjectId: batch.externalProjectId,
                    externalFacilityId: batch.externalFacilityId,
                    externalProductionBatchId: batch.externalProductionBatchId,
                  })
                : null;
            return (
              <li
                key={batch.creditBatchId}
                className="flex flex-wrap items-center gap-x-12 gap-y-4"
              >
                <span className="font-mono">
                  {batch.creditBatchCode} · {batch.externalProductionBatchId}
                </span>
                {url && <IsometricLink href={url} />}
              </li>
            );
          })}
        </ul>
      }
    />
  );
}
