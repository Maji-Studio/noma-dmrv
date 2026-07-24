import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import {
  getCertifierProjectByFacility,
  getSubmissionByExternalId,
  markSubmissionSubmitted,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import {
  claimSubmissionDraft,
  getLatestSubmission,
} from "@/data-access/certification-submissions";
import {
  createGhgStatementForRegistryDiscovery,
  getCertifierGhgStatementById,
  hasInFlightGhgStatementForFacility,
  listFacilityIdsForExternalProject,
  listFacilityIdsForExternalRemovals,
  reconcileRemovalMembership,
} from "@/data-access/certifier-ghg-statements";
import { reconcileDiscoveredGhgStatementState } from "@/data-access/certifier-ghg-remote-state";
import { requireOrgFacility } from "@/data-access/utils";
import { SafeError } from "@/lib/errors";
import {
  getGhgStatementPeriod,
  getIsometricClientForOrg,
  listGhgStatementsForProject,
  payloadHash,
  type GhgStatement,
  type GhgStatementStatus,
} from "@/lib/isometric";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
} from "./shared";

const facilityIdSchema = z.uuid();
const CONCURRENT_RECONCILIATION_WARNING =
  "This registry statement is already being reconciled by another request.";
export const SHARED_PROJECT_GHG_CREATE_MESSAGE =
  "GHG statements cannot be created while this Isometric project is shared across multiple noma facilities. Link each facility to a dedicated Isometric project first.";

export function assertDedicatedGhgStatementProject(
  projectFacilityIds: string[],
): void {
  if (new Set(projectFacilityIds).size > 1) {
    throw new SafeError(SHARED_PROJECT_GHG_CREATE_MESSAGE);
  }
}

function assertSingleFacilityRegistryStatement(
  remoteId: string,
  facilityIds: string[],
): void {
  if (new Set(facilityIds).size > 1) {
    throw new SafeError(
      `Registry statement ${remoteId} contains removals from multiple noma facilities. Split it into one statement per facility in Isometric, then sync again.`,
    );
  }
}

export interface RegistryGhgStatementView {
  id: string;
  status: GhgStatementStatus;
  startOn: string | null;
  endOn: string | null;
  removalCount: number;
}

export interface ReconcileRegistryGhgStatementsResult {
  statements: RegistryGhgStatementView[];
  reconciledCount: number;
  warningCount: number;
}

export interface ReconciledRegistryGhgStatement {
  ghgStatementId: string;
  externalId: string;
  linkedRemovalIds: string[];
  warnings: string[];
}

export async function reconcileGhgStatementsForFacility(
  orgCtx: OrgContext,
  facilityId: string,
): Promise<ReconcileRegistryGhgStatementsResult> {
  facilityIdSchema.parse(facilityId);
  await requireOrgFacility(orgCtx, facilityId);
  const project = await getCertifierProjectByFacility(orgCtx, facilityId);
  if (!project) {
    throw new SafeError(
      "Link this facility to an Isometric project before syncing GHG statements.",
    );
  }
  const client = await getIsometricClientForOrg(orgCtx.organizationId);
  const remotes = await listGhgStatementsForProject(
    client,
    project.externalProjectId,
  );
  const projectFacilityIds = await listFacilityIdsForExternalProject(
    orgCtx,
    project.externalProjectId,
  );

  const operatorCreateInFlight =
    await hasInFlightGhgStatementForFacility(orgCtx, facilityId);
  let warningCount = operatorCreateInFlight ? 1 : 0;
  let reconciledCount = 0;
  const ownedRemotes: GhgStatement[] = [];
  for (const remote of remotes) {
    if (operatorCreateInFlight) continue;
    const facilityIds = await listFacilityIdsForExternalRemovals(
      orgCtx,
      remote.ghg_entry_ids,
    );
    assertSingleFacilityRegistryStatement(remote.id, facilityIds);
    const existingSubmission = await getSubmissionByExternalId(orgCtx, {
      provider: ISOMETRIC_PROVIDER,
      submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
      externalId: remote.id,
    });
    if (existingSubmission) {
      const owner = await getCertifierGhgStatementById(
        orgCtx,
        existingSubmission.localEntityId,
      );
      if (owner?.facilityId !== facilityId) continue;
    } else {
      const assignedByMembership =
        facilityIds.length === 1 && facilityIds[0] === facilityId;
      const assignedByUniqueProject =
        facilityIds.length === 0 &&
        projectFacilityIds.length === 1 &&
        projectFacilityIds[0] === facilityId;
      if (!assignedByMembership && !assignedByUniqueProject) {
        warningCount += 1;
        continue;
      }
    }
    ownedRemotes.push(remote);
  }

  // Registry membership is authoritative. Clear removals omitted from their
  // current statement across the whole remote snapshot before linking any
  // additions, so a move A → B converges in one sweep regardless of list
  // order (B can claim only after A has released it).
  for (const remote of ownedRemotes) {
    const existingSubmission = await getSubmissionByExternalId(orgCtx, {
      provider: ISOMETRIC_PROVIDER,
      submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
      externalId: remote.id,
    });
    if (!existingSubmission) continue;
    const owner = await getCertifierGhgStatementById(
      orgCtx,
      existingSubmission.localEntityId,
    );
    if (owner?.facilityId !== facilityId) continue;
    await reconcileRemovalMembership(
      orgCtx,
      owner.id,
      remote.ghg_entry_ids,
      undefined,
      "unlink-only",
    );
  }

  for (const remote of ownedRemotes) {
    const result = await reconcileRegistryGhgStatement(orgCtx, {
      facilityId,
      externalProjectId: project.externalProjectId,
      remote,
    });
    reconciledCount += 1;
    warningCount += result.warnings.length;
  }

  return {
    statements: remotes.map(toRegistryGhgStatementView),
    reconciledCount,
    warningCount,
  };
}

export async function reconcileRegistryGhgStatement(
  orgCtx: OrgContext,
  args: {
    facilityId: string;
    externalProjectId: string;
    remote: GhgStatement;
  },
): Promise<ReconciledRegistryGhgStatement> {
  const period = getGhgStatementPeriod(args.remote);
  const existingSubmission = await getSubmissionByExternalId(orgCtx, {
    provider: ISOMETRIC_PROVIDER,
    submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
    externalId: args.remote.id,
  });
  const existingStatement = existingSubmission
    ? await getCertifierGhgStatementById(
        orgCtx,
        existingSubmission.localEntityId,
      )
    : null;
  if (
    existingSubmission &&
    (!existingStatement || existingStatement.facilityId !== args.facilityId)
  ) {
    throw new SafeError(
      `Registry statement ${args.remote.id} is already linked to another local facility.`,
    );
  }
  const statement =
    existingStatement ??
    (await createGhgStatementForRegistryDiscovery(orgCtx, {
      facilityId: args.facilityId,
      externalId: args.remote.id,
      reportingPeriodEndOn: period.endOn,
    }));
  const key = {
    provider: ISOMETRIC_PROVIDER,
    submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
    localEntityType: GHG_STATEMENT_ENTITY_TYPE,
    localEntityId: statement.id,
  };
  const semanticPayload = {
    source: "registry-discovery",
    externalId: args.remote.id,
    projectId: args.externalProjectId,
    endOn: period.endOn,
  };
  let submission: CertificationSubmissionRow | null = existingSubmission;
  if (!submission) {
    const claimed = await claimSubmissionDraft(orgCtx, {
      key,
      guard: {
        facilityId: args.facilityId,
        provider: ISOMETRIC_PROVIDER,
        expectedExternalProjectId: args.externalProjectId,
      },
      policy: { onSubmittedHashChanged: "invalid-changed-hash" },
      tentativeInputs: semanticPayload,
      hashOf: payloadHash,
      buildSnapshot: ({ inputs }) => ({
        payloadSnapshot: { semantic: inputs },
      }),
    });
    if (claimed.kind === "claimed") {
      await markSubmissionSubmitted(orgCtx, claimed.row.id, {
        externalId: args.remote.id,
        supersedePreviousId: claimed.supersedePreviousId,
      });
      submission = await getLatestSubmission(orgCtx, key, args.facilityId);
    } else {
      submission = await getLatestSubmission(orgCtx, key, args.facilityId);
      if (claimed.kind === "blocked" && claimed.reason === "in-flight") {
        return {
          ghgStatementId: statement.id,
          externalId: args.remote.id,
          linkedRemovalIds: [],
          warnings: [CONCURRENT_RECONCILIATION_WARNING],
        };
      }
      if (
        claimed.kind === "blocked" ||
        claimed.externalId !== args.remote.id ||
        submission?.externalId !== args.remote.id
      ) {
        throw new SafeError(
          `Registry statement ${args.remote.id} could not be reconciled to its local record. Reload and retry.`,
        );
      }
    }
  }
  if (!submission) {
    throw new SafeError(
      `Registry statement ${args.remote.id} could not be reconciled to its local record. Reload and retry.`,
    );
  }

  const membership = await reconcileDiscoveredGhgStatementState(orgCtx, {
    statementId: statement.id,
    submission,
    remote: args.remote,
  });
  return {
    ghgStatementId: statement.id,
    externalId: args.remote.id,
    linkedRemovalIds: membership.linkedRemovalIds,
    warnings: membership.warnings,
  };
}

function toRegistryGhgStatementView(
  statement: GhgStatement,
): RegistryGhgStatementView {
  const period = getGhgStatementPeriod(statement);
  return {
    id: statement.id,
    status: statement.status,
    startOn: period.startOn,
    endOn: period.endOn,
    removalCount: statement.ghg_entry_ids.length,
  };
}
