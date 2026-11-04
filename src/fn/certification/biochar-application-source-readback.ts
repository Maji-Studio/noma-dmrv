import {
  listBiocharApplicationSourceReadbacks,
  markBiocharApplicationDrift,
  recordBiocharApplicationSourceReadback,
} from "@/data-access/certifier-biochar-applications";
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { IsometricClient } from "@/lib/isometric/client";
import {
  classifySourceReadback,
  failClosedOnEmptySources,
  readBiocharApplicationSources,
  type SourceReadbackOutcome,
} from "@/lib/isometric/biochar-application-source-readback";
import type { Logger } from "@/lib/log";

const MAX_EVIDENCE_LINK_RECHECKS_PER_LOAD = 3;
// Isometric can return an Application before its Sources are attached. Give
// the registry a few seconds, then treat a still-empty list as a mismatch.
const SOURCE_ATTACH_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/** Persisted Application evidence-link counts and the latest attempted check time. */
export interface RemovalEvidenceLinks {
  unconfirmedCount: number;
  mismatchCount: number;
  checkedAt: string | null;
}

export async function checkBiocharApplicationSourceReadback(args: {
  orgCtx: OrgContext;
  client: IsometricClient;
  registrationId: string;
  applicationCode: string;
  externalProjectId: string;
  externalApplicationId: string;
  externalStorageLocationId: string;
  expectedSourceIds: readonly string[];
  sourceReadbackStatus: string;
  log: Logger;
}): Promise<void> {
  if (args.expectedSourceIds.length === 0 || args.sourceReadbackStatus === "confirmed") return;
  const notAttached = (outcome: SourceReadbackOutcome) =>
    outcome.outcome === "unconfirmed" && outcome.reason === "sources_not_attached";
  let result = classifySourceReadback(args.expectedSourceIds,
    await readBiocharApplicationSources(args.client, args));
  const sawEmpty = notAttached(result);
  for (const delayMs of SOURCE_ATTACH_RETRY_DELAYS_MS) {
    if (!notAttached(result)) break;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    result = classifySourceReadback(args.expectedSourceIds,
      await readBiocharApplicationSources(args.client, args));
  }
  // Isometric answered with no Sources at all. A later read that gives no
  // answer cannot erase that, so only a real match lets submission continue.
  if (sawEmpty && result.outcome === "unconfirmed") {
    result = failClosedOnEmptySources(args.expectedSourceIds,
      { outcome: "unconfirmed", reason: "sources_not_attached" });
  }
  if (args.sourceReadbackStatus === "mismatch" && result.outcome === "unconfirmed") {
    // Registration confirmation clears drift, but no answer cannot clear the
    // last authoritative mismatch. Restore the submission blocker on retry.
    await markBiocharApplicationDrift(args.orgCtx, args.registrationId, "source_set_mismatch");
    throw new SafeError(
      `Application ${args.applicationCode}: Isometric could not confirm a corrected evidence set. Retry the Removal submission later.`,
    );
  }
  await recordBiocharApplicationSourceReadback(args.orgCtx, args.registrationId, result.outcome);
  if (result.outcome === "mismatch") {
    args.log.error({ registrationId: args.registrationId, externalApplicationId: args.externalApplicationId,
      externalProjectId: args.externalProjectId, reason: result.reason, missing: result.missing,
      unexpected: result.unexpected }, "Biochar Application evidence link mismatch on submission");
    await markBiocharApplicationDrift(args.orgCtx, args.registrationId, "source_set_mismatch");
    throw new SafeError(
      `Application ${args.applicationCode}'s registry evidence links do not match its reviewed Sources. Reconcile its supporting evidence before retrying the Removal submission.`,
    );
  }
  if (result.outcome === "unconfirmed") {
    args.log.warn({ registrationId: args.registrationId, externalApplicationId: args.externalApplicationId,
      externalProjectId: args.externalProjectId, reason: result.reason }, "Biochar Application evidence links not confirmed");
  }
}

/** Best-effort refresh: a registry or persistence failure cannot hide the summary. */
export async function refreshRemovalEvidenceLinks(
  ctx: OrgContext,
  submissionId: string | null,
  log: Logger,
): Promise<RemovalEvidenceLinks> {
  const summary: RemovalEvidenceLinks = { unconfirmedCount: 0, mismatchCount: 0, checkedAt: null };
  if (!submissionId) return summary;
  let rows: Awaited<ReturnType<typeof listBiocharApplicationSourceReadbacks>>;
  try {
    rows = await listBiocharApplicationSourceReadbacks(ctx, submissionId);
  } catch {
    log.warn({ submissionId, reason: "readback_state_unavailable" }, "Could not load Application evidence link checks");
    return summary;
  }
  const eligible = rows.filter(row =>
    (row.sourceReadbackStatus === "unconfirmed" || row.sourceReadbackStatus === "mismatch") &&
    row.lifecycleStatus === "confirmed" && row.externalApplicationId && row.expectedSourceIds.length > 0);
  const rechecks = [
    ...eligible.filter(row => row.sourceReadbackStatus === "unconfirmed"),
    ...eligible.filter(row => row.sourceReadbackStatus === "mismatch"),
  ].slice(0, MAX_EVIDENCE_LINK_RECHECKS_PER_LOAD);
  if (rechecks.length > 0) {
    const clientPromise = resolveIsometricClient(ctx);
    const results = await Promise.allSettled(rechecks.map(async row => {
      const client = await clientPromise;
      // A reload runs after the attach wait, so an empty list is a mismatch here.
      const result = failClosedOnEmptySources(row.expectedSourceIds,
        classifySourceReadback(row.expectedSourceIds, await readBiocharApplicationSources(client, {
          externalProjectId: row.externalProjectId, externalApplicationId: row.externalApplicationId!,
          externalStorageLocationId: row.externalStorageLocationId,
        })));
      const status = row.sourceReadbackStatus === "mismatch" && result.outcome === "unconfirmed"
        ? "mismatch" : result.outcome;
      const saved = await recordBiocharApplicationSourceReadback(ctx, row.id, status);
      return { result, saved };
    }));
    results.forEach((settled, index) => {
      const row = rechecks[index];
      const ids = { submissionId, registrationId: row.id, externalApplicationId: row.externalApplicationId,
        externalProjectId: row.externalProjectId };
      if (settled.status === "rejected") {
        // Never serialize thrown errors: credential resolvers and transports may
        // carry sensitive context. Retain the last successfully persisted state.
        log.warn({ ...ids, reason: "recheck_unavailable" }, "Could not refresh Application evidence links");
        return;
      }
      const { result, saved } = settled.value;
      row.sourceReadbackStatus = saved.sourceReadbackStatus;
      row.sourceReadbackCheckedAt = saved.sourceReadbackCheckedAt;
      if (result.outcome === "mismatch") {
        log.error({ ...ids, reason: result.reason, missing: result.missing, unexpected: result.unexpected },
          "Biochar Application evidence link mismatch on summary refresh");
      } else if (result.outcome === "unconfirmed") {
        log.warn({ ...ids, reason: result.reason }, "Biochar Application evidence links not confirmed");
      }
    });
  }
  for (const row of rows) {
    const status = row.sourceReadbackStatus;
    if (status === "unconfirmed") summary.unconfirmedCount++;
    if (status === "mismatch") summary.mismatchCount++;
    const iso = row.sourceReadbackCheckedAt?.toISOString() ?? null;
    if (iso && (!summary.checkedAt || iso > summary.checkedAt)) summary.checkedAt = iso;
  }
  return summary;
}
