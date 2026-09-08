/**
 * Typed wrappers + payload builder for the Isometric `ProductionBatch` API
 * surface (issue #630). Pure HTTP + pure functions — no DB, no auth, no
 * ActionResult — mirroring `sensors.ts`. `fn/certification/production-batches.ts`
 * composes these with the ledger/journal writes.
 *
 * ─── VERIFIED AGAINST THE REGISTRY (Certify OpenAPI, 2026-08-13) ─────────────
 *   `POST /production_batches` → `CreateProductionBatchRequest`
 *   required: facility_id, feedstock_type_ids, supplier_reference_id, kind,
 *             started_at, ended_at, mass
 *   optional: display_name (1..100 chars; auto-generated when omitted)
 *   `started_at` / `ended_at` are the physical instants at which production
 *   started and completed, respectively.
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
import { type IsometricClient } from "./client";
import { isMissingIsometricResource } from "./error-utils";
import type { components } from "./generated/certify";
import {
  ISOMETRIC_KILOGRAM_UNIT,
  kilogramUnitsMatch,
} from "./quantity-units";

export type IsometricProductionBatch = components["schemas"]["ProductionBatch"];
export type CreateProductionBatchRequest =
  components["schemas"]["CreateProductionBatchRequest"];

const CREDIT_BATCH_REF_PREFIX_LEN = 12;
const DISPLAY_NAME_MAX_LEN = 100;

export function buildLegacyProductionBatchDisplayName(code: string): string {
  return code.trim().slice(0, DISPLAY_NAME_MAX_LEN);
}

/** Unit submitted for `M_biochar (DM)` — kilograms, per the approved mapping. */
export const PRODUCTION_BATCH_MASS_UNIT = ISOMETRIC_KILOGRAM_UNIT;

/** The only `ProductionBatchKind` the registry defines for this protocol. */
export const PRODUCTION_BATCH_KIND = "biochar" as const;

/** Compare the request and readback spellings without converting mass units. */
export function productionBatchMassUnitsMatch(
  actual: string,
  expected: string,
): boolean {
  return kilogramUnitsMatch(actual, expected);
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
  /** Credit-batch code, displayed alongside its stable registry reference. */
  creditBatchCode: string;
  /** The operator-pasted Isometric facility id (`fcl_…`). */
  externalFacilityId: string;
  /** Isometric feedstock-type ids (`ftt_…`) used by this batch. */
  feedstockTypeIds: string[];
  /** Earliest member-run start instant and latest completed-run end instant. */
  startedAt: string;
  endedAt: string;
  /** Total dry biochar mass produced in the batch (kg) — `M_biochar (DM)`. */
  totalDryMassKg: number;
  supplierReferenceId: string;
}

/**
 * Build the `POST /production_batches` body. Pure — no I/O.
 *
 * Registry bounds are physical instants, not date-only display carriers. They
 * come from the earliest start and latest end of the credit batch's member
 * production runs, matching Certify's `started_at` / `ended_at` field contract
 * and keeping every member run inside the immutable remote window.
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
  const startedAtMs = Date.parse(args.startedAt);
  const endedAtMs = Date.parse(args.endedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    throw new SafeError(
      `Credit batch ${args.creditBatchCode} has no production runs with a recorded time window. Add and close its production runs before submitting.`,
    );
  }
  if (endedAtMs <= startedAtMs) {
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
  const suffix = ` (${args.supplierReferenceId})`;
  const code = args.creditBatchCode.trim();
  const displayName = code
    ? `${code.slice(0, DISPLAY_NAME_MAX_LEN - suffix.length)}${suffix}`
    : "";

  return {
    ...(displayName ? { display_name: displayName } : {}),
    ended_at: new Date(endedAtMs).toISOString(),
    facility_id: args.externalFacilityId,
    feedstock_type_ids: feedstockTypeIds,
    kind: PRODUCTION_BATCH_KIND,
    mass: {
      magnitude: args.totalDryMassKg,
      unit: PRODUCTION_BATCH_MASS_UNIT,
    },
    started_at: new Date(startedAtMs).toISOString(),
    supplier_reference_id: args.supplierReferenceId,
  };
}

export async function createProductionBatch(
  client: IsometricClient,
  body: CreateProductionBatchRequest,
): Promise<IsometricProductionBatch> {
  return client.post<IsometricProductionBatch>("/production_batches", body);
}

/** Read the exact journal identity; only a definitive absence permits recovery. */
export async function getProductionBatch(
  client: IsometricClient,
  id: string,
): Promise<IsometricProductionBatch | null> {
  try {
    const batch = await client.get<IsometricProductionBatch>(
      `/production_batches/${encodeURIComponent(id)}`,
    );
    if (!batch || typeof batch.id !== "string") {
      throw new SafeError(
        "Isometric returned an invalid production batch response. Try again before submitting.",
      );
    }
    return batch;
  } catch (error) {
    if (isMissingIsometricResource(error, "ProductionBatch", id)) return null;
    throw error;
  }
}

/**
 * Looks up a production batch by its noma-controlled supplier reference for the
 * reconcile path. `GET /production_batches` has no server-side reference filter,
 * so this paginates and filters client-side (same shape as
 * `findMeasurementSampleBySupplierRef`). Returns the unique match or null;
 * duplicate references fail closed.
 */
export async function findProductionBatchBySupplierRef(
  client: IsometricClient,
  supplierReferenceId: string,
): Promise<IsometricProductionBatch | null> {
  let match: IsometricProductionBatch | null = null;
  for await (const batch of client.paginate<IsometricProductionBatch>(
    "/production_batches",
  )) {
    if (batch.supplier_reference_id !== supplierReferenceId) continue;
    if (match && match.id !== batch.id) {
      throw new SafeError(
        "Multiple production batches have this supplier reference in Isometric. Resolve the duplicates before submitting again.",
      );
    }
    match = batch;
  }
  return match;
}

/** Deletes only the addressed registry artifact. Missing-resource handling belongs to the caller. */
export async function deleteProductionBatch(client: IsometricClient, id: string): Promise<void> {
  await client.delete(`/production_batches/${encodeURIComponent(id)}`);
}
