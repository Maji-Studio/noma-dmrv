import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import {
  getCertifierProjectByFacility,
  markSubmissionSubmitted,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import {
  claimSubmissionDraft,
  getLatestSubmissionWithExecutor,
} from "@/data-access/certification-submissions";
import {
  createGhgStatementForRegistryDiscovery,
  getCertifierGhgStatementById,
  getGhgStatementSubmissionForFacility,
  hasInFlightGhgStatementForFacility,
  listFacilityIdsForExternalProject,
  listFacilityIdsForExternalRemovals,
  reconcileRemovalMembership,
} from "@/data-access/certifier-ghg-statements";
import { reconcileGhgStatementRemoteState } from "@/data-access/certifier-ghg-remote-state";
import { acquireFacilityDurabilityLock } from "@/data-access/facility-durability-lock";
import { requireOrgFacility } from "@/data-access/utils";
import { db, type DbTransaction } from "@/db";
import { SafeError } from "@/lib/errors";
import {
  getGhgStatement,
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
  "GHG Statements cannot be created while this Isometric project is shared across multiple noma facilities. Link each facility to a dedicated Isometric project first.";

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
      `Registry GHG Statement ${remoteId} contains Removals from multiple noma facilities. Split it into one GHG Statement per facility in Isometric, then sync again.`,
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
  // Remote statements this sweep deliberately did not reconcile into this
  // facility — an operator create holding the facility, or a statement whose
  // ownership heuristics point elsewhere. Every skip is counted here, so
  // "nothing happened" is never indistinguishable from "nothing to do".
  skippedCount: number;
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
      "Link this facility to an Isometric project before syncing GHG Statements.",
    );
  }
  const client = await getIsometricClientForOrg(orgCtx.organizationId);
  const listedRemotes = await listGhgStatementsForProject(
    client,
    project.externalProjectId,
  );
  const operatorCreateInFlight =
    await hasInFlightGhgStatementForFacility(orgCtx, facilityId);
  if (operatorCreateInFlight) {
    return {
      statements: listedRemotes.map(toRegistryGhgStatementView),
      reconciledCount: 0,
      warningCount: 1,
      skippedCount: listedRemotes.length,
    };
  }
  // The project list can lag statement membership while the detail endpoint
  // already exposes newly attached GHG Entries. Reconciliation changes local
  // ownership, counts, and submission state, so it must use the authoritative
  // detail representation rather than a potentially stale list summary.
  const remotes = await Promise.all(
    listedRemotes.map((statement) =>
      getGhgStatement(client, statement.id),
    ),
  );
  return db.transaction(async (tx) => {
    await acquireFacilityDurabilityLock(orgCtx, tx, facilityId);
    const lockedOperatorCreateInFlight =
      await hasInFlightGhgStatementForFacility(orgCtx, facilityId, tx);
    if (lockedOperatorCreateInFlight) {
      return {
        statements: remotes.map(toRegistryGhgStatementView),
        reconciledCount: 0,
        warningCount: 1,
        skippedCount: remotes.length,
      };
    }

    const projectFacilityIds = await listFacilityIdsForExternalProject(
      orgCtx,
      project.externalProjectId,
      tx,
    );

    let warningCount = 0;
    let reconciledCount = 0;
    let skippedCount = 0;
    const ownedRemotes: GhgStatement[] = [];
    for (const remote of remotes) {
      const facilityIds = await listFacilityIdsForExternalRemovals(
        orgCtx,
        remote.ghg_entry_ids,
        tx,
      );
      assertSingleFacilityRegistryStatement(remote.id, facilityIds);
      // Ownership is asked per facility, never globally (ADR 0023). A remote
      // statement already mirrored by a DIFFERENT facility's local row no
      // longer blocks this one: each facility keeps its own local identity for
      // the same registry statement, so this facility either already holds it
      // or is re-tested against the same assignment heuristics as a fresh
      // discovery.
      const existingSubmission =
        await getGhgStatementSubmissionForFacility(
          orgCtx,
          { facilityId, externalId: remote.id },
          tx,
        );
      if (!existingSubmission) {
        const assignedByMembership =
          facilityIds.length === 1 && facilityIds[0] === facilityId;
        const assignedByUniqueProject =
          facilityIds.length === 0 &&
          projectFacilityIds.length === 1 &&
          projectFacilityIds[0] === facilityId;
        if (!assignedByMembership && !assignedByUniqueProject) {
          warningCount += 1;
          skippedCount += 1;
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
      const existingSubmission =
        await getGhgStatementSubmissionForFacility(
          orgCtx,
          { facilityId, externalId: remote.id },
          tx,
        );
      if (!existingSubmission) continue;
      const owner = await getCertifierGhgStatementById(
        orgCtx,
        existingSubmission.localEntityId,
        tx,
      );
      if (!owner) continue;
      await reconcileRemovalMembership(
        orgCtx,
        owner.id,
        remote.ghg_entry_ids,
        tx,
        "unlink-only",
      );
    }

    for (const remote of ownedRemotes) {
      const result = await reconcileRegistryGhgStatement(
        orgCtx,
        {
          facilityId,
          externalProjectId: project.externalProjectId,
          remote,
        },
        tx,
      );
      reconciledCount += 1;
      warningCount += result.warnings.length;
    }

    return {
      statements: remotes.map(toRegistryGhgStatementView),
      reconciledCount,
      warningCount,
      skippedCount,
    };
  });
}

// Read-only companion to `reconcileGhgStatementsForFacility`: the project's
// registry statements as the operator would see them, with NO local writes.
// The create dialog only needs this view, and a dialog opening must not
// silently reconcile (issue: read-that-writes).
export async function listRegistryGhgStatementsForFacility(
  orgCtx: OrgContext,
  facilityId: string,
): Promise<RegistryGhgStatementView[]> {
  facilityIdSchema.parse(facilityId);
  await requireOrgFacility(orgCtx, facilityId);
  const project = await getCertifierProjectByFacility(orgCtx, facilityId);
  if (!project) {
    throw new SafeError(
      "Link this facility to an Isometric project before syncing GHG Statements.",
    );
  }
  const client = await getIsometricClientForOrg(orgCtx.organizationId);
  const remotes = await listGhgStatementsForProject(
    client,
    project.externalProjectId,
  );
  return remotes.map(toRegistryGhgStatementView);
}

export async function reconcileRegistryGhgStatement(
  orgCtx: OrgContext,
  args: {
    facilityId: string;
    externalProjectId: string;
    remote: GhgStatement;
  },
  tx?: DbTransaction,
): Promise<ReconciledRegistryGhgStatement> {
  const executor = tx ?? db;
  const period = getGhgStatementPeriod(args.remote);
  // Facility-scoped by construction (ADR 0023): another facility's mirror of
  // the same registry statement is not this facility's business and must not
  // be adopted, nor block this facility from minting its own.
  const existingSubmission = await getGhgStatementSubmissionForFacility(
    orgCtx,
    { facilityId: args.facilityId, externalId: args.remote.id },
    executor,
  );
  const existingStatement = existingSubmission
    ? await getCertifierGhgStatementById(
        orgCtx,
        existingSubmission.localEntityId,
        executor,
      )
    : null;
  if (existingSubmission && !existingStatement) {
    throw new SafeError(
      `Registry GHG Statement ${args.remote.id} could not be synced. Refresh the page and try again.`,
    );
  }
  const statement =
    existingStatement ??
    (await createGhgStatementForRegistryDiscovery(
      orgCtx,
      {
        facilityId: args.facilityId,
        externalId: args.remote.id,
        reportingPeriodEndOn: period.endOn,
      },
      executor,
    ));
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
    const claimed = await claimSubmissionDraft(
      orgCtx,
      {
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
      },
      tx,
    );
    if (claimed.kind === "claimed") {
      await markSubmissionSubmitted(
        orgCtx,
        claimed.row.id,
        {
          externalId: args.remote.id,
          supersedePreviousId: claimed.supersedePreviousId,
        },
        tx,
      );
      submission = await getLatestSubmissionWithExecutor(
        orgCtx,
        executor,
        key,
        args.facilityId,
      );
    } else {
      submission = await getLatestSubmissionWithExecutor(
        orgCtx,
        executor,
        key,
        args.facilityId,
      );
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
          `Registry GHG Statement ${args.remote.id} could not be synced. Refresh the page and try again.`,
        );
      }
    }
  }
  if (!submission) {
    throw new SafeError(
      `Registry GHG Statement ${args.remote.id} could not be synced. Refresh the page and try again.`,
    );
  }

  const membership = await reconcileGhgStatementRemoteState(
    orgCtx,
    {
      statementId: statement.id,
      submission,
      remote: args.remote,
    },
    tx,
  );
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
