import {
  markSubmissionSubmitted,
  type CertificationSubmissionRow,
  type CertifierProjectRow,
} from "@/data-access/certification";
import {
  claimSubmissionDraft,
  type ClaimBlockedReason,
  type MappingClaimGuard,
} from "@/data-access/certification-submissions";
import { env } from "@/config/env";
import { updateRemovalDates } from "@/data-access/certifier-removals";
import { formatUtcDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import { logger, type Logger } from "@/lib/log";
import { z } from "zod";
import {
  aggregateProductionRuns,
  buildRemovalSupplierRef,
  createDatapoint,
  createGhgEntry,
  enrichWithFacilityConfig,
  enrichWithTransportLegs,
  payloadHash,
  reconcileDatapoint,
  reconcileRemoval,
  type CreateDatapointRequest,
  type FacilityEmissionConfig,
  type IsometricComponentBlueprint,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import {
  buildCreateDatapointRequest,
  MAPPING_REVISION,
} from "@/lib/isometric/transformers/datapoint";
import { buildCreateGhgEntryRequest } from "@/lib/isometric/transformers/ghg-entry";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import { ensureTransportEvidenceLedgerSourceFromContext } from "./evidence-ledger";
import { performRegistryCreate, supplierRefLookup } from "./registry-create";
import {
  collectCandidateDocumentIdsForRemoval,
  resolveSourceIdsForRemoval,
} from "./sources";
import {
  appendSyncEventBestEffort,
  assertProductionConfirmed,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "./shared";

// Domain wording for the claim module's blocked outcomes (the module owns
// only the mapping-guard wording; claim decisions are translated here).
const REMOVAL_CLAIM_BLOCKED_MESSAGES: Record<ClaimBlockedReason, string> = {
  "in-flight": "A Removal submission for this removal is already in progress.",
  "rejected-with-external":
    "This Removal was rejected by the verifier. Resolve the rejection in the Isometric registry before retrying.",
  // Removal policy is `supersede`; invalid-changed-hash is unreachable but
  // kept so future policy changes are explicit.
  "invalid-changed-hash": "Unexpected submission state for this removal.",
  "state-changed":
    "Submission state changed while preparing the removal. Reload and retry.",
};

// Reads the genset energy yield off the facility's certifier_projects row.
// Throws if unset — it must be configured in the admin area (Emission
// estimates) before a submission can convert genset litres to kWh (ADR 0014
// dropped the per-stage split, so the yield is the only required config).
// Facility-level config, shared across the removal.
export function resolveFacilityEmissionConfig(
  mapping: CertifierProjectRow,
): FacilityEmissionConfig {
  const { gensetEnergyYieldKwhPerLitre } = mapping;
  if (gensetEnergyYieldKwhPerLitre == null) {
    throw new SafeError(
      "Set this facility's genset yield in the admin area (Emission estimates) before submitting.",
    );
  }

  // Defence-in-depth: the admin form validates this through
  // facilityEmissionConfigSchema, but a direct DB edit or seed insert could
  // bypass it. A bad value here would silently corrupt a registry submission,
  // so re-check the bound before building the payload.
  if (
    !Number.isFinite(gensetEnergyYieldKwhPerLitre) ||
    gensetEnergyYieldKwhPerLitre <= 0
  ) {
    throw new SafeError(
      "This facility's genset energy yield must be a positive number. Correct it in the admin area (Emission estimates).",
    );
  }

  return { gensetEnergyYieldKwhPerLitre };
}

interface ResolvedMonitoredInput {
  removalTemplateComponentId: string;
  componentBlueprintKey: string;
  inputKey: string;
  quantity: { magnitude: number; unit: string };
  datapointType: string;
}

interface ResolvedFixedInput {
  removalTemplateComponentId: string;
  inputKey: string;
  preboundDatapointId: string;
}

interface DatapointTransport {
  rtcId: string;
  inputKey: string;
  body: CreateDatapointRequest;
}

interface RemovalTransportSnapshot {
  removalSupplierRef: string;
  datapointBodies: DatapointTransport[];
}

// Runtime guard for the JSONB payload_snapshot.transport read-back. The
// snapshot was written by an earlier deploy and may not match this deploy's
// in-memory shape — fail loud rather than post malformed datapoints when the
// schema has drifted (e.g. a body field renamed or removed).
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

// The reporting window (`semantic.startedOn` / `completedOn`) the original
// attempt locked. On resume the removal body's started_on/completed_on must
// come from here, not from the live aggregation: a resumed draft posts the
// SNAPSHOT's datapoint magnitudes, so deriving dates from a since-changed run
// set would stamp a window that the datapoints no longer back.
const reportingWindowSnapshotSchema = z.object({
  startedOn: z.string().min(1),
  completedOn: z.string().min(1),
});

export interface SubmitRemovalArgs {
  userId: string;
  removalId: string;
  confirmProduction?: boolean;
}

export interface RemovalSubmissionResult {
  removalId: string;
  externalId: string;
  version: number;
}

interface ResolvedTemplateInputs {
  monitored: ResolvedMonitoredInput[];
  fixed: ResolvedFixedInput[];
  datapointBodyByKey: Map<string, CreateDatapointRequest>;
}

// Walks the removal template's components, classifying every input as a
// monitored datapoint (built from the aggregation) or a pre-bound fixed
// datapoint. Throws on any template/blueprint/mapping gap, on an unbound
// fixed input, or on a null aggregated source; blocks zero-stub inputs in
// production. Pure over its inputs — no I/O.
function resolveTemplateInputs(args: {
  template: IsometricGhgEntryTemplate;
  blueprintsByKey: Map<string, IsometricComponentBlueprint>;
  agg: ReturnType<typeof enrichWithFacilityConfig>;
  externalProjectId: string;
  // Removal-wide Isometric Source IDs (Phase 3.5). Threaded into every
  // monitored Datapoint's `source_ids` so the audit trail attaches evidence
  // to each datapoint posted to Isometric.
  sourceIds: string[];
  // Sandbox-only: allow a 0-magnitude stub for PERIOD_INPUT_TUPLES inputs a
  // template still declares (ADR 0005). Off in production — see
  // buildCreateDatapointRequest + docs/open-questions.md.
  allowPeriodInputStub: boolean;
}): ResolvedTemplateInputs {
  const {
    template,
    blueprintsByKey,
    agg,
    externalProjectId,
    sourceIds,
    allowPeriodInputStub,
  } = args;

  const monitored: ResolvedMonitoredInput[] = [];
  const fixed: ResolvedFixedInput[] = [];
  const datapointBodyByKey = new Map<string, CreateDatapointRequest>();
  const unboundFixedInputs: { component: string; inputKey: string }[] = [];

  for (const group of template.groups) {
    for (const component of group.components) {
      const blueprint = blueprintsByKey.get(component.blueprint_key);
      if (!blueprint) {
        throw new SafeError(
          `Blueprint "${component.blueprint_key}" missing from catalog.`,
        );
      }
      for (const rtcInput of component.inputs) {
        if (rtcInput.type === "fixed") {
          if (!rtcInput.datapoint_id) {
            unboundFixedInputs.push({
              component: component.display_name,
              inputKey: rtcInput.input_key,
            });
            continue;
          }
          fixed.push({
            removalTemplateComponentId: component.id,
            inputKey: rtcInput.input_key,
            preboundDatapointId: rtcInput.datapoint_id,
          });
          continue;
        }

        const blueprintInput = blueprint.inputs.find(
          (i) => i.input_key === rtcInput.input_key,
        );
        if (!blueprintInput) {
          throw new SafeError(
            `Blueprint "${blueprint.key}" missing input "${rtcInput.input_key}".`,
          );
        }
        // Don't pre-check the mapping here — buildCreateDatapointRequest
        // already runs the missing-mapping check AND the period-input
        // scope-conflict variant (ADR 0005 §3). A pre-check here would
        // throw the generic missing-mapping error first and swallow the
        // actionable scope-conflict guidance.
        const draft = buildCreateDatapointRequest({
          groupKey: group.key,
          componentBlueprintKey: component.blueprint_key,
          rtcInput,
          blueprintInput,
          agg,
          projectId: externalProjectId,
          supplierRefId: "__placeholder__",
          sourceIds,
          allowPeriodInputStub,
        });
        monitored.push({
          removalTemplateComponentId: component.id,
          componentBlueprintKey: component.blueprint_key,
          inputKey: rtcInput.input_key,
          quantity: {
            magnitude: draft.quantity.magnitude,
            unit: draft.quantity.unit ?? "",
          },
          datapointType: draft.type,
        });
        datapointBodyByKey.set(`${component.id}::${rtcInput.input_key}`, draft);
      }
    }
  }

  if (unboundFixedInputs.length > 0) {
    const lines = unboundFixedInputs
      .map((u) => `  • ${u.component} → ${u.inputKey}`)
      .join("\n");
    throw new SafeError(
      `Template "${template.display_name}" has ${unboundFixedInputs.length} fixed input(s) without a pre-bound datapoint:\n${lines}\nBind each as a constant in the Isometric template editor before submitting.`,
    );
  }

  // ADR 0005 deletes the legacy zero-stub plumbing — period-input families
  // moved to PROJECT scope and the scope-conflict SafeError in
  // buildCreateDatapointRequest catches templates that still declare them
  // here. No production-promotion gate at this layer; pre-deploy gate #4
  // in integration-plan.md now lives in the nightly coverage check.

  return { monitored, fixed, datapointBodyByKey };
}

// The submission unit: one Isometric Removal == one certifierRemovals row.
// Loads the removal's full context (every member credit batch's deduped run
// union + applied-biochar attribution), aggregates ALL runs together with
// linear mass allocation, builds the datapoints/removal payload, claims a
// ledger row keyed on the removal, and POSTs. A completed removal
// short-circuits via `decideSubmissionClaim → return-existing`; a failed or
// locked one resumes. Throws on any aggregation/transport/template gap.
export async function submitRemoval(
  args: SubmitRemovalArgs,
): Promise<RemovalSubmissionResult> {
  const { userId, removalId, confirmProduction } = args;

  // Per-attempt correlation id so the start breadcrumb, boundary logs, and any
  // best-effort warnings for one submit can be tied together in an aggregator.
  const submissionAttemptId = crypto.randomUUID();
  const log = logger.child({
    op: "removal:submit",
    removalId,
    submissionAttemptId,
  });
  log.info("removal submit started");

  const ctx = await loadRemovalSubmissionContext(userId, removalId);
  if (!ctx.mapping) {
    throw new SafeError("Link a facility to an Isometric project first.");
  }
  if (ctx.missingDefaultTemplateId) {
    throw new SafeError(
      "The facility's default removal template was not found in Certify. Refresh the link in facility settings.",
    );
  }
  if (!ctx.defaultTemplate) {
    throw new SafeError("Set a default removal template before submitting.");
  }
  // Pin the narrowed (non-null) template into a const — TS loses narrowing of
  // a property access (`ctx.defaultTemplate`) inside async callbacks below.
  const defaultTemplate = ctx.defaultTemplate;
  // The save path validates this too, but the template lives on Isometric and
  // can change credit_type after binding — a REDUCTION template must never mislabel a GHG entry.
  if (defaultTemplate.credit_type !== "REMOVAL") {
    throw new SafeError(
      "The facility's default template is not a REMOVAL template. Rebind a REMOVAL template in facility settings before submitting.",
    );
  }
  if (ctx.unresolvedBlueprintKeys.length > 0) {
    throw new SafeError(
      `Cannot submit: blueprints out of sync with Certify (${ctx.unresolvedBlueprintKeys.join(", ")}). Refresh in facility settings.`,
    );
  }
  if (defaultTemplate.groups.length === 0) {
    throw new SafeError(
      "Default removal template has no components - nothing to submit.",
    );
  }

  assertProductionConfirmed(confirmProduction);

  if (ctx.memberBatches.length === 0) {
    throw new SafeError("This removal has no credit batches.");
  }

  const lineageWarnings: string[] = [];
  for (const lineage of ctx.lineages) {
    lineageWarnings.push(
      ...lineage.warnings.map(
        (warning) => `Application ${lineage.application.code}: ${warning}`,
      ),
    );
    if (!lineage.productionRun) {
      throw new SafeError(
        `Application ${lineage.application.code} has no linked production run - cannot aggregate.`,
      );
    }
  }
  if (lineageWarnings.length > 0) {
    throw new SafeError(
      `Lineage incomplete for submission:\n${lineageWarnings.join("\n")}`,
    );
  }
  if (ctx.runs.length === 0) {
    throw new SafeError(
      "Production runs not found for the removal's credit batches.",
    );
  }

  const emissionConfig = resolveFacilityEmissionConfig(ctx.mapping);
  const blueprintsByKey = new Map(
    ctx.blueprintsForTemplate.map((bp) => [bp.key, bp]),
  );
  const externalProjectId = ctx.mapping.externalProjectId;
  const mappingGuard: MappingClaimGuard = {
    facilityId: ctx.facilityId,
    provider: ISOMETRIC_PROVIDER,
    expectedExternalProjectId: externalProjectId,
    expectedDefaultRemovalTemplateId: ctx.mapping.defaultRemovalTemplateId,
  };

  // Aggregate every member batch's runs into ONE Removal, applied-scoped:
  // `attributionByRunId` weights each run by the share of its biochar that
  // actually reached an application in this removal (linear mass allocation).
  const baseAgg = aggregateProductionRuns(ctx.runs, ctx.attributionByRunId);
  if (baseAgg.warnings.length > 0) {
    throw new SafeError(
      `Removal submission blocked:\n${baseAgg.warnings.join("\n")}`,
    );
  }

  // D3 fail-closed durability gates: eligibility (per-run mean H/C_org < 0.5 AND
  // O/C_org < 0.2), every Method A run sampled, and ≥3 replicates per sampled
  // run. Computed once in `buildRemovalContext` (method read live off each run's
  // reactor, D6) so the readiness surfaces predict the exact same block; this is
  // the authoritative fail-closed enforcement of that shared result.
  if (ctx.durabilityGateBlockers.length > 0) {
    throw new SafeError(
      `Removal submission blocked — sampling & eligibility:\n${ctx.durabilityGateBlockers.join("\n")}`,
    );
  }

  const transportAgg = enrichWithTransportLegs(baseAgg, ctx.transportLegs);
  // Pooling legs across member batches raises the chance of a mixed
  // method/factor — Isometric Transportation v1.1 §5 requires per-leg
  // accounting, so block submission on those warnings.
  const transportWarnings = transportAgg.warnings.slice(
    baseAgg.warnings.length,
  );
  if (transportWarnings.length > 0) {
    throw new SafeError(
      `Removal transport-leg aggregation — submission blocked:\n${transportWarnings.join("\n")}`,
    );
  }

  const agg = enrichWithFacilityConfig(transportAgg, emissionConfig);

  // Non-blocking: surface (don't block on) submission advisories — e.g.
  // recorded startup/plant diesel the active template has no `fuel_usage_by_volume`
  // component to carry (ADR 0014). The value is simply not submitted; the
  // operator already sees the same warning at readiness.
  if (ctx.submissionWarnings.length > 0) {
    log.warn(
      { submissionWarnings: ctx.submissionWarnings },
      "removal has non-blocking submission warnings",
    );
  }

  // Regenerate the transport evidence ledger from the live legs and mirror it
  // as a Source BEFORE candidate documents are collected, so the current ledger
  // rides into source_ids on this submit (and supersedes any prior one). Done
  // here — before the locked claim transaction below — because it makes HTTP
  // calls to Isometric and inserts a document. The ledger flow owns a
  // per-removal artifact lock for its list/create/retire sequence. Best-effort:
  // a render/mirror hiccup must never block an otherwise-valid submission; the
  // next submit regenerates it. Idempotent on ledger content, so an unchanged-
  // legs resubmit is a no-op.
  try {
    const ledger = await ensureTransportEvidenceLedgerSourceFromContext(
      userId,
      removalId,
      ctx,
    );
    log.info({ ledgerStatus: ledger.status }, "transport evidence ledger ensured");
  } catch (err) {
    log.warn(
      { errorName: err instanceof Error ? err.name : typeof err },
      "transport evidence ledger generation failed; submitting without it",
    );
  }

  // Phase 3.5: mirrored Isometric Source IDs ride into every monitored
  // Datapoint (removal-wide attribution). They are part of the semantic
  // hash so a sources change supersedes the previous Removal version. The
  // resolution is read-only and idempotent; submitRemoval is the canonical
  // place to snapshot the source set because that's when the payload is
  // locked.
  //
  // The candidate-document set is derived deterministically from the chain
  // ctx so it can be re-walked inside the locked transaction below. The
  // first resolution here is the "tentative" set used for the claim
  // decision; the locked re-resolution inside the snapshot insert is the
  // authoritative set, and if it differs we recompute the hash before
  // writing.
  const candidateDocumentIds = await collectCandidateDocumentIdsForRemoval(
    userId,
    {
      lineages: ctx.lineages,
      runs: ctx.runs,
      memberBatchIds: ctx.memberBatches.map((b) => b.id),
    },
  );
  const sourceIds = await resolveSourceIdsForRemoval(userId, {
    candidateDocumentIds,
  });

  // ADR 0005 escape hatch: in SANDBOX, a Removal Template that still declares a
  // period-input tuple (e.g. pyrolyzer_direct concentration) emits a
  // 0-magnitude stub instead of failing closed, so the pipeline can be
  // exercised before the real LCA value lands. Production NEVER stubs — 0 is an
  // over-claim for these positive emissions. See docs/open-questions.md.
  const allowPeriodInputStub = env.ISOMETRIC_ENVIRONMENT === "sandbox";

  const { monitored, fixed, datapointBodyByKey } = resolveTemplateInputs({
    template: defaultTemplate,
    blueprintsByKey,
    agg,
    externalProjectId,
    sourceIds,
    allowPeriodInputStub,
  });

  // The hash is a function of what gets sent to Isometric — the run set and
  // the resolved inputs. Member credit-batch ids are recorded in the snapshot
  // for audit but kept OUT of the hash: a pure-membership change must not
  // POST a duplicate Isometric Removal (the supplier ref carries the version).
  const semanticPayload = {
    removalId,
    templateId: defaultTemplate.id,
    sourceProductionRunIds: [...agg.sourceProductionRunIds].sort(),
    startedOn: agg.earliestStartTime.toISOString(),
    completedOn: agg.latestEndTime.toISOString(),
    // Phase 3.5: sorted, deduped Isometric Source IDs. Hash-covered so
    // mirroring or unmirroring a source forces a new version (supersede).
    sourceIds,
    inputs: [
      ...monitored.map((m) => ({
        rtcId: m.removalTemplateComponentId,
        inputKey: m.inputKey,
        kind: "monitored" as const,
        value: m.quantity.magnitude,
        unit: m.quantity.unit,
        datapointType: m.datapointType,
      })),
      ...fixed.map((f) => ({
        rtcId: f.removalTemplateComponentId,
        inputKey: f.inputKey,
        kind: "fixed" as const,
        preboundDatapointId: f.preboundDatapointId,
      })),
    ].sort((a, b) =>
      `${a.rtcId}::${a.inputKey}`.localeCompare(`${b.rtcId}::${b.inputKey}`),
    ),
  };
  const memberCreditBatchIds = ctx.memberBatches
    .map((b) => b.id)
    .sort((a, b) => a.localeCompare(b));

  // Claim a ledger draft through the submission-ledger module. The module
  // holds the mapping lock plus the per-document mirror locks while it
  // re-resolves source IDs and re-decides the claim — the interlock with
  // unlinkDocumentSource and mirrorDocumentToSource (which acquire the same
  // per-(provider, documentId) advisory locks). Without it, a concurrent
  // unlink could delete a mapping between the unlocked source-id read above
  // and the snapshot insert, orphaning the audit-trail reference.
  const claimed = await claimSubmissionDraft(userId, {
    key: {
      provider: ISOMETRIC_PROVIDER,
      submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: REMOVAL_ENTITY_TYPE,
      localEntityId: removalId,
    },
    guard: mappingGuard,
    policy: { onSubmittedHashChanged: "supersede" },
    tentativeInputs: { semanticPayload, monitored, datapointBodyByKey },
    hashOf: (inputs) => payloadHash(inputs.semanticPayload),
    mirrorDocumentIds: candidateDocumentIds,
    resolve: async (tx, tentative) => {
      // Re-resolve inside the lock. mirror and unlink are now serialized
      // against us, so this result is the authoritative source set. Common
      // case: it matches the tentative set and everything built above
      // remains valid; the rare path rebuilds the template inputs once.
      const lockedSourceIds = await resolveSourceIdsForRemoval(
        userId,
        { candidateDocumentIds },
        tx,
      );
      const sourceIdsChanged =
        lockedSourceIds.length !== sourceIds.length ||
        lockedSourceIds.some((id, i) => id !== sourceIds[i]);
      if (!sourceIdsChanged) return tentative;

      const finalResolved = resolveTemplateInputs({
        template: defaultTemplate,
        blueprintsByKey,
        agg,
        externalProjectId,
        sourceIds: lockedSourceIds,
        allowPeriodInputStub,
      });
      return {
        semanticPayload: {
          ...tentative.semanticPayload,
          sourceIds: lockedSourceIds,
        },
        monitored: finalResolved.monitored,
        datapointBodyByKey: finalResolved.datapointBodyByKey,
      };
    },
    buildSnapshot: ({ inputs, nextVersion }) => {
      const removalSupplierRef = buildRemovalSupplierRef({
        removalId,
        role: "removal",
        version: nextVersion,
      });

      const finalDatapointBodies = inputs.monitored.map((m) => {
        const supplierRefId = buildRemovalSupplierRef({
          removalId,
          role: "datapoint",
          version: nextVersion,
          inputKey: `${m.removalTemplateComponentId}-${m.inputKey}`,
        });
        const draftKey = `${m.removalTemplateComponentId}::${m.inputKey}`;
        const draft = inputs.datapointBodyByKey.get(draftKey);
        if (!draft) {
          // monitored and datapointBodyByKey are produced by the same
          // resolveTemplateInputs pass, so a miss means the two fell out of
          // sync — fail loudly rather than emit a Datapoint body missing
          // its resolved fields.
          throw new SafeError(
            `Internal: no resolved Datapoint body for ${draftKey}. Reload and retry the submission.`,
          );
        }
        return {
          rtcId: m.removalTemplateComponentId,
          inputKey: m.inputKey,
          body: { ...draft, supplier_reference_id: supplierRefId },
        };
      });

      return {
        payloadSnapshot: {
          // ADR 0005 / B3 — content hash of INPUT_MAPPING that produced
          // this payload, surfaced at the top level so an audit query
          // (`WHERE payload_snapshot->>'__mappingRevision' = ?`) can
          // correlate a registry-side issue back to a specific noma
          // mapping revision in git.
          __mappingRevision: MAPPING_REVISION,
          semantic: inputs.semanticPayload,
          memberCreditBatchIds,
          transport: {
            removalSupplierRef,
            datapointBodies: finalDatapointBodies,
          },
        },
      };
    },
  });

  switch (claimed.kind) {
    case "blocked":
      throw new SafeError(REMOVAL_CLAIM_BLOCKED_MESSAGES[claimed.reason]);
    case "existing":
      return {
        removalId,
        externalId: claimed.externalId,
        version: claimed.version,
      };
    case "claimed": {
      if (claimed.reason === "rejected-hash-changed") {
        log.warn(
          { submissionId: claimed.row.id },
          "removal retry will create a new version after rejected row with changed hash",
        );
      }
      // The transport snapshot comes off the claimed row: on resume it is
      // the prior attempt's stored truth; on create it carries the
      // locked-source-id version of the datapoint bodies (which may differ
      // from the tentative `datapointBodyByKey` if a concurrent
      // mirror/unlink shifted the source set during lock acquisition).
      const transport = readRemovalTransport(claimed.row);
      // On resume, the fixed bindings must come from the SAME snapshot as the
      // transport — not the live `fixed` recomputed above, which may have
      // drifted from the version the snapshot was built against.
      const effectiveFixed = claimed.resumed
        ? readRemovalFixedInputs(claimed.row)
        : fixed;
      return runRemovalSubmission({
        userId,
        removalId,
        row: claimed.row,
        transport,
        fixed: effectiveFixed,
        template: defaultTemplate,
        blueprintsByKey,
        agg,
        externalProjectId,
        supersedePreviousId: claimed.supersedePreviousId,
        resumed: claimed.resumed,
        log,
      });
    }
  }
}

interface RunRemovalSubmissionArgs {
  userId: string;
  removalId: string;
  row: CertificationSubmissionRow;
  transport: RemovalTransportSnapshot;
  fixed: ResolvedFixedInput[];
  template: IsometricGhgEntryTemplate;
  blueprintsByKey: Map<string, IsometricComponentBlueprint>;
  agg: Parameters<typeof buildCreateGhgEntryRequest>[0]["agg"];
  externalProjectId: string;
  supersedePreviousId: string | null;
  resumed: boolean;
  /** Attempt-scoped logger (carries submissionAttemptId) from submitRemoval. */
  log: Logger;
}

async function runRemovalSubmission({
  userId,
  removalId,
  row,
  transport,
  fixed,
  template,
  blueprintsByKey,
  agg,
  externalProjectId,
  supersedePreviousId,
  resumed,
  log,
}: RunRemovalSubmissionArgs): Promise<RemovalSubmissionResult> {
  // On resume the datapoint bodies and fixed bindings are snapshot truth, so
  // the removal body's reporting window must also come from the snapshot — not
  // the live `agg`, whose run set may have shifted while the draft was locked.
  // On create, the snapshot was just built from this same `agg`, so the two
  // windows are identical and the override is a no-op.
  const effectiveAgg = resumed
    ? { ...agg, ...readRemovalReportingWindow(row) }
    : agg;

  const datapointIdsByRtcInput = new Map<string, string>();
  for (const f of fixed) {
    datapointIdsByRtcInput.set(
      `${f.removalTemplateComponentId}::${f.inputKey}`,
      f.preboundDatapointId,
    );
  }

  for (const dp of transport.datapointBodies) {
    const supplierRefId = dp.body.supplier_reference_id;
    const { externalId } = await performRegistryCreate({
      userId,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: removalId,
      submissionRowId: row.id,
      operation: `datapoint:create:${dp.inputKey}`,
      requestPayload: dp.body,
      supplierRefId,
      resumed,
      create: () => createDatapoint(dp.body).then((d) => d.id),
      reconcile: () => reconcileDatapoint({ supplierRefId }).then(supplierRefLookup),
      failureMessagePrefix: `Datapoint POST failed for "${dp.inputKey}"`,
      log,
    });
    datapointIdsByRtcInput.set(`${dp.rtcId}::${dp.inputKey}`, externalId);
  }

  const removalBody = buildCreateGhgEntryRequest({
    template,
    blueprintsByKey,
    datapointIdsByRtcInput,
    agg: effectiveAgg,
    projectId: externalProjectId,
    supplierRefId: transport.removalSupplierRef,
  });
  const { externalId: externalRemovalId } = await performRegistryCreate({
    userId,
    entityType: REMOVAL_ENTITY_TYPE,
    entityId: removalId,
    submissionRowId: row.id,
    operation: "removal:create",
    requestPayload: removalBody,
    supplierRefId: transport.removalSupplierRef,
    resumed,
    create: () => createGhgEntry(removalBody).then((r) => r.id),
    reconcile: () =>
      reconcileRemoval({ supplierRefId: transport.removalSupplierRef }).then(
        supplierRefLookup,
      ),
    failureMessagePrefix: "Removal POST failed",
    log,
  });

  await markSubmissionSubmitted(userId, row.id, {
    externalId: externalRemovalId,
    supersedePreviousId,
  });

  // Persist the derived reporting window onto the removal row (best-effort —
  // a failure here doesn't unwind a successful submission).
  try {
    await updateRemovalDates(userId, removalId, {
      startedOn: formatUtcDate(effectiveAgg.earliestStartTime),
      completedOn: formatUtcDate(effectiveAgg.latestEndTime),
    });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "failed to persist removal reporting window",
    );
  }

  if (resumed) {
    await appendSyncEventBestEffort(
      userId,
      {
        provider: ISOMETRIC_PROVIDER,
        entityType: REMOVAL_ENTITY_TYPE,
        entityId: removalId,
        operation: "removal:create:resumed",
        status: "succeeded",
        responsePayload: {
          id: externalRemovalId,
          mapping_revision: MAPPING_REVISION,
        },
      },
      { submissionId: row.id },
    );
  }

  return { removalId, externalId: externalRemovalId, version: row.version };
}

function readRemovalTransport(
  row: CertificationSubmissionRow,
): RemovalTransportSnapshot {
  const snapshot = row.payloadSnapshot as { transport?: unknown } | null;
  const parsed = removalTransportSnapshotSchema.safeParse(snapshot?.transport);
  if (!parsed.success) {
    throw new SafeError(
      "Stale submission cannot be resumed because its transport snapshot does not match the current payload schema.",
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
function readRemovalFixedInputs(
  row: CertificationSubmissionRow,
): ResolvedFixedInput[] {
  const snapshot = row.payloadSnapshot as {
    semantic?: { inputs?: unknown } | null;
  } | null;
  const inputs = snapshot?.semantic?.inputs;
  if (!Array.isArray(inputs)) {
    throw new SafeError(
      "Stale submission cannot be resumed because its payload snapshot does not match the current schema.",
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
        "Stale submission cannot be resumed because its fixed-input snapshot does not match the current schema.",
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

// Reads the reporting window the original attempt locked into the snapshot, for
// the resume path. Returns the two date fields `buildCreateGhgEntryRequest` and
// `updateRemovalDates` read off `agg`, so a resumed removal stamps the window
// the snapshot's datapoints were built for rather than a since-drifted live
// one. Fail-loud like the other snapshot readers: a missing/malformed window
// (pre-dating this field) means the snapshot drifted, so refuse to resume.
function readRemovalReportingWindow(row: CertificationSubmissionRow): {
  earliestStartTime: Date;
  latestEndTime: Date;
} {
  const snapshot = row.payloadSnapshot as {
    semantic?: { startedOn?: unknown; completedOn?: unknown } | null;
  } | null;
  const parsed = reportingWindowSnapshotSchema.safeParse(snapshot?.semantic);
  const earliestStartTime = parsed.success
    ? new Date(parsed.data.startedOn)
    : new Date(NaN);
  const latestEndTime = parsed.success
    ? new Date(parsed.data.completedOn)
    : new Date(NaN);
  if (Number.isNaN(earliestStartTime.getTime()) || Number.isNaN(latestEndTime.getTime())) {
    throw new SafeError(
      "Stale submission cannot be resumed because its reporting-window snapshot does not match the current schema.",
    );
  }
  if (earliestStartTime.getTime() > latestEndTime.getTime()) {
    throw new SafeError(
      "Stale submission cannot be resumed because its reporting-window snapshot has an inverted window (start after end).",
    );
  }
  return { earliestStartTime, latestEndTime };
}
