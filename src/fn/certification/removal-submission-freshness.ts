import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { payloadHash } from "@/lib/isometric";
import { isSequestrationBlueprintKey } from "@/lib/isometric/transformers/measurement-sample";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import { DURABILITY_MEASUREMENT_SAMPLES_ENABLED } from "./durability-measurement-samples";
import { retireClaimedRemovalDraftForDrift } from "./production-claim-gate";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";

export async function assertClaimedRemovalPayloadFresh(args: {
  orgCtx: OrgContext;
  removalId: string;
  row: CertificationSubmissionRow;
  allowPeriodInputStub: boolean;
  preserveForReconciliation: boolean;
}): Promise<void> {
  const { orgCtx, removalId, row, allowPeriodInputStub } = args;
  const retireForDrift = (reason: string) =>
    retireClaimedRemovalDraftForDrift({
      orgCtx,
      submissionId: row.id,
      reason,
      preserveForReconciliation: args.preserveForReconciliation,
    });
  const freshCtx = await loadRemovalSubmissionContext(orgCtx, removalId);
  if (
    !freshCtx.mapping ||
    freshCtx.missingDefaultTemplateId ||
    !freshCtx.defaultTemplate ||
    freshCtx.defaultTemplate.credit_type !== "REMOVAL" ||
    freshCtx.unresolvedBlueprintKeys.length > 0 ||
    freshCtx.defaultTemplate.groups.length === 0
  ) {
    await retireForDrift("semantic payload rebuild failed after draft claim");
    throw new SafeError(
      "Removal source data or template configuration changed while preparing this submission. The draft was retired; reload and submit again.",
    );
  }
  const freshHasDurabilityComponents = freshCtx.defaultTemplate.groups.some(
    (group) =>
      group.components.some((component) =>
        isSequestrationBlueprintKey(component.blueprint_key),
      ),
  );
  if (freshHasDurabilityComponents && !DURABILITY_MEASUREMENT_SAMPLES_ENABLED) {
    await retireForDrift(
      "durability measurement-sample gate changed after draft claim",
    );
    throw new SafeError(
      "Removal template configuration changed while preparing this submission. The draft was retired; reload and submit again.",
    );
  }

  let freshBuild: Awaited<ReturnType<typeof buildRemovalSubmissionBuild>>;
  try {
    freshBuild = await buildRemovalSubmissionBuild({
      orgCtx,
      removalId,
      ctx: freshCtx,
      defaultTemplate: freshCtx.defaultTemplate,
      blueprintsByKey: new Map(
        freshCtx.blueprintsForTemplate.map((blueprint) => [
          blueprint.key,
          blueprint,
        ]),
      ),
      externalProjectId: freshCtx.mapping.externalProjectId,
      allowPeriodInputStub,
      hasDurabilityComponents: freshHasDurabilityComponents,
    });
  } catch (error) {
    await retireForDrift("semantic payload rebuild failed after draft claim");
    throw error;
  }
  const freshHash = payloadHash(freshBuild.semanticPayload);
  if (freshHash === row.payloadHash) return;

  await retireForDrift(
    `semantic payload drift: snapshot ${String(row.payloadHash)} != current ${freshHash}`,
  );
  throw new SafeError(
    "Removal source data changed while preparing this submission. The stale draft was retired; reload and submit again.",
  );
}
