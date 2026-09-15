/**
 * Realistic Demo Seed Data Script
 *
 * Creates a realistic demo dataset for demonstrations and testing.
 * This includes one facility, realistic suppliers/customers, and a complete
 * traceability chain showing the full biochar carbon credit workflow.
 *
 * Usage: pnpm tsx src/db/seed-data.ts
 */
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getPgPoolConfig } from '../lib/pg-pool-config';
import { DEC_ORG_ID, DEC_ORG_NAME, DEC_ORG_SLUG } from './org-defaults';
import * as schema from './schema';
import { demoCodes } from './seed-demo-facts';
import { seedDemoInfrastructure } from './seed-demo-infrastructure';
import { seedDemoProduction } from './seed-demo-production';
import { seedDemoDistribution } from './seed-demo-distribution';
import { seedDemoEvidence } from './seed-demo-evidence';
import { seedDemoScale } from './seed-demo-scale';

config({ path: '.env.local' });
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'development';

async function seedDemoData() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool(getPgPoolConfig(process.env.DATABASE_URL));

  const db = drizzle(pool, { schema });

  try {
    console.log('Starting demo data seed...');

    await db
      .insert(schema.organizations)
      .values({ id: DEC_ORG_ID, name: DEC_ORG_NAME, slug: DEC_ORG_SLUG })
      .onConflictDoNothing({ target: schema.organizations.id });

    // Check if demo data already exists
    const [existingFacility] = await db
      .select({ id: schema.facilities.id })
      .from(schema.facilities)
      .where(
        and(
          eq(schema.facilities.code, demoCodes.facilityMoshi),
          eq(schema.facilities.organizationId, DEC_ORG_ID),
        ),
      )
      .limit(1);

    if (existingFacility) {
      console.log(`Demo data already present (facility ${demoCodes.facilityMoshi}). Skipping.`);
      return;
    }

    const { getStorageProvider } = await import('../lib/storage');
    const storageProvider = getStorageProvider();
    const uploadedSeedDocumentKeys: string[] = [];

    await db.transaction(async (tx) => {
      await seedDemoInfrastructure(tx);
      await seedDemoProduction(tx);
      await seedDemoDistribution(tx);
      await seedDemoEvidence(tx, storageProvider, uploadedSeedDocumentKeys);
      await seedDemoScale(tx);
    }).catch(async (error: unknown) => {
      for (const storageKey of uploadedSeedDocumentKeys) {
        try {
          await storageProvider.deleteObject(storageKey);
        } catch {
          console.warn(`Failed to delete seed document object ${storageKey}`);
        }
      }
      throw error;
    });

    console.log('');
    console.log('Demo data seed completed successfully!');
    console.log('');
    console.log('Summary of created entities:');
    console.log('  - 1 Facility (Dark Earth Moshi Biochar Hub)');
    console.log('  - 2 Reactors');
    console.log('  - 24 Storage Locations (6 curated + 18 scale-demo on Moshi)');
    console.log('  - 3 Suppliers with 4 source locations');
    console.log('  - 3 Customers with 3 Locations');
    console.log('  - 2 Drivers, 2 Operators, 2 Vehicles');
    console.log('  - 9 Feedstock Types');
    console.log('  - 3 Feedstock Deliveries -> 3 Feedstocks');
    console.log('  - 3 Production Runs -> 285 telemetry readings -> 9 in-process samples + 2 incidents');
    console.log('  - 6 Lab Samples (3 per credit batch)');
    console.log('  - 12 document-backed Transport Legs + 12 evidence files');
    console.log('  - 3 Formulations');
    console.log('  - 3 Biochar Products');
    console.log('  - 3 Orders -> 3 Deliveries');
    console.log('  - 3 Applications -> 30 soil temperature measurements + 3 boundary PDFs');
    console.log('  - 2 Credit Batches (1 with 3 linked applications)');
    console.log('  - 3 Storage reconciliation entries + 3 compliance records');
    console.log('  - 1 Isometric certifier project (Moshi, sandbox)');
    console.log('');
  } catch (error) {
    console.error('Demo data seed failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seedDemoData();
