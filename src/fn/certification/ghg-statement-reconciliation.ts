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
  reconcileRemovalMembership,
  updateGhgStatementReportingWindow,
} from "@/data-access/certifier-ghg-statements";
import { requireOrgFacility } from "@/data-access/utils";
import { db } from "@/db";
import { SafeError } from "@/lib/errors";
import {
  getGhgStatementPeriod,
  getIsometricClientForOrg,
  listGhgStatementsForProject,
  payloadHash,
  type GhgStatement,
  type GhgStatementStatus,
} from "@/lib/isometric";
import { applyGhgRemoteState } from "./ghg-statement-remote-state";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
} from "./shared";

const facilityIdSchema = z.string().uuid();

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

  let warningCount = 0;
  for (const remote of remotes) {
    const result = await reconcileRegistryGhgStatement(orgCtx, {
      facilityId,
      externalProjectId: project.externalProjectId,
      remote,
    });
    warningCount += result.warnings.length;
  }

  return {
    statements: remotes.map(toRegistryGhgStatementView),
    reconciledCount: remotes.length,
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

  return db.transaction(async (tx) => {
    const membership = await reconcileRemovalMembership(
      orgCtx,
      statement.id,
      args.remote.ghg_entry_ids,
      tx,
    );
    await updateGhgStatementReportingWindow(
      orgCtx,
      statement.id,
      {
        reportingPeriodStartOn: period.startOn,
        reportingPeriodEndOn: period.endOn,
        remotePeriodMissing: period.endOn === null,
      },
      tx,
    );
    await applyGhgRemoteState(orgCtx, submission, args.remote, {}, tx);
    return {
      ghgStatementId: statement.id,
      externalId: args.remote.id,
      linkedRemovalIds: membership.linkedRemovalIds,
      warnings: membership.warnings,
    };
  });
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
