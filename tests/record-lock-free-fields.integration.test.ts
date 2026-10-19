import { beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { applications, applicationOutputAllocations, creditBatchApplications, biocharProducts, creditBatches, feedstocks, productionRuns, samples, storageLocations } from '@/db/schema';
import { updateFeedstockInTransaction } from '@/data-access/feedstocks';
import { updateProductionRun } from '@/data-access/production-runs/mutations';
import { updateSample } from '@/data-access/samples';
import { updateBiocharProduct } from '@/data-access/biochar-product-update';
import { updateCreditBatch } from '@/data-access/credit-batches';
import { updateStorageLocation } from '@/data-access/storage-locations';
import { updateApplication } from '@/lib/operations/applications';
import { runOperationInProcess } from '@/lib/operations/runner';
import { withLineageFixture } from './helpers/certification-lineage-fixture';
import { ensureTestOrg, makeTestOrgContext } from './helpers/test-org';

beforeAll(() => ensureTestOrg());
it.each(['none', 'removal'] as const)('existing notes and codes save In use and all lock Sent (%s)', async blocking => {
  await withLineageFixture(async f => {
    const ctx = makeTestOrgContext();
    const [intake] = await db.select().from(feedstocks).where(eq(feedstocks.id, f.feedstockId));
    const [run] = await db.select().from(productionRuns).where(eq(productionRuns.id, f.productionRunId));
    const [sample] = await db.select().from(samples).where(eq(samples.id, f.sampleId));
    const [product] = await db.select().from(biocharProducts).where(eq(biocharProducts.id, f.productId));
    const [batch] = await db.select().from(creditBatches).where(eq(creditBatches.id, f.batchId));
    const [bin] = await db.select().from(storageLocations).where(eq(storageLocations.id, f.biocharBinId));
    const [application] = await db.select().from(applications).where(eq(applications.id, f.applicationId));
    const updates = [
      () => db.transaction(tx => updateFeedstockInTransaction(ctx, tx, intake.id, { expectedVersion: intake.version, notes: 'Corrected reference' })),
      () => updateProductionRun(ctx, run.id, { expectedVersion: run.version, code: `${run.code}-EDIT` }),
      () => updateSample(ctx, sample.id, { expectedVersion: sample.version, sampleCode: `${sample.sampleCode}-EDIT` }),
      () => updateBiocharProduct(ctx, product.id, { expectedVersion: product.version, code: `${product.code}-EDIT` }),
      () => updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version, siteManagementNotes: 'Corrected reference' }),
      () => updateStorageLocation(ctx, bin.id, { expectedVersion: bin.version, storageDescription: 'Corrected reference' }),
      () => runOperationInProcess(updateApplication, ctx, { applicationId: application.id, expectedVersion: application.version, code: `${application.code}-EDIT` }),
    ];
    for (const update of updates) {
      if (blocking === 'none') await expect(update()).resolves.toBeDefined();
      else await expect(update()).rejects.toMatchObject({ code: 'certification_locked' });
    }
    const version = blocking === 'none' ? product.version + 1 : product.version;
    await expect(updateBiocharProduct(ctx, product.id, { expectedVersion: version, massKg: 1 })).rejects.toMatchObject({ code: 'certification_locked' });
  }, blocking);
});


it('accepts unchanged 0.125005 t with a free reference edit on an In use application', async () => {
  await withLineageFixture(async f => {
    const ctx = makeTestOrgContext();
    const [application] = await db.update(applications).set({ biocharAppliedTons: 0.125005, biocharAppliedDryTons: 0.118755 }).where(eq(applications.id, f.applicationId)).returning();
    await db.update(applicationOutputAllocations).set({ wetMassKg: '125.005', dryMassKg: '118.755' }).where(eq(applicationOutputAllocations.applicationId, application.id));
    await db.update(creditBatchApplications).set({ allocatedWetMassKg: 125.005, allocatedDryMassKg: 118.755 }).where(eq(creditBatchApplications.applicationId, application.id));
    await expect(runOperationInProcess(updateApplication, ctx, { applicationId: application.id, expectedVersion: application.version,
      appliedWetMassKg: 125.005, code: `${application.code}-EDIT` })).resolves.toBeDefined();
    const [saved] = await db.select().from(applications).where(eq(applications.id, application.id));
    expect(saved.biocharAppliedTons).toBe(0.125005);
    expect(saved.code).toBe(`${application.code}-EDIT`);
    await expect(runOperationInProcess(updateApplication, ctx, { applicationId: saved.id, expectedVersion: saved.version,
      appliedWetMassKg: 125.006 })).rejects.toMatchObject({ code: 'certification_locked' });
  }, 'none');
});

it('accepts equivalent placement and non-allocation composition on an In use product as staging does', async () => {
  await withLineageFixture(async f => {
    const ctx = makeTestOrgContext();
    const [product] = await db.select().from(biocharProducts).where(eq(biocharProducts.id, f.productId));
    await expect(updateBiocharProduct(ctx, product.id, {
      expectedVersion: product.version,
      code: `${product.code}-EDIT`,
      placedAt: product.placedAt.toISOString().replace('.000Z', 'Z'),
      composition: { ...(product.composition as Record<string, unknown>), reference: 'unchanged allocation' },
    })).resolves.toMatchObject({ code: `${product.code}-EDIT`, composition: product.composition });
  }, 'none');
});
