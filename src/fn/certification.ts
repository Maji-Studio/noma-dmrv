"use server";

import { env } from "@/config/env";
import {
  appendSyncEvent,
  deleteCertifierProject,
  getCertifierProjectByFacility,
  getLatestSubmission,
  insertDraftSubmission,
  listAllFacilitiesLinkedByProvider,
  listRecentSyncEvents,
  LOCK_TTL_MS,
  markSubmissionRejected,
  markSubmissionSubmitted,
  upsertCertifierProject,
  type CertificationSubmissionRow,
  type CertifierProjectRow,
  type CertifierSyncEventRow,
  type LinkedFacilitySummary,
} from "@/data-access/certification";
import { getChainOfCustodyData } from "@/data-access/chain-of-custody";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import { SafeError } from "@/lib/errors";
import {
  aggregateProductionRuns,
  buildSupplierRef,
  createDatapoint,
  createRemoval,
  IsometricApiError,
  listComponentBlueprints,
  listProjects,
  listRemovalTemplates,
  payloadHash,
  type CreateDatapointRequest,
  type IsometricComponentBlueprint,
  type IsometricProject,
  type IsometricRemovalTemplate,
} from "@/lib/isometric";
import { buildCreateDatapointRequest, INPUT_MAPPING } from "@/lib/isometric/transformers/datapoint";
import { buildCreateRemovalRequest } from "@/lib/isometric/transformers/removal";
import {
  saveMappingSchema,
  type SaveMappingInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const ISOMETRIC_PROVIDER = "isometric" as const;
const REMOVAL_SUBMISSION_TYPE = "removal" as const;
const CREDIT_BATCH_ENTITY_TYPE = "creditBatch" as const;

async function safeListIfConfigured<T>(call: () => Promise<T[]>): Promise<T[]> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof IsometricApiError && err.code === "not_configured") {
      return [];
    }
    throw err;
  }
}

export interface FacilityCertifierMapping {
  mapping: CertifierProjectRow | null;
  availableProjects: IsometricProject[];
  availableTemplates: IsometricRemovalTemplate[];
  linkHints: Array<{
    externalProjectId: string;
    linkedFacilities: LinkedFacilitySummary[];
  }>;
  isProduction: boolean;
}

export async function loadFacilityCertifierMapping(
  facilityId: string,
): Promise<ActionResult<FacilityCertifierMapping>> {
  return withAction(async (userId) => {
    const [mapping, availableProjects, allLinkedFacilities] = await Promise.all([
      getCertifierProjectByFacility(userId, facilityId, ISOMETRIC_PROVIDER),
      safeListIfConfigured(() => listProjects()),
      listAllFacilitiesLinkedByProvider(userId, ISOMETRIC_PROVIDER),
    ]);

    const availableTemplates = mapping
      ? await safeListIfConfigured(() =>
          listRemovalTemplates(mapping.externalProjectId),
        )
      : [];

    const hintsByProject = new Map<string, LinkedFacilitySummary[]>();
    for (const row of allLinkedFacilities) {
      const bucket = hintsByProject.get(row.externalProjectId) ?? [];
      bucket.push({ facilityId: row.facilityId, code: row.code, name: row.name });
      hintsByProject.set(row.externalProjectId, bucket);
    }
    const linkHints = availableProjects.map((project) => ({
      externalProjectId: project.id,
      linkedFacilities: hintsByProject.get(project.id) ?? [],
    }));

    return {
      mapping,
      availableProjects,
      availableTemplates,
      linkHints,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}

export async function saveFacilityCertifierMapping(
  input: SaveMappingInput,
): Promise<ActionResult<CertifierProjectRow>> {
  return withAction(async (userId) => {
    const parsed = saveMappingSchema.parse(input);

    if (
      env.ISOMETRIC_ENVIRONMENT === "production" &&
      !parsed.confirmProduction
    ) {
      throw new SafeError(
        "Confirm you want to save against the production Isometric environment.",
      );
    }

    const [projects, templates] = await Promise.all([
      listProjects(),
      parsed.defaultRemovalTemplateId
        ? listRemovalTemplates(parsed.externalProjectId)
        : Promise.resolve(null),
    ]);
    if (!projects.some((p) => p.id === parsed.externalProjectId)) {
      throw new SafeError("Selected project does not exist on Isometric.");
    }
    if (
      templates &&
      !templates.some((t) => t.id === parsed.defaultRemovalTemplateId)
    ) {
      throw new SafeError(
        "Selected template does not belong to the chosen project.",
      );
    }

    return upsertCertifierProject(userId, {
      facilityId: parsed.facilityId,
      provider: ISOMETRIC_PROVIDER,
      externalProjectId: parsed.externalProjectId,
      protocolSlug: parsed.protocolSlug,
      protocolVersion: parsed.protocolVersion ?? null,
      defaultRemovalTemplateId: parsed.defaultRemovalTemplateId ?? null,
    });
  });
}

export async function deleteFacilityCertifierMapping(
  facilityId: string,
): Promise<ActionResult<void>> {
  return withAction(async (userId) => {
    await deleteCertifierProject(userId, facilityId, ISOMETRIC_PROVIDER);
  });
}

export async function loadIsometricProjectTemplates(
  externalProjectId: string,
): Promise<ActionResult<IsometricRemovalTemplate[]>> {
  return withAction(async () => {
    return listRemovalTemplates(externalProjectId);
  });
}

export interface CertifyContextForCreditBatch {
  facilityId: string;
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  defaultTemplate: IsometricRemovalTemplate | null;
  missingDefaultTemplateId: string | null;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  isProduction: boolean;
}

async function loadCertifyContextForCreditBatchForUser(
  userId: string,
  creditBatchId: string,
): Promise<CertifyContextForCreditBatch> {
  const isProduction = env.ISOMETRIC_ENVIRONMENT === "production";

  const creditBatch = await getCreditBatchById(userId, creditBatchId);
  if (!creditBatch) {
    throw new SafeError("Credit batch not found");
  }

  const facilityId = creditBatch.facilityId;
  const mapping = await getCertifierProjectByFacility(
    userId,
    facilityId,
    ISOMETRIC_PROVIDER,
  );

  if (!mapping) {
    return {
      facilityId,
      mapping: null,
      project: null,
      defaultTemplate: null,
      missingDefaultTemplateId: null,
      blueprintsForTemplate: [],
      unresolvedBlueprintKeys: [],
      isProduction,
    };
  }

  const [projects, templates] = await Promise.all([
    safeListIfConfigured(() => listProjects()),
    safeListIfConfigured(() => listRemovalTemplates(mapping.externalProjectId)),
  ]);

  const project =
    projects.find((p) => p.id === mapping.externalProjectId) ?? null;

  if (!mapping.defaultRemovalTemplateId) {
    return {
      facilityId,
      mapping,
      project,
      defaultTemplate: null,
      missingDefaultTemplateId: null,
      blueprintsForTemplate: [],
      unresolvedBlueprintKeys: [],
      isProduction,
    };
  }

  const defaultTemplate =
    templates.find((t) => t.id === mapping.defaultRemovalTemplateId) ?? null;

  if (!defaultTemplate) {
    return {
      facilityId,
      mapping,
      project,
      defaultTemplate: null,
      missingDefaultTemplateId: mapping.defaultRemovalTemplateId,
      blueprintsForTemplate: [],
      unresolvedBlueprintKeys: [],
      isProduction,
    };
  }

  const referencedKeys = Array.from(
    new Set(
      defaultTemplate.groups.flatMap((group) =>
        group.components.map((component) => component.blueprint_key),
      ),
    ),
  );

  const allBlueprints = await safeListIfConfigured(() =>
    listComponentBlueprints(),
  );
  const blueprintByKey = new Map(allBlueprints.map((bp) => [bp.key, bp]));

  const blueprintsForTemplate: IsometricComponentBlueprint[] = [];
  const unresolvedBlueprintKeys: string[] = [];
  for (const key of referencedKeys) {
    const found = blueprintByKey.get(key);
    if (found) {
      blueprintsForTemplate.push(found);
    } else {
      unresolvedBlueprintKeys.push(key);
    }
  }

  return {
    facilityId,
    mapping,
    project,
    defaultTemplate,
    missingDefaultTemplateId: null,
    blueprintsForTemplate,
    unresolvedBlueprintKeys,
    isProduction,
  };
}

export async function loadCertifyContextForCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<CertifyContextForCreditBatch>> {
  return withAction(async (userId) =>
    loadCertifyContextForCreditBatchForUser(userId, creditBatchId),
  );
}

// =====================================================================
// Phase 3: credit-batch → Removal submission
// =====================================================================

export interface SubmitCreditBatchResult {
  externalId: string;
  version: number;
}

interface ResolvedMonitoredInput {
  removalTemplateComponentId: string;
  componentBlueprintKey: string;
  inputKey: string;
  // Computed at submission time so that semantic hashing matches what's
  // POSTed (excluding transport-only fields like supplier ref + version).
  quantity: { magnitude: number; unit: string };
  datapointType: string;
}

interface ResolvedFixedInput {
  removalTemplateComponentId: string;
  inputKey: string;
  preboundDatapointId: string;
}

export async function submitCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<SubmitCreditBatchResult>> {
  return withAction(async (userId) => {
    // 1. Resolve context.
    const ctx = await loadCertifyContextForCreditBatchForUser(
      userId,
      creditBatchId,
    );
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
    if (ctx.unresolvedBlueprintKeys.length > 0) {
      throw new SafeError(
        `Cannot submit: blueprints out of sync with Certify (${ctx.unresolvedBlueprintKeys.join(", ")}). Refresh in facility settings.`,
      );
    }
    if (ctx.defaultTemplate.groups.length === 0) {
      throw new SafeError(
        "Default removal template has no components — nothing to submit.",
      );
    }

    const blueprintsByKey = new Map(
      ctx.blueprintsForTemplate.map((bp) => [bp.key, bp]),
    );
    const externalProjectId = ctx.mapping.externalProjectId;

    // 2. Resolve aggregation inputs.
    const creditBatch = await getCreditBatchById(userId, creditBatchId);
    if (!creditBatch) throw new SafeError("Credit batch not found");
    if (creditBatch.applicationIds.length === 0) {
      throw new SafeError("Credit batch has no linked applications.");
    }

    const lineageWarnings: string[] = [];
    const productionRunIds = new Set<string>();
    for (const applicationId of creditBatch.applicationIds) {
      const lineage = await getChainOfCustodyData(userId, applicationId);
      lineageWarnings.push(
        ...lineage.warnings.map((w) => `Application ${lineage.application.code}: ${w}`),
      );
      if (!lineage.productionRun) {
        throw new SafeError(
          `Application ${lineage.application.code} has no linked production run — cannot aggregate.`,
        );
      }
      productionRunIds.add(lineage.productionRun.id);
    }
    if (lineageWarnings.length > 0) {
      throw new SafeError(
        `Lineage incomplete for submission:\n${lineageWarnings.join("\n")}`,
      );
    }

    const runs = await getProductionRunsWithSamples(
      userId,
      Array.from(productionRunIds),
    );
    if (runs.length === 0) {
      throw new SafeError(
        "Production runs not found for the credit batch's applications.",
      );
    }
    const agg = aggregateProductionRuns(runs);

    // 3. Walk the resolved template; classify fixed vs monitored inputs and
    //    pre-build datapoint requests so unit drift surfaces before any HTTP.
    const monitored: ResolvedMonitoredInput[] = [];
    const fixed: ResolvedFixedInput[] = [];
    const datapointBodyByKey = new Map<string, CreateDatapointRequest>();

    for (const group of ctx.defaultTemplate.groups) {
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
              // type=fixed inputs are constants (emission factors, GWPs).
              // They must be pre-bound to a Datapoint in the Isometric
              // template before the template is usable for submission.
              // Phase 3 doesn't auto-create constant datapoints; ask the
              // admin to bind them in the registry UI.
              throw new SafeError(
                `Template "${ctx.defaultTemplate.display_name}" has a fixed input "${rtcInput.input_key}" on component "${component.display_name}" without a pre-bound datapoint. Bind a constant for this input in the Isometric template editor before submitting.`,
              );
            }
            fixed.push({
              removalTemplateComponentId: component.id,
              inputKey: rtcInput.input_key,
              preboundDatapointId: rtcInput.datapoint_id,
            });
            continue;
          }
          // monitored
          const blueprintInput = blueprint.inputs.find(
            (i) => i.input_key === rtcInput.input_key,
          );
          if (!blueprintInput) {
            throw new SafeError(
              `Blueprint "${blueprint.key}" missing input "${rtcInput.input_key}".`,
            );
          }
          const mapping = INPUT_MAPPING[rtcInput.input_key];
          if (!mapping) {
            throw new SafeError(
              `No INPUT_MAPPING entry for input "${rtcInput.input_key}".`,
            );
          }
          const raw = agg[mapping.source];
          if (raw == null) {
            throw new SafeError(
              `Aggregated source ${String(mapping.source)} for input "${rtcInput.input_key}" is null.`,
            );
          }
          // We reuse buildCreateDatapointRequest below with a real
          // supplierRefId, but we need the (magnitude, unit, type) tuple now
          // for semantic hashing. Compute it once via a placeholder ref.
          const draft = buildCreateDatapointRequest({
            rtcInput,
            blueprintInput,
            agg,
            projectId: externalProjectId,
            supplierRefId: "__placeholder__",
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
          datapointBodyByKey.set(
            `${component.id}::${rtcInput.input_key}`,
            draft,
          );
        }
      }
    }

    // Semantic payload — excludes version, supplier_ref, ledger IDs, remote
    // datapoint IDs, datapoint display_name/description.
    const semanticPayload = {
      templateId: ctx.defaultTemplate.id,
      startedOn: agg.earliestStartTime.toISOString(),
      completedOn: agg.latestEndTime.toISOString(),
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
    const semanticHash = payloadHash(semanticPayload);

    // 4. Branch on the latest submission row.
    const latest = await getLatestSubmission(userId, {
      provider: ISOMETRIC_PROVIDER,
      submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: CREDIT_BATCH_ENTITY_TYPE,
      localEntityId: creditBatchId,
    });

    let nextVersion: number;
    let supersedePreviousId: string | null = null;
    if (!latest) {
      nextVersion = 1;
    } else if (latest.status === "draft") {
      const lockedAtMs = latest.lockedAt?.getTime() ?? 0;
      if (Date.now() - lockedAtMs < LOCK_TTL_MS) {
        throw new SafeError("Submission already in progress");
      }
      throw new SafeError(
        "Stale lock detected — run pnpm tsx scripts/isometric-clear-stale-lock.ts <creditBatchId> to recover.",
      );
    } else if (latest.status === "submitted" || latest.status === "accepted") {
      if (latest.payloadHash === semanticHash && latest.externalId) {
        return { externalId: latest.externalId, version: latest.version };
      }
      nextVersion = latest.version + 1;
      supersedePreviousId = latest.id;
    } else {
      // rejected | superseded
      nextVersion = latest.version + 1;
    }

    // 5. Build transport-only payload + insert draft (commits before HTTP).
    const removalSupplierRef = buildSupplierRef({
      creditBatchId,
      role: "removal",
      version: nextVersion,
    });
    const datapointBodies = monitored.map((m) => {
      const supplierRefId = buildSupplierRef({
        creditBatchId,
        role: "datapoint",
        version: nextVersion,
        inputKey: `${m.removalTemplateComponentId}-${m.inputKey}`,
      });
      const draft = datapointBodyByKey.get(
        `${m.removalTemplateComponentId}::${m.inputKey}`,
      )!;
      return {
        rtcId: m.removalTemplateComponentId,
        inputKey: m.inputKey,
        body: { ...draft, supplier_reference_id: supplierRefId },
      };
    });

    const draftRow = await insertDraftSubmission(userId, {
      provider: ISOMETRIC_PROVIDER,
      submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: CREDIT_BATCH_ENTITY_TYPE,
      localEntityId: creditBatchId,
      version: nextVersion,
      payloadSnapshot: {
        semantic: semanticPayload,
        transport: {
          removalSupplierRef,
          datapointBodies: datapointBodies.map((d) => ({
            rtcId: d.rtcId,
            inputKey: d.inputKey,
            body: d.body,
          })),
        },
      },
      payloadHash: semanticHash,
    });

    // 6. POST monitored datapoints sequentially.
    const datapointIdsByRtcInput = new Map<string, string>();
    for (const f of fixed) {
      datapointIdsByRtcInput.set(
        `${f.removalTemplateComponentId}::${f.inputKey}`,
        f.preboundDatapointId,
      );
    }

    for (const dp of datapointBodies) {
      try {
        const created = await createDatapoint(dp.body);
        datapointIdsByRtcInput.set(
          `${dp.rtcId}::${dp.inputKey}`,
          created.id,
        );
        await appendSyncEvent(userId, {
          provider: ISOMETRIC_PROVIDER,
          entityType: CREDIT_BATCH_ENTITY_TYPE,
          entityId: creditBatchId,
          operation: `datapoint:create:${dp.inputKey}`,
          status: "succeeded",
          requestPayload: dp.body,
          responsePayload: { id: created.id, supplier_reference_id: dp.body.supplier_reference_id },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await appendSyncEvent(userId, {
          provider: ISOMETRIC_PROVIDER,
          entityType: CREDIT_BATCH_ENTITY_TYPE,
          entityId: creditBatchId,
          operation: `datapoint:create:${dp.inputKey}`,
          status: "failed",
          requestPayload: dp.body,
          errorMessage: message,
        });
        await markSubmissionRejected(userId, draftRow.id, {
          errorMessage: message,
        });
        throw new SafeError(
          `Datapoint POST failed for "${dp.inputKey}": ${message}`,
        );
      }
    }

    // 7. POST the Removal.
    const removalBody = buildCreateRemovalRequest({
      template: ctx.defaultTemplate,
      blueprintsByKey,
      datapointIdsByRtcInput,
      agg,
      projectId: externalProjectId,
      supplierRefId: removalSupplierRef,
    });
    let removalId: string;
    try {
      const created = await createRemoval(removalBody);
      removalId = created.id;
      await appendSyncEvent(userId, {
        provider: ISOMETRIC_PROVIDER,
        entityType: CREDIT_BATCH_ENTITY_TYPE,
        entityId: creditBatchId,
        operation: "removal:create",
        status: "succeeded",
        requestPayload: removalBody,
        responsePayload: { id: created.id, supplier_reference_id: removalSupplierRef },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendSyncEvent(userId, {
        provider: ISOMETRIC_PROVIDER,
        entityType: CREDIT_BATCH_ENTITY_TYPE,
        entityId: creditBatchId,
        operation: "removal:create",
        status: "failed",
        requestPayload: removalBody,
        errorMessage: message,
      });
      await markSubmissionRejected(userId, draftRow.id, {
        errorMessage: message,
      });
      throw new SafeError(`Removal POST failed: ${message}`);
    }

    // 8. Mark submitted; transactionally supersede previous v if any.
    await markSubmissionSubmitted(userId, draftRow.id, {
      externalId: removalId,
      supersedePreviousId,
    });

    return { externalId: removalId, version: nextVersion };
  });
}

export interface CreditBatchSubmissionState {
  latest: CertificationSubmissionRow | null;
  recentSyncEvents: CertifierSyncEventRow[];
  isLockedInFlight: boolean;
}

export async function loadCreditBatchSubmissionState(
  creditBatchId: string,
): Promise<ActionResult<CreditBatchSubmissionState>> {
  return withAction(async (userId) => {
    const [latest, recentSyncEvents] = await Promise.all([
      getLatestSubmission(userId, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: REMOVAL_SUBMISSION_TYPE,
        localEntityType: CREDIT_BATCH_ENTITY_TYPE,
        localEntityId: creditBatchId,
      }),
      listRecentSyncEvents(userId, {
        entityType: CREDIT_BATCH_ENTITY_TYPE,
        entityId: creditBatchId,
        limit: 10,
      }),
    ]);

    const lockedAtMs = latest?.lockedAt?.getTime() ?? 0;
    const isLockedInFlight =
      latest?.status === "draft" && Date.now() - lockedAtMs < LOCK_TTL_MS;

    return { latest, recentSyncEvents, isLockedInFlight };
  });
}
