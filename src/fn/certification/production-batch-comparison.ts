import type { ProductionBatchRegistryInput } from "@/data-access/certifier-production-batches";
import { MASS_COMPARISON_EPSILON_KG } from "@/lib/calculations/mass-dry";
import {
  productionBatchMassUnitsMatch,
  type CreateProductionBatchRequest,
  type IsometricProductionBatch,
} from "@/lib/isometric/production-batches";

export const LEGACY_DAY_START_SUFFIX = "T00:00:00.000Z";
export const LEGACY_DAY_END_SUFFIX = "T23:59:59.999Z";

export type LegacyProductionBatchWindow = Pick<
  ProductionBatchRegistryInput,
  "startDate" | "endDate"
>;

export function timestampMatches(actual: string, expected: string): boolean {
  const actualMs = Date.parse(actual);
  return (
    Number.isFinite(actualMs) && actualMs === Date.parse(expected)
  );
}

/** True when the physical window lies inside the legacy day-bound window. */
export function physicalWindowFitsLegacyBounds(
  body: Pick<CreateProductionBatchRequest, "started_at" | "ended_at">,
  legacyWindow: LegacyProductionBatchWindow,
): boolean {
  return (
    Date.parse(body.started_at) >=
      Date.parse(`${legacyWindow.startDate}${LEGACY_DAY_START_SUFFIX}`) &&
    Date.parse(body.ended_at) <=
      Date.parse(`${legacyWindow.endDate}${LEGACY_DAY_END_SUFFIX}`)
  );
}

/** Shared readback tolerances for registered batches and orphan reconciliation. */
export function compareProductionBatchFigures(
  batch: IsometricProductionBatch,
  expected: CreateProductionBatchRequest,
  legacyWindow?: LegacyProductionBatchWindow,
) {
  const sameFeedstocks =
    [...batch.feedstock_type_ids].sort().join("\u0000") ===
    [...expected.feedstock_type_ids].sort().join("\u0000");
  const massDifferenceKg = Math.abs(
    batch.mass.magnitude - expected.mass.magnitude,
  );
  const floatingPointSlackKg =
    Number.EPSILON *
    (Math.abs(batch.mass.magnitude) + Math.abs(expected.mass.magnitude));
  const massMagnitudeMatches =
    massDifferenceKg <=
    MASS_COMPARISON_EPSILON_KG + floatingPointSlackKg;
  return {
    facility: batch.facility_id === expected.facility_id,
    feedstocks: sameFeedstocks,
    kind: batch.kind === expected.kind,
    mass: massMagnitudeMatches,
    massUnit: productionBatchMassUnitsMatch(batch.mass.unit, expected.mass.unit),
    window: productionBatchWindowKind(batch, expected, legacyWindow),
    start: timestampMatches(batch.started_at, expected.started_at),
    end: timestampMatches(batch.ended_at, expected.ended_at),
  };
}

export function productionBatchMismatchMessage(
  batch: IsometricProductionBatch,
  expected: CreateProductionBatchRequest,
  legacyWindow?: LegacyProductionBatchWindow,
): string | null {
  const matches = compareProductionBatchFigures(batch, expected, legacyWindow);
  if (
    batch.supplier_reference_id === expected.supplier_reference_id &&
    matches.facility &&
    matches.feedstocks &&
    matches.kind &&
    matches.mass &&
    matches.massUnit &&
    matches.window !== "mismatch"
  ) {
    return null;
  }
  return `Registry production batch ${batch.id} does not match this credit batch's facility, feedstock, kind, mass, or production window. Ask support to check the registry record.`;
}

export function productionBatchWindowKind(
  batch: IsometricProductionBatch,
  expected: CreateProductionBatchRequest,
  legacyWindow?: LegacyProductionBatchWindow,
): "physical" | "legacy" | "mismatch" {
  const physicalWindowMatches =
    timestampMatches(batch.started_at, expected.started_at) &&
    timestampMatches(batch.ended_at, expected.ended_at);
  if (physicalWindowMatches) return "physical";
  const legacyWindowMatches =
    legacyWindow !== undefined &&
    timestampMatches(
      batch.started_at,
      `${legacyWindow.startDate}${LEGACY_DAY_START_SUFFIX}`,
    ) &&
    timestampMatches(
      batch.ended_at,
      `${legacyWindow.endDate}${LEGACY_DAY_END_SUFFIX}`,
    );
  return legacyWindowMatches ? "legacy" : "mismatch";
}

