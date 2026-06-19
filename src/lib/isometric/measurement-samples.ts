/**
 * Typed wrappers for the Isometric `MeasurementSample` API surface used by the
 * 200-year durability submission path (Phase E). Pure HTTP — no DB, no auth, no
 * ActionResult — mirroring `sensors.ts`. A measurement sample groups datapoints
 * (H/C_org per production batch, soil temperature per project area) under a
 * `MeasurementTypeKey`; the sequestration blueprint inputs then reference those
 * datapoints.
 *
 * ⚠️ The live submission wiring (datapoint↔component-input binding) is
 * SANDBOX-GATED — see `transformers/measurement-sample.ts` and the dated
 * `docs/open-questions.md` entry. These wrappers are the transport only.
 */

import { createHash } from "node:crypto";
import { isometric, paginateAll } from "./client";
import type { components } from "./generated/certify";

export type IsometricMeasurementSample = components["schemas"]["MeasurementSample"];
export type CreateMeasurementSampleRequest =
  components["schemas"]["CreateMeasurementSampleRequest"];

const ENTITY_PREFIX_LEN = 12;

type MeasurementSampleRole = "production-batch" | "soil";

export interface BuildMeasurementSampleReferenceArgs {
  removalId: string;
  role: MeasurementSampleRole;
  version: number;
  /** Required for the per-batch role — the production run id the sample is for. */
  productionRunId?: string;
}

/**
 * Stable, noma-controlled measurement-sample supplier reference, versioned per
 * removal so a superseded-then-resubmitted removal claims a fresh resource. The
 * `nm-mts-` prefix never collides with the removal (`nm-rmv-`) or sensor
 * (`nm-snr-`) refs. Mirrors `buildRemovalSupplierRef`.
 */
export function buildMeasurementSampleReference(
  args: BuildMeasurementSampleReferenceArgs,
): string {
  const short = shortHash(args.removalId, ENTITY_PREFIX_LEN);
  if (args.role === "soil") {
    return `nm-mts-${short}-soil-v${args.version}`;
  }
  if (!args.productionRunId) {
    throw new Error(
      "buildMeasurementSampleReference: productionRunId required for the production-batch role",
    );
  }
  const runShort = shortHash(args.productionRunId, ENTITY_PREFIX_LEN);
  return `nm-mts-${short}-pb-${runShort}-v${args.version}`;
}

function shortHash(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

export async function createMeasurementSample(
  body: CreateMeasurementSampleRequest,
): Promise<IsometricMeasurementSample> {
  return isometric.post<IsometricMeasurementSample>(
    "/measurement_samples",
    body,
  );
}

export async function getMeasurementSampleById(
  id: string,
): Promise<IsometricMeasurementSample> {
  return isometric.get<IsometricMeasurementSample>(
    `/measurement_samples/${encodeURIComponent(id)}`,
  );
}

/**
 * Looks up a measurement sample by its noma-controlled supplier reference for
 * the reconcile path. The `GET /measurement_samples` endpoint exposes no
 * server-side reference filter (unlike `/sensors`), so this paginates and
 * filters client-side. Returns the match or null.
 */
export async function findMeasurementSampleBySupplierRef(
  supplierReferenceId: string,
): Promise<IsometricMeasurementSample | null> {
  const matches = await paginateAll<IsometricMeasurementSample>(
    "/measurement_samples",
  );
  return (
    matches.find((m) => m.supplier_reference_id === supplierReferenceId) ?? null
  );
}
