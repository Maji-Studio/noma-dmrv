import { parseArgs } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizations, storageLocations } from '@/db/schema';
import { requireOrgContext } from '@/lib/auth/server';
import { DomainError } from '@/lib/domain-errors';
import { SafeError } from '@/lib/errors';
import { recalculateFeedstockBin } from '@/data-access/feedstock-recalculation';
import { withSentFeedstockRecalculation } from '@/lib/feedstock-recalculation-policy';
import { resolveCliAdminIdentity, runWithCliOrgContext } from './org-context';

const DRY_RUN_ROLLBACK = new Error('Dry run rollback');

async function main() {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false }, 'include-sent': { type: 'boolean', default: false } }, strict: true });
  if (values['include-sent'] && !['development', 'test'].includes(process.env.NODE_ENV ?? ''))
    throw new Error('Include Sent is only available outside production with an explicit development or test environment.');
  // Privileged CLI inventory. Every bin read and write below uses a verified organization context.
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  for (const organization of orgs) await runWithCliOrgContext(await resolveCliAdminIdentity(organization.id), async () => {
    const ctx = await requireOrgContext();
    const bins = await db.select({ id: storageLocations.id, code: storageLocations.code }).from(storageLocations).where(and(
      eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.type, 'feedstock_bin'),
    )).orderBy(storageLocations.id);
    for (const bin of bins) {
      let summary: Awaited<ReturnType<typeof recalculateFeedstockBin>> | undefined;
      const recalculate = async () => {
        try {
          await db.transaction(async tx => {
            summary = await recalculateFeedstockBin(ctx, tx, bin.id);
            if (values['dry-run']) throw DRY_RUN_ROLLBACK;
          });
        } catch (error) { if (error !== DRY_RUN_ROLLBACK) throw error; }
      };
      if (values['include-sent']) await withSentFeedstockRecalculation(ctx, recalculate);
      else await recalculate();
      console.log(JSON.stringify({ organizationId: ctx.organizationId, dryRun: values['dry-run'], ...summary }));
    }
  });
}

void main().catch((error: unknown) => {
  // Domain and safe errors name record codes only; anything else prints its class, never driver detail.
  const reason = error instanceof DomainError ? `${error.code}: ${error.message}` : error instanceof SafeError ? error.message : error instanceof Error ? error.name : 'unknown error';
  console.error(`Feedstock recalculation failed (${reason}). No changes were committed for the failing bin.`);
  process.exitCode = 1;
}).finally(() => db.$client.end());
