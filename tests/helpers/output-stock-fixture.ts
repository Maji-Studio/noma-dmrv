import { randomUUID } from 'node:crypto';
import type { db as database } from '@/db';
import { facilities, formulations, formulationIngredients, feedstockTypes, storageLocations, reactors, productionRuns, customers, users, organizations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';

/** Real DB parents shared by FIFO integration and browser fixtures. No auth bypass. */
export async function seedOutputStockParents(db: typeof database, options: { organizationId?: string; userId?: string } = {}) {
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const organizationId = options.organizationId ?? `e2e-fifo-org-${tag}`;
  const userId = options.userId ?? `e2e-fifo-user-${tag}`;
  if (!options.organizationId) await db.insert(organizations).values({ id: organizationId, name: `E2E FIFO ${tag}`, slug: `e2e-fifo-${tag.toLowerCase()}` });
  if (!options.userId) await db.insert(users).values({ id: userId, name: 'E2E FIFO operator', email: `fifo-${tag.toLowerCase()}@e2e.local`, emailVerified: true });
  const ctx: OrgContext = { organizationId, userId, orgRole: 'owner', isPlatformAdmin: false };
  const [facility] = await db.insert(facilities).values({ organizationId, code: `E2E-FIFO-F-${tag}`, name: `E2E FIFO ${tag}` }).returning();
  const [recipe] = await db.insert(formulations).values({ organizationId, code: `E2E-FIFO-M-${tag}`, name: `E2E FIFO mix ${tag}`, biocharRatio: 0.8 }).returning();
  const [pure] = await db.insert(formulations).values({ organizationId, code: `E2E-FIFO-P-${tag}`, name: `E2E Pure ${tag}`, biocharRatio: 1 }).returning();
  const [ingredientType] = await db.insert(feedstockTypes).values({ organizationId, code: `E2E-FIFO-I-${tag}`, name: `E2E Ingredient ${tag}`, category: 'compost', usage: 'blend' }).returning();
  const [ingredient] = await db.insert(formulationIngredients).values({ organizationId, formulationId: recipe.id, feedstockTypeId: ingredientType.id, ratio: 0.2 }).returning();
  const [source] = await db.insert(storageLocations).values({ organizationId, facilityId: facility.id, code: `E2E-FIFO-S-${tag}`, name: `E2E Source ${tag}`, type: 'biochar_bin' }).returning();
  const [bin] = await db.insert(storageLocations).values({ organizationId, facilityId: facility.id, formulationId: recipe.id, code: `E2E-FIFO-B-${tag}`, name: `E2E Mix bin ${tag}`, type: 'product_bin' }).returning();
  const [reactor] = await db.insert(reactors).values({ organizationId, facilityId: facility.id, code: `E2E-FIFO-R-${tag}`, identifier: `E2E Reactor ${tag}`, reactorType: 'auger' }).returning();
  const runs = await db.insert(productionRuns).values([
    { organizationId, facilityId: facility.id, reactorId: reactor.id, code: `E2E-FIFO-R1-${tag}`, status: 'complete' as const, startTime: new Date('2026-09-09T08:00:00Z'), endTime: new Date('2026-09-09T12:00:00Z'), biocharStorageLocationId: source.id, biocharOutputKg: 1000, biocharMoisturePercent: 10, biocharDryMassKg: 900 },
    { organizationId, facilityId: facility.id, reactorId: reactor.id, code: `E2E-FIFO-R2-${tag}`, status: 'complete' as const, startTime: new Date('2026-09-11T08:00:00Z'), endTime: new Date('2026-09-11T12:00:00Z'), biocharStorageLocationId: source.id, biocharOutputKg: 750, biocharMoisturePercent: 20, biocharDryMassKg: 600 },
  ]).returning();
  const [customer] = await db.insert(customers).values({ organizationId, code: `E2E-FIFO-C-${tag}`, name: `E2E Customer ${tag}` }).returning();
  return { tag, ctx, facility, recipe, pure, ingredientType, ingredient, source, bin, runs, customer };
}
