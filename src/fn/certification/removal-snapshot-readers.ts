/**
 * Read-back of the removal draft's stored `payload_snapshot` for the resume
 * path (and, on create, the just-built snapshot). The snapshot was written by
 * an earlier deploy and may not match this deploy's in-memory shape — every
 * reader fails loud rather than emit malformed registry bodies when the
 * schema has drifted (e.g. a body field renamed or removed).
 */
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { SafeError } from "@/lib/errors";
import type { CreateDatapointRequest } from "@/lib/isometric";
import type { RemovalSourceBindingPlanEntry } from "@/lib/certification/removal-source-bindings";
import { z } from "zod";

export interface ResolvedFixedInput {
  removalTemplateComponentId: string;
  inputKey: string;
  preboundDatapointId: string;
}

export interface DatapointTransport {
  rtcId: string;
  inputKey: string;
  body: CreateDatapointRequest;
}

export interface RemovalTransportSnapshot {
  removalSupplierRef: string;
  datapointBodies: DatapointTransport[];
}

const datapointTransportSchema = z.object({
  rtcId: z.string().min(1),
  inputKey: z.string().min(1),
  body: z
    .object({
      supplier_reference_id: z.string().min(1),
      // Phase 3.5: source_ids must be present in every snapshot. A
      // pre-Phase-3.5 draft (without this field) is "stale" — fail loud
      // locally rather than ship a malformed Datapoint to Isometric.
      source_ids: z.array(z.string()),
    })
    .passthrough(),
});
const removalTransportSnapshotSchema = z.object({
  removalSupplierRef: z.string().min(1),
  datapointBodies: z.array(datapointTransportSchema),
});

const removalSourceBindingPlanSchema = z.array(
  z.object({
    documentId: z.string().min(1),
    sourceId: z.string().min(1),
    nomaRole: z.enum([
      "inventory",
      "feedstock_bill_of_lading",
      "delivery_bill_of_lading",
    ]),
    lineage: z.object({
      entityType: z.string().min(1),
      entityId: z.string().min(1),
      entityLabel: z.string().min(1),
    }),
    intendedTarget: z.object({
      kind: z.enum(["ordinary", "sequestration"]),
      groupKey: z.string().min(1),
      componentId: z.string().min(1),
      componentBlueprintKey: z.string().min(1),
      inputKey: z.string().min(1),
      creditBatchIds: z.array(z.string().min(1)),
    }),
    mappingRevision: z.string().min(1),
  }),
);

// The `fixed` entries inside payload_snapshot.semantic.inputs. On resume these
// are the version-stamped bindings the original attempt locked — read back so a
// resumed submission never mixes the live template's fixed bindings with the
// stored transport snapshot (a stale-locked draft resumes regardless of hash,
// so live `fixed` may have drifted from what the snapshot was built against).
const fixedSnapshotInputSchema = z.object({
  rtcId: z.string().min(1),
  inputKey: z.string().min(1),
  kind: z.literal("fixed"),
  preboundDatapointId: z.string().min(1),
});

export function readRemovalTransport(
  row: CertificationSubmissionRow,
): RemovalTransportSnapshot {
  const snapshot = row.payloadSnapshot as { transport?: unknown } | null;
  const parsed = removalTransportSnapshotSchema.safeParse(snapshot?.transport);
  if (!parsed.success) {
    throw new SafeError(
      "This saved submission uses an older transport format and cannot resume. Select Refresh review, then submit again.",
    );
  }
  return {
    removalSupplierRef: parsed.data.removalSupplierRef,
    datapointBodies: parsed.data.datapointBodies as DatapointTransport[],
  };
}

// Reads the locked `fixed` bindings back out of the stored snapshot for the
// resume path. Mirrors readRemovalTransport's fail-loud stance: a `kind:"fixed"`
// entry that no longer matches the schema means the snapshot drifted, so refuse
// to resume rather than emit a GHG entry referencing a wrong/absent datapoint.
export function readRemovalFixedInputs(
  row: CertificationSubmissionRow,
): ResolvedFixedInput[] {
  const snapshot = row.payloadSnapshot as {
    semantic?: { inputs?: unknown } | null;
  } | null;
  const inputs = snapshot?.semantic?.inputs;
  if (!Array.isArray(inputs)) {
    throw new SafeError(
      "This saved submission uses an older format and cannot resume. Select Refresh review, then submit again.",
    );
  }
  const fixed: ResolvedFixedInput[] = [];
  for (const entry of inputs) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      (entry as { kind?: unknown }).kind !== "fixed"
    ) {
      continue;
    }
    const parsed = fixedSnapshotInputSchema.safeParse(entry);
    if (!parsed.success) {
      throw new SafeError(
        "This saved submission uses an older input format and cannot resume. Select Refresh review, then submit again.",
      );
    }
    fixed.push({
      removalTemplateComponentId: parsed.data.rtcId,
      inputKey: parsed.data.inputKey,
      preboundDatapointId: parsed.data.preboundDatapointId,
    });
  }
  return fixed;
}

export function readRemovalSourceBindingPlan(
  row: CertificationSubmissionRow,
): RemovalSourceBindingPlanEntry[] {
  const snapshot = row.payloadSnapshot as {
    sourceBindingPlan?: unknown;
  } | null;
  const parsed = removalSourceBindingPlanSchema.safeParse(
    snapshot?.sourceBindingPlan,
  );
  if (!parsed.success) {
    throw new SafeError(
      "This saved submission uses an older supporting-file plan and cannot resume. Select Refresh review, then submit again.",
    );
  }
  return parsed.data as RemovalSourceBindingPlanEntry[];
}
