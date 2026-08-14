/**
 * Clear a stale Phase 3 submission lock.
 *
 * Usage:
 *   pnpm tsx scripts/isometric-clear-stale-lock.ts <removalId> [entityType]
 *
 * Loads the latest certification_submissions row for that Removal (ledger
 * rows are keyed localEntityType='removal', localEntityId=certifierRemovals.id;
 * pass 'creditBatch' as the second argument only for pre-Removal legacy rows).
 * Refuses to clear unless the lock is older than LOCK_TTL_MS. On success,
 * marks the row as 'rejected' (so the orchestrator's branch-f path applies
 * on the next submit) and stamps an explanatory entry into metadata.
 *
 * This is the only path to clear locks until Phase 4 reconciliation; it is
 * intentionally not exposed as a server action because requireAuth() in this
 * project is presence-only (no admin gate).
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { LOCK_TTL_MS } from "../src/lib/isometric/utils/lock";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "../src/lib/isometric/utils/constants";
import { SUBMISSION_METADATA_KEYS } from "../src/lib/certification/submission-metadata";

const PROVIDER = ISOMETRIC_PROVIDER;
const SUBMISSION_TYPE = REMOVAL_SUBMISSION_TYPE;
// Ledger rows predating the Removal model were keyed by credit batch.
const LEGACY_CREDIT_BATCH_ENTITY_TYPE = "creditBatch" as const;
const ENTITY_TYPES = [
  REMOVAL_ENTITY_TYPE,
  LEGACY_CREDIT_BATCH_ENTITY_TYPE,
] as const;

async function main(): Promise<void> {
  const localEntityId = process.argv[2];
  const entityType = process.argv[3] ?? REMOVAL_ENTITY_TYPE;
  if (
    !localEntityId ||
    !ENTITY_TYPES.includes(entityType as (typeof ENTITY_TYPES)[number])
  ) {
    console.error(
      `Usage: pnpm tsx scripts/isometric-clear-stale-lock.ts <removalId> [${ENTITY_TYPES.join("|")}]`,
    );
    process.exit(1);
  }

  const { db } = await import("../src/db");
  const { certificationSubmissions } = await import(
    "../src/db/schema/certification"
  );
  const { and, desc, eq, lte, sql } = await import("drizzle-orm");

  const [latest] = await db
    .select()
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, PROVIDER),
        eq(certificationSubmissions.submissionType, SUBMISSION_TYPE),
        eq(certificationSubmissions.localEntityType, entityType),
        eq(certificationSubmissions.localEntityId, localEntityId),
      ),
    )
    .orderBy(desc(certificationSubmissions.version))
    .limit(1);

  if (!latest) {
    console.log(
      `No submission rows found for ${entityType} ${localEntityId}.`,
    );
    process.exit(0);
  }

  console.log("Latest submission row:");
  console.log(JSON.stringify(latest, null, 2));

  if (latest.status !== "draft" || !latest.lockedAt) {
    console.log(
      `\nRow is not draft+locked (status=${latest.status}). Nothing to clear.`,
    );
    process.exit(0);
  }

  // Rejecting a draft whose attempt already reached the registry re-versions
  // the supplier references on the next submit, so the pre-POST reconcile
  // finds nothing and the registry gets duplicate entries. Refuse unless the
  // operator has verified registry state and explicitly overrides.
  const externalMutation = (latest.metadata as Record<string, unknown> | null)?.[
    SUBMISSION_METADATA_KEYS.externalMutation
  ];
  const forceConfirmed = process.argv.includes("--force-confirmed");
  if (
    (externalMutation === "possible" || externalMutation === "confirmed") &&
    !forceConfirmed
  ) {
    console.log(
      `\nRefusing to clear: metadata.externalMutation=${externalMutation} - a registry write may already exist for this draft. Clearing re-versions the supplier refs and can duplicate registry entries. Verify the registry state first, then re-run with --force-confirmed to override.`,
    );
    process.exit(4);
  }

  const ageMs = Date.now() - latest.lockedAt.getTime();
  if (ageMs < LOCK_TTL_MS) {
    console.log(
      `\nLock is only ${Math.round(ageMs / 1000)}s old (TTL=${LOCK_TTL_MS / 1000}s). Refusing to clear.`,
    );
    process.exit(2);
  }

  const staleCutoff = new Date(Date.now() - LOCK_TTL_MS);

  // Atomic update: include draft status + stale lock age in the WHERE clause so
  // an active writer that refreshed the lock cannot be cleared.
  const updated = await db
    .update(certificationSubmissions)
    .set({
      status: "rejected",
      lockedAt: null,
      updatedAt: sql`now()`,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || jsonb_build_object('lastError', 'stale_lock_cleared_via_cli', 'clearedAt', to_jsonb(now()))`,
    })
    .where(
      and(
        eq(certificationSubmissions.id, latest.id),
        eq(certificationSubmissions.status, "draft"),
        lte(certificationSubmissions.lockedAt, staleCutoff),
      ),
    )
    .returning({ id: certificationSubmissions.id });

  if (updated.length !== 1) {
    console.log(
      `\nRow changed since read (concurrent writer?). No update applied.`,
    );
    process.exit(3);
  }

  console.log(
    `\nCleared stale lock on submission ${latest.id} (was locked for ${Math.round(ageMs / 1000)}s). Status set to rejected; next submit re-versions.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
