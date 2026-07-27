import type { CertificationSubmissionRow } from "@/data-access/certification";
import { updateRemovalSourceBindingVerification } from "@/data-access/certifier-removals";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { IsometricClient } from "@/lib/isometric";
import {
  verifyRemovalSourceBindings,
  type RemovalSourceBindingVerification,
} from "@/lib/isometric/source-binding-verification";
import { sanitizeErrorMessage, type Logger } from "@/lib/log";
import { readRemovalSourceBindingPlan } from "./removal-snapshot-readers";
import {
  appendSyncEventBestEffort,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
} from "./shared";

function storedPlanEntryCount(row: CertificationSubmissionRow): number {
  const snapshot = row.payloadSnapshot as {
    sourceBindingPlan?: unknown[];
  } | null;
  return Array.isArray(snapshot?.sourceBindingPlan)
    ? snapshot.sourceBindingPlan.length
    : 0;
}

export async function verifyAndPersistRemovalSourceBindings(args: {
  client: IsometricClient;
  orgCtx: OrgContext;
  removalId: string;
  submissionRow: CertificationSubmissionRow;
  externalRemovalId: string;
  log: Logger;
}): Promise<void> {
  const checkedAt = new Date().toISOString();
  let verification: RemovalSourceBindingVerification | null = null;
  let terminalErrorMessage: string | null = null;
  let plan: ReturnType<typeof readRemovalSourceBindingPlan> | null = null;

  try {
    plan = readRemovalSourceBindingPlan(args.submissionRow);
  } catch (error) {
    const totalCount = storedPlanEntryCount(args.submissionRow);
    if (error instanceof SafeError) {
      terminalErrorMessage = error.message;
      verification = {
        state: "mismatch",
        verifiedCount: 0,
        totalCount,
        mismatches: [],
      };
    } else {
      verification = {
        state: "awaiting_sync",
        verifiedCount: 0,
        totalCount,
        mismatches: [],
        awaitingTargets: [],
      };
    }
    args.log.warn(
      {
        submissionId: args.submissionRow.id,
        err: sanitizeErrorMessage(error),
      },
      error instanceof SafeError
        ? "removal Source binding verification requires resubmission"
        : "removal Source binding verification awaiting sync",
    );
  }

  if (plan) {
    try {
      verification = await verifyRemovalSourceBindings(
        args.client,
        args.externalRemovalId,
        plan,
      );
    } catch (error) {
      verification = {
        state: "awaiting_sync",
        verifiedCount: 0,
        totalCount: plan.length,
        mismatches: [],
        awaitingTargets: [],
      };
      args.log.warn(
        {
          submissionId: args.submissionRow.id,
          err: sanitizeErrorMessage(error),
        },
        "removal Source binding verification awaiting sync",
      );
    }
  }

  if (!verification) {
    throw new Error("Removal Source binding verification state was not set.");
  }

  try {
    await updateRemovalSourceBindingVerification(args.orgCtx, args.removalId, {
      submissionId: args.submissionRow.id,
      submissionVersion: args.submissionRow.version,
      state: verification.state,
      checkedAt,
      verifiedCount: verification.verifiedCount,
      totalCount: verification.totalCount,
    });
  } catch (error) {
    args.log.warn(
      {
        submissionId: args.submissionRow.id,
        err: sanitizeErrorMessage(error),
      },
      "failed to persist Removal Source binding verification",
    );
  }

  await appendSyncEventBestEffort(
    args.orgCtx,
    {
      provider: ISOMETRIC_PROVIDER,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: args.removalId,
      operation: "removal:source-bindings:verify",
      status: verification.state === "verified" ? "succeeded" : "failed",
      responsePayload: {
        state: verification.state,
        verified_count: verification.verifiedCount,
        total_count: verification.totalCount,
        mapping_revisions: Array.from(
          new Set(
            ((args.submissionRow.payloadSnapshot as {
              sourceBindingPlan?: Array<{ mappingRevision?: unknown }>;
            } | null)?.sourceBindingPlan ?? [])
              .map((entry) => entry.mappingRevision)
              .filter(
                (revision): revision is string =>
                  typeof revision === "string",
              ),
          ),
        ),
      },
      ...(verification.state === "mismatch"
        ? {
            errorMessage:
              terminalErrorMessage ??
              "One or more Sources are not attached to their intended Removal Datapoint targets.",
          }
        : {}),
    },
    { submissionId: args.submissionRow.id },
  );
}
