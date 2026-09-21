import { withProductStockFingerprint } from "./helpers/product-stock-preview-fixture";
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { applicationOutputAllocations, binMovements, deliveries, outputStockAllocations, productionRuns } from '@/db/schema';
import { createApplication } from '@/data-access/applications';
import { createBiocharProduct } from '@/data-access/biochar-product-create';
import { createDelivery } from '@/data-access/delivery-output-writes';
import { createOrder } from '@/data-access/orders';
import { previewOutputStock } from '@/data-access/output-stock-operations';
import { postOutputStock } from '@/data-access/output-stock-post';
import { updateProductionRun } from '@/data-access/production-runs';
import { cleanupOutputStockFixture } from './helpers/output-stock-cleanup';
import { seedOutputStockParents } from './helpers/output-stock-fixture';

const WAIT_FOR_LOCK_MS = 2_000;
const LOCK_POLL_MS = 10;
const TEST_TIMEOUT_MS = 15_000;
const organizations: string[] = [];

beforeAll(async () => { await db.execute(sql`select 1 from output_stock_allocations limit 1`); });
afterAll(async () => {
  for (const organizationId of organizations) await cleanupOutputStockFixture(db, organizationId);
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function parents() {
  const fixture = await seedOutputStockParents(db);
  organizations.push(fixture.ctx.organizationId);
  return fixture;
}

async function postedTruck() {
  const f = await parents();
  const product = await createBiocharProduct(f.ctx, await withProductStockFingerprint(f.ctx, {
    code: `E2E-RACE-P-${f.tag}`, facilityId: f.facility.id, formulationId: f.recipe.id,
    placedAt: '2026-09-10', sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
    massKg: 1500, moistureContentPercent: 10, waterAddedKg: 0,
    idempotencyKey: randomUUID(),
    composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id,
      massKg: 500, moistureContentPercent: 60, moistureSource: 'operator_override' }] },
  }));
  const order = await createOrder(f.ctx, {
    code: `E2E-RACE-O-${f.tag}`, facilityId: f.facility.id, customerId: f.customer.id,
    formulationId: f.recipe.id, orderDate: new Date('2026-09-12'), quantityKg: 2000, packaging: 'loose',
  });
  const input = { storageLocationId: f.bin.id, facilityId: f.facility.id, physicalDate: '2026-09-14',
    kind: 'delivery' as const, wetMassKg: 1000, moisturePercent: 30 };
  const preview = await previewOutputStock(f.ctx, input);
  const delivery = await createDelivery(f.ctx, {
    code: `E2E-RACE-D-${f.tag}`, orderId: order.id, facilityId: f.facility.id,
    deliveryDate: new Date('2026-09-14'), storageLocationId: f.bin.id,
    deliveredWetMassKg: input.wetMassKg, moistureContentPercent: input.moisturePercent,
    idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint,
  });
  const [allocation] = await db.select().from(outputStockAllocations)
    .where(and(eq(outputStockAllocations.organizationId, f.ctx.organizationId), eq(outputStockAllocations.deliveryId, delivery.id)));
  return { ...f, product, delivery, input, movementId: allocation.movementId };
}

describe('output stock dependency races', () => {
  it('rechecks application dependencies under the delivery lock before correcting a truck', async () => {
    const f = await postedTruck();
    const correctionInput = { ...f.input, wetMassKg: 900, correctsMovementId: f.movementId };
    const preview = await previewOutputStock(f.ctx, correctionInput);
    const inserted = deferred<number>();
    const release = deferred<void>();
    const originalTransaction = db.transaction.bind(db);
    // Pause only the real application transaction immediately before COMMIT.
    // All writes and row/advisory locks below are PostgreSQL, not mock results.
    const transactionGate = vi.spyOn(db, 'transaction').mockImplementationOnce((callback, config) =>
      originalTransaction(async tx => {
        try {
          const [{ pid }] = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows;
          const result = await callback(tx);
          inserted.resolve(pid);
          await release.promise;
          return result;
        } catch (error) { inserted.reject(error); throw error; }
      }, config));
    const applicationRequest = createApplication(f.ctx, {
      code: `E2E-RACE-A-${f.tag}`, deliveryId: f.delivery.id, applicationDate: new Date('2026-09-14'),
      biocharAppliedTons: 0.5, fieldSizeHa: 1, evidenceMethod: 'visual',
    });
    // Attach handlers immediately so a broken setup cannot leave an unhandled rejection.
    const applicationResult = applicationRequest.then(value => ({ value }), error => ({ error }));
    let correctionResult: Promise<{ error?: unknown; value?: unknown }> | undefined;
    try {
      const applicationPid = await inserted.promise;
      correctionResult = postOutputStock(f.ctx, { ...correctionInput, basisFingerprint: preview.basisFingerprint,
        idempotencyKey: randomUUID(), reason: 'E2E correcting while application commits' })
        .then(value => ({ value }), error => ({ error }));
      await expect.poll(async () => {
        const result = await db.execute<{ blocked: number }>(sql`
          select count(*)::int as blocked from pg_stat_activity
          where ${applicationPid} = any(pg_blocking_pids(pid)) and wait_event_type = 'Lock'
        `);
        return result.rows[0].blocked;
      }, { timeout: WAIT_FOR_LOCK_MS, interval: LOCK_POLL_MS }).toBeGreaterThan(0);
      release.resolve();
      const application = await applicationResult;
      expect('error' in application).toBe(false);
      const correction = await correctionResult;
      expect(correction.error).toBeInstanceOf(Error);
      expect((correction.error as Error).message).toContain(`application E2E-RACE-A-${f.tag}`);
      const [saved] = await db.select().from(deliveries).where(eq(deliveries.id, f.delivery.id));
      expect(saved.deliveredWetMassKg).toBe(1000);
      expect(saved.massDryKg).toBe(f.delivery.massDryKg);
      const changes = await db.select().from(binMovements).where(and(
        eq(binMovements.organizationId, f.ctx.organizationId), eq(binMovements.correctsMovementId, f.movementId)));
      expect(changes).toHaveLength(0);
      const shares = await db.select().from(applicationOutputAllocations)
        .where(eq(applicationOutputAllocations.organizationId, f.ctx.organizationId));
      expect(shares).toHaveLength(1);
      expect(shares[0].biocharProductId).toBe(f.product.id);
      expect(Number(shares[0].dryMassKg)).toBeCloseTo(Number(f.delivery.massDryKg) / 2, 3);
    } finally {
      release.resolve();
      await applicationResult;
      await correctionResult;
      transactionGate.mockRestore();
    }
  }, TEST_TIMEOUT_MS);

  it('blocks ordinary source changes after a count with no allocation rows', async () => {
    const f = await parents();
    const input = { storageLocationId: f.source.id, facilityId: f.facility.id, physicalDate: '2026-09-14',
      kind: 'count' as const, wetMassKg: 1500, moisturePercent: 0 };
    const preview = await previewOutputStock(f.ctx, input);
    expect(preview.removedDryKg).toBe(0);
    const count = await postOutputStock(f.ctx, { ...input, basisFingerprint: preview.basisFingerprint,
      idempotencyKey: randomUUID(), reason: `E2E allocation-free count ${f.tag}` });
    const effects = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.movementId, count.movementId));
    expect(effects).toHaveLength(0);
    await expect(updateProductionRun(f.ctx, f.runs[0].id, { biocharOutputKg: 1100 }))
      .rejects.toThrow(`Production stock is covered by count: E2E allocation-free count ${f.tag}`);
    await expect(updateProductionRun(f.ctx, f.runs[0].id, { endTime: new Date('2026-09-09T13:00:00Z') }))
      .rejects.toThrow('Production stock is covered by count');
    const [saved] = await db.select().from(productionRuns).where(eq(productionRuns.id, f.runs[0].id));
    expect(saved.biocharOutputKg).toBe(1000);
    expect(saved.biocharDryMassKg).toBe(900);
    expect(saved.endTime).toEqual(f.runs[0].endTime);
    const after = await previewOutputStock(f.ctx, input);
    expect(after.beforeDryKg).toBe(1500);
    expect(after.removedDryKg).toBe(0);
  }, TEST_TIMEOUT_MS);
});
