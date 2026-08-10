/**
 * Typed wrappers + payload builder for the Isometric `ProductionBatch` API
 * surface (issue #630). Pure HTTP + pure functions — no DB, no auth, no
 * ActionResult — mirroring `sensors.ts`. `fn/certification/production-batches.ts`
 * composes these with the ledger/journal writes.
 *
 * ─── VERIFIED AGAINST THE REGISTRY (Certify OpenAPI, 2026-08-05) ─────────────
 *   `POST /production_batches` → `CreateProductionBatchRequest`
 *   required: facility_id, feedstock_type_ids, supplier_reference_id, kind,
 *             started_at, ended_at, mass
 *   optional: display_name (1..100 chars; auto-generated when omitted)
 *   `mass` is a `ScalarQuantity` — required `magnitude` + `unit`, OPTIONAL
 *   `standard_deviation`. `GET /production_batches` exposes NO supplier-reference
 *   filter (unlike `/sensors?reference=`), so the reconcile lookup below
 *   paginates and filters client-side, exactly as measurement samples do.
 *
 * Mass definition (PDD `M_biochar (DM)`): the TOTAL DRY MASS of biochar produced
 * in the batch, in kilograms, weighed on calibrated scales. This is deliberately
 * NOT the reporting-period `product_mass` a GHG entry claims (that figure is
 * attribution-scaled to what was actually applied) — the two must not be
 * conflated.
 */

import { createHash } from "node:crypto";
import { SafeError } from "@/lib/errors";
import type { IsometricClient } from "./client";
import type { components } from "./generated/certify";

export type IsometricProductionBatch = components["schemas"]["ProductionBatch"];
export type CreateProductionBatchRequest =
  components["schemas"]["CreateProductionBatchRequest"];

const CREDIT_BATCH_REF_PREFIX_LEN = 12;
const DISPLAY_NAME_MAX_LEN = 100;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Registry-facing day bounds for a date-only window (see below). */
const DAY_START_SUFFIX = "T00:00:00.000Z";
const DAY_END_SUFFIX = "T23:59:59.999Z";

/** Unit submitted for `M_biochar (DM)` — kilograms, per the approved mapping. */
export const PRODUCTION_BATCH_MASS_UNIT = "kg";

// Verified from a live Certify production-batch response on 2026-08-10:
// Isometric canonicalizes the submitted `kg` unit to `kilogram` on readback.
const KILOGRAM_UNIT_ALIASES = new Set([
  PRODUCTION_BATCH_MASS_UNIT,
  "kilogram",
]);

/** The only `ProductionBatchKind` the registry defines for this protocol. */
export const PRODUCTION_BATCH_KIND = "biochar" as const;

/** Compare the request and readback spellings without converting mass units. */
export function productionBatchMassUnitsMatch(
  actual: string,
  expected: string,
): boolean {
  return (
    actual === expected ||
    (KILOGRAM_UNIT_ALIASES.has(actual) &&
      KILOGRAM_UNIT_ALIASES.has(expected))
  );
}

/**
 * Stable, noma-controlled production-batch supplier reference, keyed on the
 * CREDIT BATCH (the protocol production batch — ADR 0016). Deliberately NOT
 * versioned per removal submission the way measurement-sample refs are: a
 * production batch is a physical artifact registered once and reused by every
 * later submission, resubmission or supersede. The `nm-ptb-` prefix never
 * collides with removal (`nm-rmv-`), sensor (`nm-snr-`) or measurement-sample
 * (`nm-mts-`) references.
 */
export function buildProductionBatchReference(args: {
  creditBatchId: string;
}): string {
  const short = createHash("sha256")
    .update(args.creditBatchId)
    .digest("hex")
    .slice(0, CREDIT_BATCH_REF_PREFIX_LEN);
  return `nm-ptb-${short}`;
}

export interface BuildProductionBatchRequestArgs {
  /** Credit-batch code — becomes the registry display name. */
  creditBatchCode: string;
  /** The operator-pasted Isometric facility id (`fcl_…`). */
  externalFacilityId: string;
  /** Isometric feedstock-type ids (`ftt_…`) used by this batch. */
  feedstockTypeIds: string[];
  /** Credit-batch window, date-only (`YYYY-MM-DD`). */
  startDate: string;
  endDate: string;
  /** Total dry biochar mass produced in the batch (kg) — `M_biochar (DM)`. */
  totalDryMassKg: number;
  supplierReferenceId: string;
}

/**
 * Build the `POST /production_batches` body. Pure — no I/O.
 *
 * Date-only windows are pinned to the UTC calendar (the repo-wide rule for
 * date-only columns, see `date-utils.ts`): `started_at` is the UTC start of the
 * first production day and `ended_at` the UTC end of the last, so the registry
 * window covers every instant the batch's runs can fall in.
 *
 * `mass.standard_deviation` is OMITTED, never zeroed: the batch total is a
 * calibrated-scale sum, not a sampled estimate, and inventing a spread would
 * misrepresent the measurement.
 */
export function buildCreateProductionBatchRequest(
  args: BuildProductionBatchRequestArgs,
): CreateProductionBatchRequest {
  if (!args.externalFacilityId) {
    throw new SafeError(
      `Credit batch ${args.creditBatchCode} has no Isometric facility ID. Add it under Certification settings before submitting.`,
    );
  }
  const feedstockTypeIds = Array.from(new Set(args.feedstockTypeIds)).sort();
  if (feedstockTypeIds.length === 0) {
    throw new SafeError(
      `Credit batch ${args.creditBatchCode} uses a feedstock type that is not linked to an Isometric feedstock type. Link it under Feedstock types before submitting.`,
    );
  }
  if (
    !DATE_ONLY_PATTERN.test(args.startDate) ||
    !DATE_ONLY_PATTERN.test(args.endDate)
  ) {
    throw new SafeError(
      `Credit batch ${args.creditBatchCode} has no production start and end date. Set both dates before submitting.`,
    );
  }
  if (args.endDate < args.startDate) {
    throw new SafeError(
      `Credit batch ${args.creditBatchCode} ends before it starts. Correct the production dates before submitting.`,
    );
  }
  if (!Number.isFinite(args.totalDryMassKg) || args.totalDryMassKg <= 0) {
    throw new SafeError(
      `Credit batch ${args.creditBatchCode} has no dry biochar mass recorded on its production runs. Record the produced mass before submitting.`,
    );
  }

  // `display_name` is 1..100 chars when present, so a blank credit-batch code
  // omits it and lets the registry auto-generate one rather than earning a
  // generic 4xx for an empty string.
  const displayName = args.creditBatchCode.trim().slice(0, DISPLAY_NAME_MAX_LEN);

  return {
    ...(displayName ? { display_name: displayName } : {}),
    ended_at: `${args.endDate}${DAY_END_SUFFIX}`,
    facility_id: args.externalFacilityId,
    feedstock_type_ids: feedstockTypeIds,
    kind: PRODUCTION_BATCH_KIND,
    mass: {
      magnitude: args.totalDryMassKg,
      unit: PRODUCTION_BATCH_MASS_UNIT,
    },
    started_at: `${args.startDate}${DAY_START_SUFFIX}`,
    supplier_reference_id: args.supplierReferenceId,
  };
}

export async function createProductionBatch(
  client: IsometricClient,
  body: CreateProductionBatchRequest,
): Promise<IsometricProductionBatch> {
  return client.post<IsometricProductionBatch>("/production_batches", body);
}

/**
 * Looks up a production batch by its noma-controlled supplier reference for the
 * reconcile path. `GET /production_batches` has no server-side reference filter,
 * so this paginates and filters client-side (same shape as
 * `findMeasurementSampleBySupplierRef`). Returns the match or null.
 */
export async function findProductionBatchBySupplierRef(
  client: IsometricClient,
  supplierReferenceId: string,
): Promise<IsometricProductionBatch | null> {
  for await (const batch of client.paginate<IsometricProductionBatch>(
    "/production_batches",
  )) {
    if (batch.supplier_reference_id === supplierReferenceId) return batch;
  }
  return null;
}
