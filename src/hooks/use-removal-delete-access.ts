"use client";

import type { RemovalDeleteAccess } from "@/components/certification/removal-list-state";
import {
  useFacilityCertifierSummary,
  useRemovalProductionBatches,
} from "./use-certification";

/**
 * The two facts a Removal delete surface needs beyond the Removal row
 * (issue #746): whether the viewer meets the registry deletion role floor,
 * and whether a member credit batch is registered as a Production Batch.
 * Both reads are shared query keys, so the detail sheet's Production Batch
 * links and settings summary reuse them. A fact still loading or failed is
 * `null`, which `canDeleteRemovalRow` treats as "do not offer".
 */
export function useRemovalDeleteAccess(
  facilityId: string,
  removalId: string,
  enabled = true,
): RemovalDeleteAccess {
  const summary = useFacilityCertifierSummary(facilityId, enabled);
  const productionBatches = useRemovalProductionBatches(removalId, enabled);
  return {
    viewerCanDeleteRegistryRemovals:
      summary.data?.viewerCanDeleteRegistryRemovals ?? null,
    hasRegisteredProductionBatches: productionBatches.data
      ? productionBatches.data.length > 0
      : null,
  };
}
