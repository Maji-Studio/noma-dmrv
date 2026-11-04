import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/db/schema';
import { getPgPoolConfig, isLocalDatabaseTarget } from '@/lib/pg-pool-config';
import { organizations } from '@/db/schema';
import { requireOrgContext } from '@/lib/auth/server';
import { DomainError } from '@/lib/domain-errors';
import { SafeError } from '@/lib/errors';
import { listFeedstockRecalculationBins, recalculateFeedstockBin } from '@/data-access/feedstock-recalculation';
import { resolveCliAdminIdentity, runWithCliOrgContext } from './org-context';

const DRY_RUN_ROLLBACK = new Error('Dry run rollback');

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'include-sent': { type: 'boolean', default: false },
      'allow-remote-include-sent': { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values['include-sent'] && process.env.NODE_ENV === 'production') throw new SafeError('--include-sent is not allowed in production.');
  if (!process.env.DATABASE_URL) throw new SafeError('DATABASE_URL is required');
  if (values['include-sent'] && !values['allow-remote-include-sent'] && !isLocalDatabaseTarget(process.env.DATABASE_URL)) {
    throw new SafeError('--include-sent requires a local database. Use --allow-remote-include-sent only for the documented staging rebuild in docs/database.md.');
  }
  const pool = new Pool(getPgPoolConfig(process.env.DATABASE_URL));
  const db = drizzle(pool, { schema });
  try {
    // org-scope-ok: privileged CLI enumerates organizations; each bin is processed under a verified CLI org context.
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const organization of orgs) await runWithCliOrgContext(await resolveCliAdminIdentity(organization.id, db), async () => {
      const ctx = await requireOrgContext();
      const bins = await listFeedstockRecalculationBins(ctx, db);
      for (const bin of bins) {
        let summary: Awaited<ReturnType<typeof recalculateFeedstockBin>> | undefined;
        const recalculate = async () => {
          try {
            await db.transaction(async tx => {
              summary = await recalculateFeedstockBin(ctx, tx, bin.id, { allowSentRewrite: values['include-sent'] });
              if (values['dry-run']) throw DRY_RUN_ROLLBACK;
            });
          } catch (error) { if (error !== DRY_RUN_ROLLBACK) throw error; }
        };
        try {
          await recalculate();
          console.log(JSON.stringify({ organizationId: ctx.organizationId, dryRun: values['dry-run'], ...summary }));
          if (summary?.keptSentRuns.length) console.warn(`Bin ${bin.code}: kept Sent runs ${summary.keptSentRuns.map(run => run.code).join(', ')} (Removals ${[...new Set(summary.keptSentRuns.flatMap(run => run.removalCodes))].join(', ')}). Their credit batches keep the old allocation until the Removal is returned.`);
          if (summary?.runsRefused) process.exitCode = 1;
        } catch (error) {
          console.log(JSON.stringify({ organizationId: ctx.organizationId, code: bin.code, dryRun: values['dry-run'],
            error: error instanceof DomainError ? error.code : error instanceof SafeError ? error.message : 'Recalculation failed' }));
          process.exitCode = 1;
        }
      }
    }, db);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  // Domain and safe errors name record codes only; anything else prints its class, never driver detail.
  const reason = error instanceof DomainError ? `${error.code}: ${error.message}` : error instanceof SafeError ? error.message : error instanceof Error ? error.name : 'unknown error';
  console.error(`Feedstock recalculation failed (${reason}). No changes were committed for the failing bin.`);
  process.exitCode = 1;
});
