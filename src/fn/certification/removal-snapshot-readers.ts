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
import { FIRST_REMOVAL_SUBMISSION_VERSION } from "@/lib/isometric/biochar-applications";
import type {
  ClassifiedRemovalSource,
  NomaEvidenceRole,
  RemovalSourceBindingPlanEntry,
} from "@/lib/certification/removal-source-bindings";
import type { BiocharApplicationIntent } from "./biochar-application-intents";
import type { CandidateSourceDocument } from "./source-candidates";
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
  omittedTemplateComponentIds: string[];
}

export function assertRemovalSnapshotConfigurationCurrent(
  row: CertificationSubmissionRow,
  expected: { externalProjectId: string; templateId: string },
): void {
  const snapshot = row.payloadSnapshot as {
    semantic?: { externalProjectId?: unknown; templateId?: unknown };
  } | null;
  const parsed = z
    .object({ externalProjectId: z.string().min(1), templateId: z.string().min(1) })
    .safeParse(snapshot?.semantic);
  if (
    !parsed.success ||
    parsed.data.externalProjectId !== expected.externalProjectId ||
    parsed.data.templateId !== expected.templateId
  ) {
    throw new SafeError(
      "The facility's registry mapping changed after this Removal was submitted. Ask support to reconcile it before retrying.",
    );
  }
}

export function readRemovalSupersedePreviousId(
  row: CertificationSubmissionRow,
): string | null {
  const metadata = row.metadata as {
    supersedePreviousId?: unknown;
  } | null;
  const stored = metadata?.supersedePreviousId;
  if (stored === undefined || stored === null) return null;
  const parsed = z.string().min(1).safeParse(stored);
  if (!parsed.success) {
    throw new SafeError(
      "This saved submission has an invalid superseded-version link and cannot resume. Select Refresh review, then submit again.",
    );
  }
  return parsed.data;
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
  omittedTemplateComponentIds: z.array(z.string().min(1)).default([]),
});

const removalSourceBindingPlanSchema = z.array(
  z.object({
    documentId: z.string().min(1),
    sourceId: z.string().min(1),
    nomaRole: z.enum([
      "inventory",
      "feedstock_bill_of_lading",
      "delivery_bill_of_lading",
      "transport_evidence_ledger",
      "durability_evidence_ledger",
      "lab_report",
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

const nomaEvidenceRoleSchema = z.enum([
  "inventory",
  "feedstock_bill_of_lading",
  "delivery_bill_of_lading",
  "transport_evidence_ledger",
  "durability_evidence_ledger",
  "lab_report",
] satisfies [NomaEvidenceRole, ...NomaEvidenceRole[]]);
const removalSourceLineageSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  entityLabel: z.string().min(1),
});
const sequestrationSourceTargetSchema = z.object({
  kind: z.literal("sequestration"),
  groupKey: z.literal("co2-stored"),
  inputKey: z.enum([
    "product_mass",
    "carbon_contents",
    "s_fraction",
    "h_c_molar_ratios",
    "total_carbon_contents",
    "inorganic_carbon_contents",
  ]),
  optionalInTemplate: z.boolean().optional(),
});
const ordinarySourceTargetSchema = z.object({
  kind: z.literal("ordinary"),
  groupKey: z.enum([
    "biomass-feedstock-transport",
    "biochar-transport",
    "sampling-required-for-mrv",
    "miscellaneous",
  ]),
  componentBlueprintKey: z.enum([
    "mass_distance_based_ci_emissions",
    "mass_based_ci_emissions",
  ]),
  componentDisplayName: z.string().optional(),
  inputKey: z.enum(["mass_distance", "mass"]),
  optionalInTemplate: z.boolean().optional(),
});
const classifiedRemovalSourceSchema: z.ZodType<ClassifiedRemovalSource> =
  z.object({
    nomaRole: nomaEvidenceRoleSchema,
    nomaRoleLabel: z.string().min(1),
    lineage: removalSourceLineageSchema,
    intendedTarget: z.discriminatedUnion("kind", [
      sequestrationSourceTargetSchema,
      ordinarySourceTargetSchema,
    ]),
    additionalIntendedTargets: z
      .array(
        z.discriminatedUnion("kind", [
          sequestrationSourceTargetSchema,
          ordinarySourceTargetSchema,
        ]),
      )
      .optional(),
    mappingRevision: z.string().min(1),
  });
const removalCandidateSourcesSchema = z.array(
  z.object({
    documentId: z.string().min(1),
    binding: classifiedRemovalSourceSchema.nullable(),
    biocharApplicationId: z.string().min(1).nullable().optional(),
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

const biocharApplicationIntentBaseSchema = z.object({
  applicationId: z.string().min(1),
  applicationCode: z.string().min(1),
  creditBatchId: z.string().min(1),
  deliveryId: z.string().min(1),
  customerLocationId: z.string().min(1),
  certifierProjectId: z.string().min(1),
  externalProjectId: z.string().min(1),
  applicationDate: z.iso.date(),
  allocatedWetMassKg: z.number().finite().positive(),
  fieldSizeHa: z.number().finite().positive(),
  supplierReference: z.string().min(1).max(100),
  storageLocationSupplierReference: z.string().min(1),
  storageLocationPayload: z
    .object({
      description: z.union([
        z.string(),
        z.object({ __typename: z.literal("Undefined") }),
      ]),
      latitude: z.number().finite(),
      longitude: z.number().finite(),
      name: z.string().min(1),
      project_id: z.string().min(1),
      storage_method: z.literal("biochar_field"),
      supplier_reference_id: z.string().min(1),
    })
    .passthrough(),
  sourceIds: z.array(z.string()),
});

const biocharApplicationIntentSchema = biocharApplicationIntentBaseSchema;

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
    omittedTemplateComponentIds: parsed.data.omittedTemplateComponentIds,
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

export function readRemovalCandidateSources(
  row: CertificationSubmissionRow,
): CandidateSourceDocument[] {
  const snapshot = row.payloadSnapshot as {
    semantic?: { candidateSources?: unknown } | null;
  } | null;
  const parsed = removalCandidateSourcesSchema.safeParse(
    snapshot?.semantic?.candidateSources,
  );
  if (!parsed.success) {
    throw new SafeError(
      "This saved submission uses an older supporting-file candidate format and cannot resume. Select Refresh review, then submit again.",
    );
  }
  return parsed.data;
}

export function readRemovalBiocharApplicationIntents(
  row: CertificationSubmissionRow,
): BiocharApplicationIntent[] {
  const snapshot = row.payloadSnapshot as {
    semantic?: { biocharApplicationIntents?: unknown } | null;
    transport?: { biocharApplicationIntents?: unknown } | null;
  } | null;
  const transportIntents = snapshot?.transport?.biocharApplicationIntents;
  const storedIntents =
    transportIntents ??
    (row.version === FIRST_REMOVAL_SUBMISSION_VERSION
      ? snapshot?.semantic?.biocharApplicationIntents
      : undefined);
  const parsed = z
    .array(biocharApplicationIntentSchema)
    .safeParse(storedIntents);
  if (!parsed.success) {
    throw new SafeError(
      "This saved submission uses an older Biochar Application format and cannot resume. Select Refresh review, then submit again.",
    );
  }
  return parsed.data as BiocharApplicationIntent[];
}
