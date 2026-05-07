/**
 * Clear a stale Phase 3 submission lock.
 *
 * Usage:
 *   pnpm tsx scripts/isometric-clear-stale-lock.ts <creditBatchId>
 *
 * Loads the latest certification_submissions row for that credit batch.
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

const PROVIDER = "isometric" as const;
const SUBMISSION_TYPE = "removal" as const;
const ENTITY_TYPE = "creditBatch" as const;

async function main(): Promise<void> {
  const creditBatchId = process.argv[2];
  if (!creditBatchId) {
    console.error("Usage: pnpm tsx scripts/isometric-clear-stale-lock.ts <creditBatchId>");
    process.exit(1);
  }

  const { db } = await import("../src/db");
  const { certificationSubmissions } = await import(
    "../src/db/schema/certification"
  );
  const { and, desc, eq, sql } = await import("drizzle-orm");

  const [latest] = await db
    .select()
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, PROVIDER),
        eq(certificationSubmissions.submissionType, SUBMISSION_TYPE),
        eq(certificationSubmissions.localEntityType, ENTITY_TYPE),
        eq(certificationSubmissions.localEntityId, creditBatchId),
      ),
    )
    .orderBy(desc(certificationSubmissions.version))
    .limit(1);

  if (!latest) {
    console.log(`No submission rows found for credit batch ${creditBatchId}.`);
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

  const ageMs = Date.now() - latest.lockedAt.getTime();
  if (ageMs < LOCK_TTL_MS) {
    console.log(
      `\nLock is only ${Math.round(ageMs / 1000)}s old (TTL=${LOCK_TTL_MS / 1000}s). Refusing to clear.`,
    );
    process.exit(2);
  }

  await db
    .update(certificationSubmissions)
    .set({
      status: "rejected",
      lockedAt: null,
      updatedAt: sql`now()`,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || jsonb_build_object('lastError', 'stale_lock_cleared_via_cli', 'clearedAt', to_jsonb(now()))`,
    })
    .where(eq(certificationSubmissions.id, latest.id));

  console.log(
    `\nCleared stale lock on submission ${latest.id} (was locked for ${Math.round(ageMs / 1000)}s). Status set to rejected; next submit re-versions.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
