/**
 * Realistic Demo Seed Data Script
 *
 * Creates a realistic demo dataset for demonstrations and testing.
 * This includes one facility, realistic suppliers/customers, and a complete
 * traceability chain showing the full biochar carbon credit workflow.
 *
 * Usage: pnpm tsx src/db/seed-data.ts
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from 'dotenv';
import { Pool } from 'pg';
import * as schema from './schema';
import { getPgPoolConfig } from '../lib/pg-pool-config';
import {
  buildApplicationBoundaryDocuments,
  buildProductionRunReadings,
  buildSoilTemperatureMeasurements,
  buildTransportEvidenceDocuments,
} from './seed-certification-evidence';
import { seedProductionProcessesAndCreditBatches } from './seed-credit-batches';
import { seedOperationalDetails } from './seed-operational-details';
import { storeSyntheticSeedDocuments } from './seed-document-storage';
import {
  DEC_ORG_ID,
  DEC_ORG_NAME,
  DEC_ORG_SLUG,
  STARTER_FEEDSTOCK_TYPES,
} from './org-defaults';

config({ path: '.env.local' });
// Dev-only CLI: the lazily imported storage layer validates the full env
// schema, which requires NODE_ENV — plain `pnpm db:seed` shells don't set it.
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'development';

// Helper to generate deterministic UUIDs for demo data
const demoId = (n: number) => `de000000-0000-4000-a000-${n.toString().padStart(12, '0')}`;

const withBootstrapOrg = <T extends { organizationId: string }>(
  rows: Omit<T, 'organizationId'>[],
): T[] =>
  rows.map((row) => ({ ...row, organizationId: DEC_ORG_ID }) as T);

// Demo data codes
const demoCodes = {
  // Facilities
  facilityMoshi: 'FAC-26-001',

  // Reactors
  reactorMoshi1: 'R-26-001',
  reactorMoshi2: 'R-26-002',

  // Storage
  storageFeedMoshi: 'SL-26-001',
  storageCharMoshi: 'SL-26-002',
  storageProdMoshi: 'SL-26-003',
  storageFeedCoffee: 'SL-26-004',
  storageProdPremium: 'SL-26-005',
  storageProdOrganic: 'SL-26-006',

  // Suppliers
  supplierKili: 'SUP-26-001',
  supplierMeru: 'SUP-26-002',
  supplierVictoria: 'SUP-26-003',

  // Customers
  customerCoffee: 'CUS-26-001',
  customerTea: 'CUS-26-002',
  customerVegetable: 'CUS-26-003',
} as const;

// Demo entity IDs
const ids = {
  // Facilities
  facilityMoshi: demoId(1000),

  // Reactors
  reactorMoshi1: demoId(1100),
  reactorMoshi2: demoId(1101),

  // Storage Locations
  storageFeedMoshi: demoId(1200),
  storageCharMoshi: demoId(1201),
  storageProdMoshi: demoId(1202),
  storageFeedCoffee: demoId(1203),
  storageProdPremium: demoId(1204),
  storageProdOrganic: demoId(1205),

  // Suppliers
  supplierKili: demoId(1300),
  supplierMeru: demoId(1301),
  supplierVictoria: demoId(1302),

  // Supplier Locations
  supplierLocationKiliMachame: demoId(1350),
  supplierLocationKiliSawmill: demoId(1351),
  supplierLocationMeruKilema: demoId(1352),
  supplierLocationVictoriaTengeru: demoId(1353),

  // Customers
  customerCoffee: demoId(1400),
  customerTea: demoId(1401),
  customerVegetable: demoId(1402),

  // Customer Locations
  locationCoffeeNorth: demoId(1450),
  locationCoffeeSouth: demoId(1451),
  locationTeaEast: demoId(1452),

  // Drivers & Operators
  driverJackson: demoId(1500),
  driverAmina: demoId(1501),
  operatorNeema: demoId(1502),
  operatorJuma: demoId(1503),

  // Vehicles
  vehicleTruck1: demoId(1550),
  vehicleTruck2: demoId(1551),

  // Feedstock Types
  feedstockWoodchips: demoId(1600),
  feedstockCoffeeHusk: demoId(1601),
  feedstockRiceHusk: demoId(1602),
  feedstockCoconut: demoId(1603),
  feedstockCowCompost: demoId(1604),
  feedstockGreenCompost: demoId(1605),
  feedstockRockDust: demoId(1606),
  feedstockVermicompost: demoId(1607),
  feedstockAgriculturalLime: demoId(1608),

  // Feedstock Deliveries
  deliveryFeed1: demoId(1700),
  deliveryFeed2: demoId(1701),
  deliveryFeed3: demoId(1702),

  // Feedstocks
  feedstock1: demoId(1750),
  feedstock2: demoId(1751),
  feedstock3: demoId(1752),

  // Production Runs
  productionRun1: demoId(1820),
  productionRun2: demoId(1821),
  productionRun3: demoId(1822),

  // In-process Production Samples
  productionSample1: demoId(1830),
  productionSample2: demoId(1831),
  productionSample3: demoId(1832),
  productionSample4: demoId(1833),
  productionSample5: demoId(1834),
  productionSample6: demoId(1835),
  productionSample7: demoId(1836),
  productionSample8: demoId(1837),
  productionSample9: demoId(1838),

  // Production Incidents
  incident1: demoId(1840),
  incident2: demoId(1841),

  // Samples — ≥3 complete-chemistry replicates per sampled credit batch
  // (§8.3.1 durability gate): samples 1/3/4 pool on batch 1, samples 2/5/6
  // on batch 2.
  sample1: demoId(1850),
  sample2: demoId(1851),
  sample3: demoId(1852),
  sample4: demoId(1853),
  sample5: demoId(1854),
  sample6: demoId(1855),

  // Formulations
  formulationStandard: demoId(1900),
  formulationPremium: demoId(1901),
  formulationOrganic: demoId(1902),

  // Biochar Products
  biocharProduct1: demoId(1950),
  biocharProduct2: demoId(1951),
  biocharProduct3: demoId(1952),

  // Orders
  order1: demoId(2000),
  order2: demoId(2001),
  order3: demoId(2002),

  // Deliveries (outbound)
  delivery1: demoId(2050),
  delivery2: demoId(2051),
  delivery3: demoId(2052),

  // Applications
  application1: demoId(2100),
  application2: demoId(2101),
  application3: demoId(2102),
  applicationBoundaryDocument1: demoId(3100),
  applicationBoundaryDocument2: demoId(3101),
  applicationBoundaryDocument3: demoId(3102),

  // Credit Batches
  creditBatch1: demoId(2200),
  creditBatch2: demoId(2201),

  // Production Processes (facility × feedstock sampling-regime campaigns, ADR 0016)
  processMoshiWoodchips: demoId(2250),
  processMoshiCoffee: demoId(2251),

  // Junction table IDs
  prodFeedLink1: demoId(2300),
  prodFeedLink2: demoId(2301),
  prodFeedLink3: demoId(2302),
  creditApp1: demoId(2350),
  creditApp2: demoId(2351),
  creditApp3: demoId(2352),

  // Transport Legs (one per feedstock/biochar product, one per lab sample)
  transportLegFeedstock1: demoId(2400),
  transportLegFeedstock2: demoId(2401),
  transportLegFeedstock3: demoId(2402),
  transportLegBiochar1: demoId(2403),
  transportLegBiochar2: demoId(2404),
  transportLegBiochar3: demoId(2405),
  transportLegSample1: demoId(2406),
  transportLegSample2: demoId(2407),
  transportLegSample3: demoId(2408),
  transportLegSample4: demoId(2409),
  transportLegSample5: demoId(2410),
  transportLegSample6: demoId(2411),

  // Storage/compliance history
  binMovement1: demoId(2420),
  binMovement2: demoId(2421),
  binMovement3: demoId(2422),
  stockpileEvent1: demoId(2430),
  stockpileEvent2: demoId(2431),
  powerEvidence1: demoId(2440),
} as const;

// Demo timestamps (realistic timeline)
const demoTimestamps = {
  // Week 1: Setup and first deliveries
  facilitySetup: new Date('2026-05-05T08:00:00.000Z'),
  firstDelivery: new Date('2026-05-08T09:30:00.000Z'),
  secondDelivery: new Date('2026-05-10T10:15:00.000Z'),
  thirdDelivery: new Date('2026-05-12T08:45:00.000Z'),

  // Week 2: Production runs
  run1Start: new Date('2026-05-13T06:00:00.000Z'),
  run1End: new Date('2026-05-13T14:00:00.000Z'),
  run2Start: new Date('2026-05-15T06:00:00.000Z'),
  run2End: new Date('2026-05-15T13:30:00.000Z'),
  run3Start: new Date('2026-05-17T07:00:00.000Z'),
  run3End: new Date('2026-05-17T15:00:00.000Z'),

  // Week 3: Orders and deliveries
  order1Date: new Date('2026-05-20T09:00:00.000Z'),
  order2Date: new Date('2026-05-21T10:30:00.000Z'),
  order3Date: new Date('2026-05-22T11:00:00.000Z'),
  delivery1Date: new Date('2026-05-23T08:00:00.000Z'),
  delivery2Date: new Date('2026-05-24T09:30:00.000Z'),
  delivery3Date: new Date('2026-05-25T10:00:00.000Z'),

  // Week 4: Applications and credits
  application1Date: new Date('2026-05-27T11:00:00.000Z'),
  application2Date: new Date('2026-05-28T10:30:00.000Z'),
  application3Date: new Date('2026-05-29T09:00:00.000Z'),
  creditBatch1Start: new Date('2026-05-13T00:00:00.000Z'),
  creditBatch1End: new Date('2026-05-31T23:59:59.000Z'),
} as const;

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
      // ============================================================
      // INFRASTRUCTURE: Facilities, Reactors, Storage Locations
      // ============================================================

      console.log('Creating facilities...');
      await tx.insert(schema.facilities).values(withBootstrapOrg<typeof schema.facilities.$inferInsert>([
        {
          id: ids.facilityMoshi,
          code: demoCodes.facilityMoshi,
          name: 'Dark Earth Moshi Biochar Hub',
          location: 'Moshi, Kilimanjaro Region, Tanzania',
          gpsLatitude: -3.3481,
          gpsLongitude: 37.3404,
          timezone: 'Africa/Dar_es_Salaam',
          country: 'Tanzania',
          address: 'Soweto Industrial Area, Moshi Municipality',
          contactEmail: 'moshi@noma-biochar.tz',
          contactPhone: '+255700100001',
          // Dark Earth Carbon runs the 1000-year (R₀ + TGA) tier (ADR 0021);
          // the tier is inherited by every batch and sample here.
          durabilityOption: '1000_year',
        },
      ]));

      console.log('Creating reactors...');
      await tx.insert(schema.reactors).values(withBootstrapOrg<typeof schema.reactors.$inferInsert>([
        {
          id: ids.reactorMoshi1,
          code: demoCodes.reactorMoshi1,
          identifier: 'Kiln-Alpha',
          facilityId: ids.facilityMoshi,
          reactorType: 'auger',
          nominalThroughputTph: 0.75,
          specifications: {
            manufacturer: 'NOMA Engineering',
            model: 'AugerMax-750',
            yearInstalled: 2025,
          },
        },
        {
          id: ids.reactorMoshi2,
          code: demoCodes.reactorMoshi2,
          identifier: 'Kiln-Beta',
          facilityId: ids.facilityMoshi,
          reactorType: 'fixed-bed',
          nominalThroughputTph: 0.5,
          specifications: {
            manufacturer: 'NOMA Engineering',
            model: 'BatchPro-500',
            yearInstalled: 2025,
          },
        },
      ]));

      console.log('Creating storage locations...');
      await tx.insert(schema.storageLocations).values(withBootstrapOrg<typeof schema.storageLocations.$inferInsert>([
        {
          id: ids.storageFeedMoshi,
          code: demoCodes.storageFeedMoshi,
          name: 'Moshi Hardwood Chip Bay A',
          type: 'feedstock_bin' as const,
          capacityKg: 20000,
          storageMethod: 'covered_bin',
          storageDescription: 'Climate-controlled covered storage with moisture monitoring',
          facilityId: ids.facilityMoshi,
          feedstockTypeId: ids.feedstockWoodchips,
        },
        {
          id: ids.storageFeedCoffee,
          code: demoCodes.storageFeedCoffee,
          name: 'Moshi Coffee Husk Bay B',
          type: 'feedstock_bin' as const,
          capacityKg: 12000,
          storageMethod: 'covered_bin',
          storageDescription: 'Separated covered bay for lower-moisture coffee husk',
          facilityId: ids.facilityMoshi,
          feedstockTypeId: ids.feedstockCoffeeHusk,
        },
        {
          id: ids.storageCharMoshi,
          code: demoCodes.storageCharMoshi,
          name: 'Moshi Raw Biochar Curing Pad',
          type: 'biochar_bin' as const,
          // Biochar stores are uncapped piles — no fixed capacity (no gauge).
          capacityKg: null,
          storageMethod: 'tarped_pile',
          storageDescription: 'Covered pile on impermeable liner with drainage',
          facilityId: ids.facilityMoshi,
        },
        {
          id: ids.storageProdMoshi,
          code: demoCodes.storageProdMoshi,
          name: 'Moshi Standard Blend Warehouse',
          type: 'product_bin' as const,
          capacityKg: 10000,
          storageMethod: 'bagged_palletized',
          storageDescription: 'Sheltered warehouse aisle for bagged standard blend',
          facilityId: ids.facilityMoshi,
          formulationId: ids.formulationStandard,
        },
        {
          id: ids.storageProdPremium,
          code: demoCodes.storageProdPremium,
          name: 'Moshi Premium Blend Warehouse',
          type: 'product_bin' as const,
          capacityKg: 8000,
          storageMethod: 'bagged_palletized',
          storageDescription: 'Pallet lane for high-carbon blend inventory',
          facilityId: ids.facilityMoshi,
          formulationId: ids.formulationPremium,
        },
        {
          id: ids.storageProdOrganic,
          code: demoCodes.storageProdOrganic,
          name: 'Moshi Organic Blend Warehouse',
          type: 'product_bin' as const,
          capacityKg: 9000,
          storageMethod: 'bagged_palletized',
          storageDescription: 'Separate organic blend lane with cleaned handling tools',
          facilityId: ids.facilityMoshi,
          formulationId: ids.formulationOrganic,
        },
      ]));

      // ============================================================
      // PARTIES: Suppliers, Customers, Drivers, Operators
      // ============================================================

      console.log('Creating suppliers...');
      await tx.insert(schema.suppliers).values(withBootstrapOrg<typeof schema.suppliers.$inferInsert>([
        {
          id: ids.supplierKili,
          code: demoCodes.supplierKili,
          name: 'Kilimanjaro Sustainable Forestry Cooperative',
          location: 'Hai District, Kilimanjaro Region',
          gpsLatitude: -3.286,
          gpsLongitude: 37.157,
          address: 'Machame Road, Hai District',
          contactName: 'Asha Mallya',
          contactEmail: 'asha@kili-forestry.coop',
          contactPhone: '+255700200001',
          sourceRegion: 'Kilimanjaro',
          distanceToFacilityKm: 34,
          distanceSource: 'document',
        },
        {
          id: ids.supplierMeru,
          code: demoCodes.supplierMeru,
          name: 'Moshi Arabica Coffee Cooperative',
          location: 'Moshi Rural District, Kilimanjaro Region',
          gpsLatitude: -3.244,
          gpsLongitude: 37.421,
          address: 'Kilema Road, Moshi Rural District',
          contactName: 'Rehema Kimaro',
          contactEmail: 'rehema@moshi-arabica.coop',
          contactPhone: '+255700200002',
          sourceRegion: 'Kilimanjaro',
          distanceToFacilityKm: 29,
          distanceSource: 'document',
        },
        {
          id: ids.supplierVictoria,
          code: demoCodes.supplierVictoria,
          name: 'Tengeru Compost and Minerals Depot',
          location: 'Tengeru, Arusha Region',
          gpsLatitude: -3.374,
          gpsLongitude: 36.803,
          address: 'Old Moshi Road, Tengeru',
          contactName: 'Grace Mushi',
          contactEmail: 'grace@tengeru-compost.tz',
          contactPhone: '+255700200003',
          sourceRegion: 'Arusha',
          distanceToFacilityKm: 92,
          distanceSource: 'document',
        },
      ]));

      console.log('Creating customers...');
      await tx.insert(schema.customers).values(withBootstrapOrg<typeof schema.customers.$inferInsert>([
        {
          id: ids.customerCoffee,
          code: demoCodes.customerCoffee,
          name: 'Moshi Coffee Growers Association',
          cropType: 'Coffee',
          address: 'Kilema, Moshi Rural District',
          contactEmail: 'info@moshi-coffee.tz',
          contactPhone: '+255700300001',
        },
        {
          id: ids.customerTea,
          code: demoCodes.customerTea,
          name: 'Usambara Highland Tea Estate',
          cropType: 'Tea',
          address: 'Lushoto District, Tanga Region',
          contactEmail: 'farm@usambara-tea.tz',
          contactPhone: '+255700300002',
        },
        {
          id: ids.customerVegetable,
          code: demoCodes.customerVegetable,
          name: 'Kikuletwa Horticulture Farm',
          cropType: 'Mixed Vegetables',
          address: 'Kikuletwa, Hai District',
          contactEmail: 'orders@kikuletwa-horticulture.tz',
          contactPhone: '+255700300003',
        },
      ]));

      console.log('Creating customer locations...');
      await tx.insert(schema.customerLocations).values(withBootstrapOrg<typeof schema.customerLocations.$inferInsert>([
        {
          id: ids.locationCoffeeNorth,
          customerId: ids.customerCoffee,
          name: 'North Plot - Kilema',
          country: 'Tanzania',
          stateRegion: 'Kilimanjaro',
          city: 'Kilema',
          gpsLatitude: -3.245,
          gpsLongitude: 37.425,
          address: 'Plot N-12, Kilema Village',
          distanceFromFacilityKm: 32,
          distanceSource: 'document',
          defaultSoilTemperatureC: 24.5,
          isDefault: true,
        },
        {
          id: ids.locationCoffeeSouth,
          customerId: ids.customerCoffee,
          name: 'South Plot - Machame',
          country: 'Tanzania',
          stateRegion: 'Kilimanjaro',
          city: 'Machame',
          gpsLatitude: -3.289,
          gpsLongitude: 37.198,
          address: 'Plot S-8, Machame Weruweru',
          distanceFromFacilityKm: 39,
          distanceSource: 'document',
          defaultSoilTemperatureC: 25.2,
        },
        {
          id: ids.locationTeaEast,
          customerId: ids.customerTea,
          name: 'Lushoto Estate Block E',
          country: 'Tanzania',
          stateRegion: 'Tanga',
          city: 'Lushoto',
          gpsLatitude: -4.789,
          gpsLongitude: 38.312,
          address: 'Block E-1, Usambara Estate',
          distanceFromFacilityKm: 228,
          distanceSource: 'document',
          defaultSoilTemperatureC: 22.8,
          isDefault: true,
        },
      ]));

      console.log('Creating drivers and operators...');
      await tx.insert(schema.drivers).values(withBootstrapOrg<typeof schema.drivers.$inferInsert>([
        {
          id: ids.driverJackson,
          code: 'DRV-26-001',
          name: 'Jackson Mrema',
          licenseNumber: 'TZ-C-99821',
          contactPhone: '+255700400001',
        },
        {
          id: ids.driverAmina,
          code: 'DRV-26-002',
          name: 'Amina Salim',
          licenseNumber: 'TZ-C-88754',
          contactPhone: '+255700400002',
        },
      ]));

      await tx.insert(schema.operators).values(withBootstrapOrg<typeof schema.operators.$inferInsert>([
        {
          id: ids.operatorNeema,
          name: 'Neema Kweka',
          credentials: 'Certified Pyrolysis Operator Level 2',
          contactPhone: '+255700500001',
        },
        {
          id: ids.operatorJuma,
          name: 'Juma Makamba',
          credentials: 'Certified Pyrolysis Operator Level 3, Safety Lead',
          contactPhone: '+255700500002',
        },
      ]));

      await tx.insert(schema.vehicles).values(withBootstrapOrg<typeof schema.vehicles.$inferInsert>([
        {
          id: ids.vehicleTruck1,
          code: 'VEH-26-001',
          name: 'Isuzu NQR 7T',
          identifier: 'T-420-ABC',
          vehicleType: 'heavy_truck',
          fuelType: 'diesel',
          fuelConsumptionLPerKm: 0.28,
          modelYear: 2022,
        },
        {
          id: ids.vehicleTruck2,
          code: 'VEH-26-002',
          name: 'Fuso Fighter 8T',
          identifier: 'T-512-XYZ',
          vehicleType: 'heavy_truck',
          fuelType: 'diesel',
          fuelConsumptionLPerKm: 0.25,
          modelYear: 2023,
        },
      ]));

      // ============================================================
      // FEEDSTOCK: Types, Deliveries, Feedstocks
      // ============================================================

      console.log('Creating feedstock types...');
      const starterFeedstockTypeIds = [
        ids.feedstockWoodchips,
        ids.feedstockCoffeeHusk,
        ids.feedstockRiceHusk,
        ids.feedstockCoconut,
        ids.feedstockCowCompost,
        ids.feedstockGreenCompost,
        ids.feedstockRockDust,
        ids.feedstockVermicompost,
        ids.feedstockAgriculturalLime,
      ];
      await tx.insert(schema.feedstockTypes).values(
        STARTER_FEEDSTOCK_TYPES.map((feedstockType, index) => ({
          ...feedstockType,
          id: starterFeedstockTypeIds[index],
          organizationId: DEC_ORG_ID,
        })),
      );

      console.log('Creating feedstock deliveries...');
      await tx.insert(schema.feedstockDeliveries).values(withBootstrapOrg<typeof schema.feedstockDeliveries.$inferInsert>([
        {
          id: ids.deliveryFeed1,
          code: 'FD-26-001',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          deliveryDate: demoTimestamps.firstDelivery,
          supplierId: ids.supplierKili,
          vehicleId: ids.vehicleTruck1,
          gpsLatitude: -3.3481,
          gpsLongitude: 37.3404,
          feedstockTypeId: ids.feedstockWoodchips,
          wetMassKg: 4500,
          moisturePercent: 16,
          notes: 'Clean hardwood chips from managed pruning residues',
        },
        {
          id: ids.deliveryFeed2,
          code: 'FD-26-002',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          deliveryDate: demoTimestamps.secondDelivery,
          supplierId: ids.supplierMeru,
          vehicleId: ids.vehicleTruck2,
          gpsLatitude: -3.3481,
          gpsLongitude: 37.3404,
          feedstockTypeId: ids.feedstockCoffeeHusk,
          wetMassKg: 3200,
          moisturePercent: 12,
          notes: 'Sun-dried Arabica coffee husk from parchment hulling',
        },
        {
          id: ids.deliveryFeed3,
          code: 'FD-26-003',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          deliveryDate: demoTimestamps.thirdDelivery,
          supplierId: ids.supplierKili,
          vehicleId: ids.vehicleTruck1,
          gpsLatitude: -3.3481,
          gpsLongitude: 37.3404,
          feedstockTypeId: ids.feedstockWoodchips,
          wetMassKg: 5000,
          moisturePercent: 18,
          notes: 'Mixed Grevillea and eucalyptus branch chips',
        },
      ]));

      console.log('Creating feedstocks...');
      await tx.insert(schema.feedstocks).values(withBootstrapOrg<typeof schema.feedstocks.$inferInsert>([
        {
          id: ids.feedstock1,
          code: 'FS-26-001',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          feedstockDeliveryId: ids.deliveryFeed1,
          feedstockTypeId: ids.feedstockWoodchips,
          supplierId: ids.supplierKili,
          vehicleId: ids.vehicleTruck1,
          massWetKg: 4500,
          massDryKg: 3780,
          moistureContentPercent: 16,
          co2eFeedstockTons: 5.2,
          feedstockSourceRegion: 'Kilimanjaro',
          storageLocationId: ids.storageFeedMoshi,
          counterfactualCategory: 'open_decay',
          counterfactualEmissions15Tons: 1.8,
          counterfactualStorage50Tons: 1.2,
          baselineScenario: 'mulched_or_open_decay',
          baselineDescription: 'Pruning residues would otherwise be chipped and left in unmanaged roadside piles.',
          eligibilityStatus: 'eligible',
        },
        {
          id: ids.feedstock2,
          code: 'FS-26-002',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          feedstockDeliveryId: ids.deliveryFeed2,
          feedstockTypeId: ids.feedstockCoffeeHusk,
          supplierId: ids.supplierMeru,
          vehicleId: ids.vehicleTruck2,
          massWetKg: 3200,
          massDryKg: 2816,
          moistureContentPercent: 12,
          co2eFeedstockTons: 3.8,
          feedstockSourceRegion: 'Kilimanjaro',
          storageLocationId: ids.storageFeedCoffee,
          counterfactualCategory: 'open_decay',
          counterfactualEmissions15Tons: 1.4,
          counterfactualStorage50Tons: 0.9,
          baselineScenario: 'open_decay',
          baselineDescription: 'Coffee husk would be stockpiled behind the wet mill and periodically land-applied untreated.',
          eligibilityStatus: 'eligible',
        },
        {
          id: ids.feedstock3,
          code: 'FS-26-003',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          feedstockDeliveryId: ids.deliveryFeed3,
          feedstockTypeId: ids.feedstockWoodchips,
          supplierId: ids.supplierKili,
          vehicleId: ids.vehicleTruck1,
          massWetKg: 5000,
          massDryKg: 4100,
          moistureContentPercent: 18,
          co2eFeedstockTons: 5.8,
          feedstockSourceRegion: 'Kilimanjaro',
          storageLocationId: ids.storageFeedMoshi,
          counterfactualCategory: 'open_decay',
          counterfactualEmissions15Tons: 2.0,
          counterfactualStorage50Tons: 1.4,
          baselineScenario: 'mulched_or_open_decay',
          baselineDescription: 'Mixed branch chips would normally be left in seasonal piles before partial composting.',
          eligibilityStatus: 'eligible',
        },
      ]));

      // ============================================================
      // PRODUCTION: Runs, Samples
      // ============================================================

      console.log('Creating production runs...');
      await tx.insert(schema.productionRuns).values(withBootstrapOrg<typeof schema.productionRuns.$inferInsert>([
        {
          id: ids.productionRun1,
          code: 'PR-26-001',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          startTime: demoTimestamps.run1Start,
          endTime: demoTimestamps.run1End,
          reactorId: ids.reactorMoshi1,
          operatorId: ids.operatorNeema,
          feedingRateKgHr: 480,
          residenceTimeMinutes: 45,
          dieselOperationLiters: 14,
          dieselGensetLiters: 4,
          preprocessingFuelLiters: 3,
          electricityKwh: 165,
          electricitySourceCategory: 'ec1_grid_average',
          lowCarbonPercentage: 44,
          biocharOutputKg: 980,
          biocharMoisturePercent: 2,
          biocharDryMassKg: 960.4,
          biocharStorageLocationId: ids.storageCharMoshi,
          feedstockStorageLocationId: ids.storageFeedMoshi,
          feedstockWetMassKg: 3500,
          feedstockMoisturePercent: 16,
          feedstockMassDryKg: 2940,
        },
        {
          id: ids.productionRun2,
          code: 'PR-26-002',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          startTime: demoTimestamps.run2Start,
          endTime: demoTimestamps.run2End,
          reactorId: ids.reactorMoshi1,
          operatorId: ids.operatorJuma,
          feedingRateKgHr: 450,
          residenceTimeMinutes: 42,
          dieselOperationLiters: 12,
          dieselGensetLiters: 3,
          preprocessingFuelLiters: 2,
          electricityKwh: 145,
          electricitySourceCategory: 'ec1_grid_average',
          lowCarbonPercentage: 44,
          biocharOutputKg: 720,
          biocharMoisturePercent: 2,
          biocharDryMassKg: 705.6,
          biocharStorageLocationId: ids.storageCharMoshi,
          feedstockStorageLocationId: ids.storageFeedCoffee,
          feedstockWetMassKg: 2500,
          feedstockMoisturePercent: 12,
          feedstockMassDryKg: 2200,
        },
        {
          id: ids.productionRun3,
          code: 'PR-26-003',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          startTime: demoTimestamps.run3Start,
          endTime: demoTimestamps.run3End,
          reactorId: ids.reactorMoshi2,
          operatorId: ids.operatorNeema,
          feedingRateKgHr: 380,
          residenceTimeMinutes: 55,
          dieselOperationLiters: 10,
          dieselGensetLiters: 4,
          preprocessingFuelLiters: 2,
          electricityKwh: 120,
          electricitySourceCategory: 'ec1_grid_average',
          lowCarbonPercentage: 44,
          biocharOutputKg: 850,
          biocharMoisturePercent: 2,
          biocharDryMassKg: 833,
          biocharStorageLocationId: ids.storageCharMoshi,
          feedstockStorageLocationId: ids.storageFeedMoshi,
          feedstockWetMassKg: 3000,
          feedstockMoisturePercent: 18,
          feedstockMassDryKg: 2460,
        },
      ]));

      console.log('Creating production run feedstock links...');
      await tx.insert(schema.productionRunFeedstocks).values(withBootstrapOrg<typeof schema.productionRunFeedstocks.$inferInsert>([
        {
          id: ids.prodFeedLink1,
          productionRunId: ids.productionRun1,
          feedstockId: ids.feedstock1,
          massUsedKg: 3500,
        },
        {
          id: ids.prodFeedLink2,
          productionRunId: ids.productionRun2,
          feedstockId: ids.feedstock2,
          massUsedKg: 2500,
        },
        {
          id: ids.prodFeedLink3,
          productionRunId: ids.productionRun3,
          feedstockId: ids.feedstock3,
          massUsedKg: 3000,
        },
      ]));

      const productionRunReadingRows = buildProductionRunReadings([
        {
          idBase: 2500,
          productionRunId: ids.productionRun1,
          start: demoTimestamps.run1Start,
          end: demoTimestamps.run1End,
          temperatureStartC: 418,
          temperaturePeakC: 566,
          pressureStartBar: 0.07,
          pressurePeakBar: 0.12,
          gasStartRate: 0.18,
          gasPeakRate: 0.31,
        },
        {
          idBase: 2650,
          productionRunId: ids.productionRun2,
          start: demoTimestamps.run2Start,
          end: demoTimestamps.run2End,
          temperatureStartC: 406,
          temperaturePeakC: 548,
          pressureStartBar: 0.065,
          pressurePeakBar: 0.105,
          gasStartRate: 0.16,
          gasPeakRate: 0.28,
        },
        {
          idBase: 2800,
          productionRunId: ids.productionRun3,
          start: demoTimestamps.run3Start,
          end: demoTimestamps.run3End,
          temperatureStartC: 392,
          temperaturePeakC: 526,
          pressureStartBar: 0.06,
          pressurePeakBar: 0.098,
          gasStartRate: 0.145,
          gasPeakRate: 0.255,
        },
      ], DEC_ORG_ID);

      console.log(`Creating ${productionRunReadingRows.length} production run readings...`);
      await tx.insert(schema.productionRunReadings).values(productionRunReadingRows);

      // Production processes + their credit batches must exist before samples
      // (the samples.credit_batch_id FK, added in migration 0057). The shared
      // `seedProductionProcessesAndCreditBatches` builds them; it is invoked here
      // — before samples — rather than after applications.
      await seedProductionProcessesAndCreditBatches(
        tx,
        DEC_ORG_ID,
        ids,
        demoTimestamps,
      );

      // Each sampled credit batch pools >=3 replicates with a complete
      // H/C_org + O/C_org pair (durability gate, module §8.3.1 / §3 Table 2).
      // Moshi is a 1000-year facility (ADR 0021), so EVERY batch's samples carry
      // the R0 + TGA evidence the intake guard requires (requireBatchTierEvidence,
      // issue #341) plus the per-sample s_fraction (proportion of R0 readings
      // >= 2% — the inertinite fraction) the 1000-year sequestration blueprint
      // consumes. Molar ratios are consistent with the elemental percentages
      // (H/C_org = (H/1)/(C_org/12), O/C_org = (O/16)/(C_org/12)).
      console.log('Creating samples...');
      await tx.insert(schema.samples).values(withBootstrapOrg<typeof schema.samples.$inferInsert>([
        // --- Credit batch 1 (1000-year, woodchips): runs 1 + 3, 3 replicates ---
        {
          id: ids.sample1,
          productionRunId: ids.productionRun1,
          creditBatchId: ids.creditBatch1,
          samplingTime: new Date('2026-05-13T09:30:00.000Z'),
          sampleCode: 'SAM-26-001',
          weightGrams: 520,
          volumeMl: 980,
          labName: 'Kibo Analytical Labs',
          labAccreditation: 'ISO 17025',
          analysisDate: '2026-05-20',
          totalCarbonPercent: 79.2,
          inorganicCarbonPercent: 0.9,
          organicCarbonPercent: 78.3,
          totalHydrogenPercent: 1.8,
          totalOxygenPercent: 7.5,
          hToCOrgRatio: 0.27,
          oToCOrgRatio: 0.07,
          ashContentPercent: 9.5,
          moistureContentPercent: 4.8,
          randomReflectanceR0Percent: 2.85,
          r0MeasurementCount: 100,
          reactiveCarbonPercent: 32.6,
          residualCarbonPercent: 67.4,
          sReflectanceFraction: 0.92,
          r0AnalysisDate: '2026-05-20',
          tgaAnalysisDate: '2026-05-20',
        },
        {
          id: ids.sample3,
          productionRunId: ids.productionRun3,
          creditBatchId: ids.creditBatch1,
          samplingTime: new Date('2026-05-17T10:00:00.000Z'),
          sampleCode: 'SAM-26-003',
          weightGrams: 510,
          volumeMl: 960,
          labName: 'Kibo Analytical Labs',
          labAccreditation: 'ISO 17025',
          analysisDate: '2026-05-24',
          totalCarbonPercent: 77.8,
          inorganicCarbonPercent: 1.0,
          organicCarbonPercent: 76.8,
          totalHydrogenPercent: 2.0,
          totalOxygenPercent: 8.7,
          hToCOrgRatio: 0.31,
          oToCOrgRatio: 0.09,
          ashContentPercent: 10.8,
          moistureContentPercent: 5.4,
          randomReflectanceR0Percent: 2.75,
          r0MeasurementCount: 100,
          reactiveCarbonPercent: 32.1,
          residualCarbonPercent: 67.9,
          sReflectanceFraction: 0.90,
          r0AnalysisDate: '2026-05-24',
          tgaAnalysisDate: '2026-05-24',
        },
        {
          // Third replicate drawn from the curing pad the morning after run 3
          // — a distinct sampling day, so the batch's replicates span three
          // (run, day) provenance keys (§8.3.1 distribution expectation).
          id: ids.sample4,
          productionRunId: ids.productionRun3,
          creditBatchId: ids.creditBatch1,
          samplingTime: new Date('2026-05-18T08:30:00.000Z'),
          sampleCode: 'SAM-26-004',
          weightGrams: 505,
          volumeMl: 950,
          labName: 'Kibo Analytical Labs',
          labAccreditation: 'ISO 17025',
          analysisDate: '2026-05-24',
          totalCarbonPercent: 80.4,
          inorganicCarbonPercent: 0.8,
          organicCarbonPercent: 79.6,
          totalHydrogenPercent: 1.7,
          totalOxygenPercent: 6.9,
          hToCOrgRatio: 0.25,
          oToCOrgRatio: 0.07,
          ashContentPercent: 8.9,
          moistureContentPercent: 4.6,
          randomReflectanceR0Percent: 2.9,
          r0MeasurementCount: 100,
          reactiveCarbonPercent: 32.4,
          residualCarbonPercent: 67.6,
          sReflectanceFraction: 0.93,
          r0AnalysisDate: '2026-05-24',
          tgaAnalysisDate: '2026-05-24',
        },
        // --- Credit batch 2 (1000-year, coffee husk): run 2, 3 replicates
        // with R0 petrography + TGA evidence. Sample means reconcile with the
        // batch's stored meanRandomReflectancePercent (2.8) and
        // meanNonReactiveCarbonPercent (68). ---
        {
          id: ids.sample2,
          productionRunId: ids.productionRun2,
          creditBatchId: ids.creditBatch2,
          samplingTime: new Date('2026-05-15T09:00:00.000Z'),
          sampleCode: 'SAM-26-002',
          weightGrams: 485,
          volumeMl: 920,
          labName: 'Kibo Analytical Labs',
          labAccreditation: 'ISO 17025',
          analysisDate: '2026-05-22',
          totalCarbonPercent: 81.5,
          inorganicCarbonPercent: 0.7,
          organicCarbonPercent: 80.8,
          totalHydrogenPercent: 1.5,
          totalOxygenPercent: 6.0,
          hToCOrgRatio: 0.22,
          oToCOrgRatio: 0.06,
          ashContentPercent: 8.2,
          moistureContentPercent: 5.1,
          randomReflectanceR0Percent: 2.9,
          r0MeasurementCount: 100,
          reactiveCarbonPercent: 31.8,
          residualCarbonPercent: 68.2,
          sReflectanceFraction: 0.94,
          r0AnalysisDate: '2026-05-22',
          tgaAnalysisDate: '2026-05-22',
        },
        {
          id: ids.sample5,
          productionRunId: ids.productionRun2,
          creditBatchId: ids.creditBatch2,
          samplingTime: new Date('2026-05-16T09:15:00.000Z'),
          sampleCode: 'SAM-26-005',
          weightGrams: 495,
          volumeMl: 940,
          labName: 'Kibo Analytical Labs',
          labAccreditation: 'ISO 17025',
          analysisDate: '2026-05-23',
          totalCarbonPercent: 82.1,
          inorganicCarbonPercent: 0.6,
          organicCarbonPercent: 81.5,
          totalHydrogenPercent: 1.4,
          totalOxygenPercent: 5.4,
          hToCOrgRatio: 0.21,
          oToCOrgRatio: 0.05,
          ashContentPercent: 7.8,
          moistureContentPercent: 4.9,
          randomReflectanceR0Percent: 2.8,
          r0MeasurementCount: 100,
          reactiveCarbonPercent: 32.4,
          residualCarbonPercent: 67.6,
          sReflectanceFraction: 0.91,
          r0AnalysisDate: '2026-05-23',
          tgaAnalysisDate: '2026-05-23',
        },
        {
          id: ids.sample6,
          productionRunId: ids.productionRun2,
          creditBatchId: ids.creditBatch2,
          samplingTime: new Date('2026-05-17T08:45:00.000Z'),
          sampleCode: 'SAM-26-006',
          weightGrams: 500,
          volumeMl: 955,
          labName: 'Kibo Analytical Labs',
          labAccreditation: 'ISO 17025',
          analysisDate: '2026-05-24',
          totalCarbonPercent: 80.9,
          inorganicCarbonPercent: 0.8,
          organicCarbonPercent: 80.1,
          totalHydrogenPercent: 1.6,
          totalOxygenPercent: 6.4,
          hToCOrgRatio: 0.24,
          oToCOrgRatio: 0.06,
          ashContentPercent: 8.5,
          moistureContentPercent: 5.2,
          randomReflectanceR0Percent: 2.7,
          r0MeasurementCount: 100,
          reactiveCarbonPercent: 31.9,
          residualCarbonPercent: 68.1,
          sReflectanceFraction: 0.89,
          r0AnalysisDate: '2026-05-24',
          tgaAnalysisDate: '2026-05-24',
        },
      ]));

      // ============================================================
      // PRODUCTS: Formulations, Biochar Products
      // ============================================================

      console.log('Creating formulations...');
      await tx.insert(schema.formulations).values(withBootstrapOrg<typeof schema.formulations.$inferInsert>([
        {
          id: ids.formulationStandard,
          code: 'BCF-26-001',
          name: 'Standard Biochar Blend',
          biocharRatio: 0.4,
          description: 'Balanced blend for general agricultural use',
        },
        {
          id: ids.formulationPremium,
          code: 'BCF-26-002',
          name: 'Premium High-Carbon Blend',
          biocharRatio: 0.7,
          description: 'High biochar content for maximum carbon sequestration',
        },
        {
          id: ids.formulationOrganic,
          code: 'BCF-26-003',
          name: 'Certified Organic Blend',
          biocharRatio: 0.5,
          description: 'Organic-certified blend with verified compost',
        },
      ]));

      // Seed formulation ingredients
      await tx.insert(schema.formulationIngredients).values(withBootstrapOrg<typeof schema.formulationIngredients.$inferInsert>([
        // Standard Biochar Blend: 60% cow manure compost
        {
          formulationId: ids.formulationStandard,
          feedstockTypeId: ids.feedstockCowCompost,
          ratio: 0.6,
          sortOrder: 0,
        },
        // Premium: 20% green waste compost, 10% rock dust
        {
          formulationId: ids.formulationPremium,
          feedstockTypeId: ids.feedstockGreenCompost,
          ratio: 0.2,
          sortOrder: 0,
        },
        {
          formulationId: ids.formulationPremium,
          feedstockTypeId: ids.feedstockRockDust,
          ratio: 0.1,
          sortOrder: 1,
        },
        // Organic: 40% vermicompost, 10% agricultural lime
        {
          formulationId: ids.formulationOrganic,
          feedstockTypeId: ids.feedstockVermicompost,
          ratio: 0.4,
          sortOrder: 0,
        },
        {
          formulationId: ids.formulationOrganic,
          feedstockTypeId: ids.feedstockAgriculturalLime,
          ratio: 0.1,
          sortOrder: 1,
        },
      ]));

      console.log('Creating biochar products...');
      await tx.insert(schema.biocharProducts).values(withBootstrapOrg<typeof schema.biocharProducts.$inferInsert>([
        {
          id: ids.biocharProduct1,
          code: 'BP-26-001',
          facilityId: ids.facilityMoshi,
          productionDate: new Date('2026-05-14T08:00:00.000Z'),
          status: 'ready',
          formulationId: ids.formulationStandard,
          linkedProductionRunId: ids.productionRun1,
          massKg: 2450,
          moistureContentPercent: 5.5,
          densityKgM3: 480,
          storageLocationId: ids.storageProdMoshi,
          expiresAt: new Date('2027-05-14T08:00:00.000Z'),
        },
        {
          id: ids.biocharProduct2,
          code: 'BP-26-002',
          facilityId: ids.facilityMoshi,
          productionDate: new Date('2026-05-16T09:00:00.000Z'),
          status: 'ready',
          formulationId: ids.formulationPremium,
          linkedProductionRunId: ids.productionRun2,
          massKg: 1800,
          moistureContentPercent: 4.8,
          densityKgM3: 520,
          storageLocationId: ids.storageProdPremium,
          expiresAt: new Date('2027-05-16T09:00:00.000Z'),
        },
        {
          id: ids.biocharProduct3,
          code: 'BP-26-003',
          facilityId: ids.facilityMoshi,
          productionDate: new Date('2026-05-18T10:00:00.000Z'),
          status: 'ready',
          formulationId: ids.formulationOrganic,
          linkedProductionRunId: ids.productionRun3,
          massKg: 2125,
          moistureContentPercent: 6.0,
          densityKgM3: 490,
          storageLocationId: ids.storageProdOrganic,
          expiresAt: new Date('2027-05-18T10:00:00.000Z'),
        },
      ]));

      // ============================================================
      // TRANSPORT LEGS (Isometric Transportation Module v1.1)
      // One leg per feedstock, biochar product, and lab sample, so the
      // Certify panel's transport-coverage gate is satisfied and
      // submitCreditBatch can build complete Removal payloads. All legs
      // use the distance-based method with one shared emission factor per
      // category — mixed methods/factors would block aggregation.
      //
      // Feedstock and biochar legs are AUTO-DERIVED in the app (feedstock:
      // supplier stored distance; biochar: aggregation of the product's
      // deliveries). The seed bypasses the fn-layer resync hooks, so it
      // inserts the rows the derivation would have produced — `isDerived:
      // true`, values consistent with the seeded suppliers, customer
      // locations, and deliveries above — letting any later resync converge
      // onto the same row instead of duplicating it. Sample → lab legs are
      // genuinely manual and stay `isDerived: false`.
      // ============================================================

      console.log('Creating transport legs...');
      await tx.insert(schema.transportLegs).values(withBootstrapOrg<typeof schema.transportLegs.$inferInsert>([
        // --- Feedstock (derived): supplier -> Moshi facility ---
        {
          id: ids.transportLegFeedstock1,
          entityType: 'feedstock',
          entityId: ids.feedstock1,
          isDerived: true,
          originName: 'Kilimanjaro Sustainable Forestry Cooperative',
          originGpsLatitude: -3.286,
          originGpsLongitude: 37.157,
          destinationName: 'Dark Earth Moshi Biochar Hub',
          destinationGpsLatitude: -3.3481,
          destinationGpsLongitude: 37.3404,
          distanceKm: 34,
          distanceSource: 'document',
          transportMethodType: 'road',
          vehicleType: 'heavy_truck',
          modelYear: 2022,
          loadMassKg: 4500,
          calculationMethodType: 'distance_based',
          billOfLading: 'BOL-FD-26-001',
          weighScaleTicketRef: 'WST-FD-26-001',
        },
        {
          id: ids.transportLegFeedstock2,
          entityType: 'feedstock',
          entityId: ids.feedstock2,
          isDerived: true,
          originName: 'Moshi Arabica Coffee Cooperative',
          originGpsLatitude: -3.244,
          originGpsLongitude: 37.421,
          destinationName: 'Dark Earth Moshi Biochar Hub',
          destinationGpsLatitude: -3.3481,
          destinationGpsLongitude: 37.3404,
          distanceKm: 29,
          distanceSource: 'document',
          transportMethodType: 'road',
          vehicleType: 'heavy_truck',
          modelYear: 2023,
          loadMassKg: 3200,
          calculationMethodType: 'distance_based',
          billOfLading: 'BOL-FD-26-002',
          weighScaleTicketRef: 'WST-FD-26-002',
        },
        {
          id: ids.transportLegFeedstock3,
          entityType: 'feedstock',
          entityId: ids.feedstock3,
          isDerived: true,
          originName: 'Kilimanjaro Sustainable Forestry Cooperative',
          originGpsLatitude: -3.286,
          originGpsLongitude: 37.157,
          destinationName: 'Dark Earth Moshi Biochar Hub',
          destinationGpsLatitude: -3.3481,
          destinationGpsLongitude: 37.3404,
          distanceKm: 34,
          distanceSource: 'document',
          transportMethodType: 'road',
          vehicleType: 'heavy_truck',
          modelYear: 2022,
          loadMassKg: 5000,
          calculationMethodType: 'distance_based',
          billOfLading: 'BOL-FD-26-003',
          weighScaleTicketRef: 'WST-FD-26-003',
        },
        // --- Biochar (derived): Moshi facility -> delivery destination.
        // Distance = customer location's stored distance, load = delivered
        // wet mass (one delivery per product, so no weighting needed). ---
        {
          id: ids.transportLegBiochar1,
          entityType: 'biochar',
          entityId: ids.biocharProduct1,
          isDerived: true,
          originName: 'Dark Earth Moshi Biochar Hub',
          originGpsLatitude: -3.3481,
          originGpsLongitude: 37.3404,
          destinationName: 'North Plot - Kilema',
          destinationGpsLatitude: -3.245,
          destinationGpsLongitude: 37.425,
          distanceKm: 32,
          distanceSource: 'document',
          transportMethodType: 'road',
          loadMassKg: 2000,
          calculationMethodType: 'distance_based',
          billOfLading: 'BOL-DL-26-001',
          weighScaleTicketRef: 'WST-DL-26-001',
        },
        {
          id: ids.transportLegBiochar2,
          entityType: 'biochar',
          entityId: ids.biocharProduct2,
          isDerived: true,
          originName: 'Dark Earth Moshi Biochar Hub',
          originGpsLatitude: -3.3481,
          originGpsLongitude: 37.3404,
          destinationName: 'Lushoto Estate Block E',
          destinationGpsLatitude: -4.789,
          destinationGpsLongitude: 38.312,
          distanceKm: 228,
          distanceSource: 'document',
          transportMethodType: 'road',
          loadMassKg: 1500,
          calculationMethodType: 'distance_based',
          billOfLading: 'BOL-DL-26-002',
          weighScaleTicketRef: 'WST-DL-26-002',
        },
        {
          id: ids.transportLegBiochar3,
          entityType: 'biochar',
          entityId: ids.biocharProduct3,
          isDerived: true,
          originName: 'Dark Earth Moshi Biochar Hub',
          originGpsLatitude: -3.3481,
          originGpsLongitude: 37.3404,
          destinationName: 'South Plot - Machame',
          destinationGpsLatitude: -3.289,
          destinationGpsLongitude: 37.198,
          distanceKm: 39,
          distanceSource: 'document',
          transportMethodType: 'road',
          loadMassKg: 1800,
          calculationMethodType: 'distance_based',
          billOfLading: 'BOL-DL-26-003',
          weighScaleTicketRef: 'WST-DL-26-003',
        },
        // --- Sample: Moshi facility -> analysis lab ---
        {
          id: ids.transportLegSample1,
          entityType: 'sample',
          entityId: ids.sample1,
          originName: 'Dark Earth Moshi Biochar Hub',
          originGpsLatitude: -3.3481,
          originGpsLongitude: 37.3404,
          destinationName: 'Kibo Analytical Labs, Arusha',
          destinationGpsLatitude: -3.3869,
          destinationGpsLongitude: 36.683,
          distanceKm: 82,
          distanceSource: 'document',
          transportMethodType: 'road',
          vehicleType: 'Courier van',
          loadMassKg: 5,
          calculationMethodType: 'distance_based',
          billOfLading: 'COC-SAM-26-001',
        },
        {
          id: ids.transportLegSample2,
          entityType: 'sample',
          entityId: ids.sample2,
          originName: 'Dark Earth Moshi Biochar Hub',
          originGpsLatitude: -3.3481,
          originGpsLongitude: 37.3404,
          destinationName: 'Kibo Analytical Labs, Arusha',
          destinationGpsLatitude: -3.3869,
          destinationGpsLongitude: 36.683,
          distanceKm: 82,
          distanceSource: 'document',
          transportMethodType: 'road',
          vehicleType: 'Courier van',
          loadMassKg: 5,
          calculationMethodType: 'distance_based',
          billOfLading: 'COC-SAM-26-002',
        },
        {
          id: ids.transportLegSample3,
          entityType: 'sample',
          entityId: ids.sample3,
          originName: 'Dark Earth Moshi Biochar Hub',
          originGpsLatitude: -3.3481,
          originGpsLongitude: 37.3404,
          destinationName: 'Kibo Analytical Labs, Arusha',
          destinationGpsLatitude: -3.3869,
          destinationGpsLongitude: 36.683,
          distanceKm: 82,
          distanceSource: 'document',
          transportMethodType: 'road',
          vehicleType: 'Courier van',
          loadMassKg: 5,
          calculationMethodType: 'distance_based',
          billOfLading: 'COC-SAM-26-003',
        },
        {
          id: ids.transportLegSample4,
          entityType: 'sample',
          entityId: ids.sample4,
          originName: 'Dark Earth Moshi Biochar Hub',
          originGpsLatitude: -3.3481,
          originGpsLongitude: 37.3404,
          destinationName: 'Kibo Analytical Labs, Arusha',
          destinationGpsLatitude: -3.3869,
          destinationGpsLongitude: 36.683,
          distanceKm: 82,
          distanceSource: 'document',
          transportMethodType: 'road',
          vehicleType: 'Courier van',
          loadMassKg: 5,
          calculationMethodType: 'distance_based',
          billOfLading: 'COC-SAM-26-004',
        },
        {
          id: ids.transportLegSample5,
          entityType: 'sample',
          entityId: ids.sample5,
          originName: 'Dark Earth Moshi Biochar Hub',
          originGpsLatitude: -3.3481,
          originGpsLongitude: 37.3404,
          destinationName: 'Kibo Analytical Labs, Arusha',
          destinationGpsLatitude: -3.3869,
          destinationGpsLongitude: 36.683,
          distanceKm: 82,
          distanceSource: 'document',
          transportMethodType: 'road',
          vehicleType: 'Courier van',
          loadMassKg: 5,
          calculationMethodType: 'distance_based',
          billOfLading: 'COC-SAM-26-005',
        },
        {
          id: ids.transportLegSample6,
          entityType: 'sample',
          entityId: ids.sample6,
          originName: 'Dark Earth Moshi Biochar Hub',
          originGpsLatitude: -3.3481,
          originGpsLongitude: 37.3404,
          destinationName: 'Kibo Analytical Labs, Arusha',
          destinationGpsLatitude: -3.3869,
          destinationGpsLongitude: 36.683,
          distanceKm: 82,
          distanceSource: 'document',
          transportMethodType: 'road',
          vehicleType: 'Courier van',
          loadMassKg: 5,
          calculationMethodType: 'distance_based',
          billOfLading: 'COC-SAM-26-006',
        },
      ]));

      // ============================================================
      // LOGISTICS: Orders, Deliveries
      // ============================================================

      console.log('Creating orders...');
      await tx.insert(schema.orders).values(withBootstrapOrg<typeof schema.orders.$inferInsert>([
        {
          id: ids.order1,
          code: 'OR-26-001',
          facilityId: ids.facilityMoshi,
          orderDate: demoTimestamps.order1Date,
          customerId: ids.customerCoffee,
          customerLocationId: ids.locationCoffeeNorth,
          biocharProductId: ids.biocharProduct1,
          quantityKg: 2000,
          packaging: 'bagged',
          value: 1500000,
        },
        {
          id: ids.order2,
          code: 'OR-26-002',
          facilityId: ids.facilityMoshi,
          orderDate: demoTimestamps.order2Date,
          customerId: ids.customerTea,
          customerLocationId: ids.locationTeaEast,
          biocharProductId: ids.biocharProduct2,
          quantityKg: 1500,
          packaging: 'bagged',
          value: 1200000,
        },
        {
          id: ids.order3,
          code: 'OR-26-003',
          facilityId: ids.facilityMoshi,
          orderDate: demoTimestamps.order3Date,
          customerId: ids.customerCoffee,
          customerLocationId: ids.locationCoffeeSouth,
          biocharProductId: ids.biocharProduct3,
          quantityKg: 1800,
          packaging: 'bagged',
          value: 1350000,
        },
      ]));

      console.log('Creating deliveries...');
      await tx.insert(schema.deliveries).values(withBootstrapOrg<typeof schema.deliveries.$inferInsert>([
        {
          id: ids.delivery1,
          code: 'DL-26-001',
          facilityId: ids.facilityMoshi,
          deliveryDate: demoTimestamps.delivery1Date,
          status: 'delivered',
          orderId: ids.order1,
          customerLocationId: ids.locationCoffeeNorth,
          biocharProductId: ids.biocharProduct1,
          storageLocationId: ids.storageProdMoshi,
          moistureContentPercent: 5.5,
          deliveredWetMassKg: 2000,
          massDryKg: 1890,
          driverId: ids.driverJackson,
          vehicleId: ids.vehicleTruck1,
        },
        {
          id: ids.delivery2,
          code: 'DL-26-002',
          facilityId: ids.facilityMoshi,
          deliveryDate: demoTimestamps.delivery2Date,
          status: 'delivered',
          orderId: ids.order2,
          customerLocationId: ids.locationTeaEast,
          biocharProductId: ids.biocharProduct2,
          storageLocationId: ids.storageProdPremium,
          moistureContentPercent: 4.8,
          deliveredWetMassKg: 1500,
          massDryKg: 1428,
          driverId: ids.driverAmina,
          vehicleId: ids.vehicleTruck2,
        },
        {
          id: ids.delivery3,
          code: 'DL-26-003',
          facilityId: ids.facilityMoshi,
          deliveryDate: demoTimestamps.delivery3Date,
          status: 'delivered',
          orderId: ids.order3,
          customerLocationId: ids.locationCoffeeSouth,
          biocharProductId: ids.biocharProduct3,
          storageLocationId: ids.storageProdOrganic,
          moistureContentPercent: 6.0,
          deliveredWetMassKg: 1800,
          massDryKg: 1692,
          driverId: ids.driverJackson,
          vehicleId: ids.vehicleTruck1,
        },
      ]));

      // ============================================================
      // APPLICATIONS & CREDITS
      // ============================================================

      console.log('Creating applications...');
      await tx.insert(schema.applications).values(withBootstrapOrg<typeof schema.applications.$inferInsert>([
        {
          id: ids.application1,
          code: 'AP-26-001',
          applicationDate: demoTimestamps.application1Date,
          status: 'applied',
          deliveryId: ids.delivery1,
          biocharAppliedTons: 1.89,
          biocharAppliedDryTons: 1.79,
          gpsLatitude: -3.245,
          gpsLongitude: 37.425,
          fieldSizeHa: 1.2,
          cropType: 'Coffee',
          applicationMethodType: 'mechanical',
          fieldIdentifier: 'KILEMA-N-12',
          evidenceMethod: 'boundary',
          gisBoundaryReference: 'TZ-KLM-KILEMA-N12-2026',
          co2eStoredTonnes: 4.38,
          soilTemperatureSource: 'baseline',
          soilTemperatureC: 24.5,
        },
        {
          id: ids.application2,
          code: 'AP-26-002',
          applicationDate: demoTimestamps.application2Date,
          status: 'applied',
          deliveryId: ids.delivery2,
          biocharAppliedTons: 1.43,
          biocharAppliedDryTons: 1.36,
          gpsLatitude: -4.789,
          gpsLongitude: 38.312,
          fieldSizeHa: 0.8,
          cropType: 'Tea',
          applicationMethodType: 'mechanical',
          fieldIdentifier: 'USAMBARA-E-1',
          evidenceMethod: 'boundary',
          gisBoundaryReference: 'TZ-TGA-LUSHOTO-E1-2026',
          co2eStoredTonnes: 3.35,
          soilTemperatureSource: 'baseline',
          soilTemperatureC: 22.8,
        },
        {
          id: ids.application3,
          code: 'AP-26-003',
          applicationDate: demoTimestamps.application3Date,
          status: 'applied',
          deliveryId: ids.delivery3,
          biocharAppliedTons: 1.69,
          biocharAppliedDryTons: 1.59,
          gpsLatitude: -3.289,
          gpsLongitude: 37.198,
          fieldSizeHa: 1.0,
          cropType: 'Coffee',
          applicationMethodType: 'manual',
          fieldIdentifier: 'MACHAME-S-8',
          evidenceMethod: 'boundary',
          gisBoundaryReference: 'TZ-KLM-MACHAME-S8-2026',
          co2eStoredTonnes: 3.88,
          soilTemperatureSource: 'baseline',
          soilTemperatureC: 25.2,
        },
      ]));

      const soilTemperatureRows = buildSoilTemperatureMeasurements([
        {
          idBase: 3000,
          applicationId: ids.application1,
          baselineMonth: '2026-05',
          baseTemperatureC: 24.5,
          gpsLatitude: -3.245,
          gpsLongitude: 37.425,
          fieldIdentifier: 'KILEMA-N-12',
        },
        {
          idBase: 3020,
          applicationId: ids.application2,
          baselineMonth: '2026-05',
          baseTemperatureC: 22.8,
          gpsLatitude: -4.789,
          gpsLongitude: 38.312,
          fieldIdentifier: 'USAMBARA-E-1',
        },
        {
          idBase: 3040,
          applicationId: ids.application3,
          baselineMonth: '2026-05',
          baseTemperatureC: 25.2,
          gpsLatitude: -3.289,
          gpsLongitude: 37.198,
          fieldIdentifier: 'MACHAME-S-8',
        },
      ], DEC_ORG_ID);

      console.log(`Creating ${soilTemperatureRows.length} soil temperature measurements...`);
      await tx.insert(schema.soilTemperatureMeasurements).values(soilTemperatureRows);

      console.log('Creating application boundary evidence documents...');
      await tx.insert(schema.documents).values(
        await storeSyntheticSeedDocuments(
          storageProvider,
          buildApplicationBoundaryDocuments([
            {
              id: ids.applicationBoundaryDocument1,
              applicationId: ids.application1,
              applicationCode: 'AP-26-001',
              capturedAt: demoTimestamps.application1Date,
              fieldIdentifier: 'KILEMA-N-12',
              boundaryReference: 'TZ-KLM-KILEMA-N12-2026',
              fileName: 'AP-26-001-boundary-logbook.pdf',
              fileSizeBytes: 184_320,
            },
            {
              id: ids.applicationBoundaryDocument2,
              applicationId: ids.application2,
              applicationCode: 'AP-26-002',
              capturedAt: demoTimestamps.application2Date,
              fieldIdentifier: 'USAMBARA-E-1',
              boundaryReference: 'TZ-TGA-LUSHOTO-E1-2026',
              fileName: 'AP-26-002-boundary-logbook.pdf',
              fileSizeBytes: 171_008,
            },
            {
              id: ids.applicationBoundaryDocument3,
              applicationId: ids.application3,
              applicationCode: 'AP-26-003',
              capturedAt: demoTimestamps.application3Date,
              fieldIdentifier: 'MACHAME-S-8',
              boundaryReference: 'TZ-KLM-MACHAME-S8-2026',
              fileName: 'AP-26-003-boundary-logbook.pdf',
              fileSizeBytes: 176_640,
            },
          ], DEC_ORG_ID),
          uploadedSeedDocumentKeys,
        ),
      );

      console.log('Creating transport evidence documents...');
      await tx.insert(schema.documents).values(
        await storeSyntheticSeedDocuments(
          storageProvider,
          buildTransportEvidenceDocuments([
          {
            id: demoId(3200),
            entityType: 'feedstock',
            entityId: ids.feedstock1,
            documentType: 'weighbridge_ticket',
            fileName: 'FS-26-001-weighbridge-ticket.pdf',
            capturedAt: demoTimestamps.firstDelivery,
            description:
              'Inbound weighbridge ticket recording the Machame-to-Moshi route and delivered mass.',
            evidenceReference: 'WST-FD-26-001',
            fileSizeBytes: 138_240,
          },
          {
            id: demoId(3201),
            entityType: 'feedstock',
            entityId: ids.feedstock2,
            documentType: 'weighbridge_ticket',
            fileName: 'FS-26-002-weighbridge-ticket.pdf',
            capturedAt: demoTimestamps.secondDelivery,
            description:
              'Inbound weighbridge ticket recording the Kilema-to-Moshi route and delivered mass.',
            evidenceReference: 'WST-FD-26-002',
            fileSizeBytes: 142_336,
          },
          {
            id: demoId(3202),
            entityType: 'feedstock',
            entityId: ids.feedstock3,
            documentType: 'bill_of_lading',
            fileName: 'FS-26-003-bill-of-lading.pdf',
            capturedAt: demoTimestamps.thirdDelivery,
            description:
              'Carrier bill of lading for the second hardwood-chip shipment from Machame.',
            evidenceReference: 'BOL-FD-26-003',
            fileSizeBytes: 151_552,
          },
          {
            id: demoId(3203),
            entityType: 'delivery',
            entityId: ids.delivery1,
            documentType: 'bill_of_lading',
            fileName: 'DL-26-001-bill-of-lading.pdf',
            capturedAt: demoTimestamps.delivery1Date,
            description:
              'Signed delivery route and custody record for the Kilema North Plot shipment.',
            evidenceReference: 'BOL-DL-26-001',
            fileSizeBytes: 166_912,
          },
          {
            id: demoId(3204),
            entityType: 'delivery',
            entityId: ids.delivery2,
            documentType: 'bill_of_lading',
            fileName: 'DL-26-002-bill-of-lading.pdf',
            capturedAt: demoTimestamps.delivery2Date,
            description:
              'Signed delivery route and custody record for the Lushoto Estate shipment.',
            evidenceReference: 'BOL-DL-26-002',
            fileSizeBytes: 174_080,
          },
          {
            id: demoId(3205),
            entityType: 'delivery',
            entityId: ids.delivery3,
            documentType: 'weighbridge_ticket',
            fileName: 'DL-26-003-weighbridge-ticket.pdf',
            capturedAt: demoTimestamps.delivery3Date,
            description:
              'Outbound weighbridge and destination route record for the Machame South Plot shipment.',
            evidenceReference: 'WST-DL-26-003',
            fileSizeBytes: 147_456,
          },
          {
            id: demoId(3206),
            entityType: 'transport_leg',
            entityId: ids.transportLegSample1,
            documentType: 'other_transport_evidence',
            fileName: 'SAM-26-001-chain-of-custody.pdf',
            capturedAt: new Date('2026-05-13T09:30:00.000Z'),
            description:
              'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
            evidenceReference: 'COC-SAM-26-001',
            fileSizeBytes: 126_976,
          },
          {
            id: demoId(3207),
            entityType: 'transport_leg',
            entityId: ids.transportLegSample2,
            documentType: 'other_transport_evidence',
            fileName: 'SAM-26-002-chain-of-custody.pdf',
            capturedAt: new Date('2026-05-15T09:00:00.000Z'),
            description:
              'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
            evidenceReference: 'COC-SAM-26-002',
            fileSizeBytes: 129_024,
          },
          {
            id: demoId(3208),
            entityType: 'transport_leg',
            entityId: ids.transportLegSample3,
            documentType: 'other_transport_evidence',
            fileName: 'SAM-26-003-chain-of-custody.pdf',
            capturedAt: new Date('2026-05-17T10:00:00.000Z'),
            description:
              'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
            evidenceReference: 'COC-SAM-26-003',
            fileSizeBytes: 127_488,
          },
          {
            id: demoId(3209),
            entityType: 'transport_leg',
            entityId: ids.transportLegSample4,
            documentType: 'other_transport_evidence',
            fileName: 'SAM-26-004-chain-of-custody.pdf',
            capturedAt: new Date('2026-05-18T08:30:00.000Z'),
            description:
              'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
            evidenceReference: 'COC-SAM-26-004',
            fileSizeBytes: 128_512,
          },
          {
            id: demoId(3210),
            entityType: 'transport_leg',
            entityId: ids.transportLegSample5,
            documentType: 'other_transport_evidence',
            fileName: 'SAM-26-005-chain-of-custody.pdf',
            capturedAt: new Date('2026-05-16T09:15:00.000Z'),
            description:
              'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
            evidenceReference: 'COC-SAM-26-005',
            fileSizeBytes: 130_560,
          },
          {
            id: demoId(3211),
            entityType: 'transport_leg',
            entityId: ids.transportLegSample6,
            documentType: 'other_transport_evidence',
            fileName: 'SAM-26-006-chain-of-custody.pdf',
            capturedAt: new Date('2026-05-17T08:45:00.000Z'),
            description:
              'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
            evidenceReference: 'COC-SAM-26-006',
            fileSizeBytes: 131_584,
          },
          ], DEC_ORG_ID),
          uploadedSeedDocumentKeys,
        ),
      );

      // Links the Moshi facility to the Isometric sandbox project +
      // Dark Earth Carbon Template, with the Phase 3.7 emission-estimate
      // config seeded from the Sifuri Halisi LCA. The Isometric facility
      // id stays operator-managed because it must come from Certify UI.
      console.log('Creating Isometric certifier project (Moshi)...');
      await tx.insert(schema.certifierProjects).values(withBootstrapOrg<typeof schema.certifierProjects.$inferInsert>([
        {
          facilityId: ids.facilityMoshi,
          externalProjectId: 'prj_1K9YJ33RKSBX9FFF',
          protocolVersion: '1.2',
          defaultRemovalTemplateId: 'rvt_1KS4S43VPSBXA26X',
          gensetEnergyYieldKwhPerLitre: 3.375,
          defaultSoilTemperatureC: 24.2,
          defaultSoilTemperatureSource:
            'Lembrechts et al. 2022 SoilTemp, 0–5 cm, Kilimanjaro region (annual mean)',
        },
      ]));

      await seedOperationalDetails(tx, DEC_ORG_ID, ids, demoTimestamps);

      // ============================================================
      // EXTRA STORAGE BINS (Moshi) — exercises the storage flow board at
      // realistic scale (20+ bins) with a spread of fill levels. Pure demo
      // data in a reserved id/code range (9xxx) so it never collides with
      // the curated entities above. Fill comes from the same sources the
      // board reads: feedstock rows, production-run output, and products.
      // ============================================================
      console.log('Creating extra storage bins (scale demo)...');

      const extraBinBase = 9000;
      const feedstockSupplyRotation = [
        {
          feedstockTypeId: ids.feedstockWoodchips,
          supplierId: ids.supplierKili,
          vehicleId: ids.vehicleTruck1,
          sourceRegion: 'Kilimanjaro',
        },
        {
          feedstockTypeId: ids.feedstockCoffeeHusk,
          supplierId: ids.supplierMeru,
          vehicleId: ids.vehicleTruck2,
          sourceRegion: 'Kilimanjaro',
        },
        {
          feedstockTypeId: ids.feedstockCoconut,
          supplierId: ids.supplierVictoria,
          vehicleId: ids.vehicleTruck2,
          sourceRegion: 'Arusha',
        },
      ];

      // [type, capacityBasisKg, fillFraction, name]
      // For feedstock/product bins the basis is the stored capacity. Biochar
      // bins are uncapped piles (stored capacity = null), so their basis is
      // only used to derive a realistic demo output mass.
      const extraBinSpecs: Array<
        ['feedstock_bin' | 'biochar_bin' | 'product_bin', number, number, string]
      > = [
        ['feedstock_bin', 12000, 0.0, 'Moshi Feedstock Bay B'],
        ['feedstock_bin', 18000, 0.22, 'Moshi Feedstock Bay C'],
        ['feedstock_bin', 15000, 0.46, 'Moshi Feedstock Bay D'],
        ['feedstock_bin', 22000, 0.68, 'Moshi Feedstock Bay E'],
        ['feedstock_bin', 16000, 0.88, 'Moshi Feedstock Bay F'],
        ['feedstock_bin', 14000, 0.97, 'Moshi Feedstock Bay G'],
        ['feedstock_bin', 20000, 0.34, 'Moshi Feedstock Bay H'],
        ['biochar_bin', 15000, 0.0, 'Moshi Biochar Store B'],
        ['biochar_bin', 12000, 0.28, 'Moshi Biochar Store C'],
        ['biochar_bin', 18000, 0.55, 'Moshi Biochar Store D'],
        ['biochar_bin', 14000, 0.8, 'Moshi Biochar Store E'],
        ['biochar_bin', 16000, 0.95, 'Moshi Biochar Store F'],
        ['product_bin', 10000, 0.0, 'Moshi Product Store B'],
        ['product_bin', 8000, 0.3, 'Moshi Product Store C'],
        ['product_bin', 12000, 0.58, 'Moshi Product Store D'],
        ['product_bin', 9000, 0.82, 'Moshi Product Store E'],
        ['product_bin', 11000, 0.95, 'Moshi Product Store F'],
        ['product_bin', 7000, 0.5, 'Moshi Product Store G'],
      ];

      const extraBins = extraBinSpecs.map(([type, capacityBasisKg, , name], i) => ({
        organizationId: DEC_ORG_ID,
        id: demoId(extraBinBase + i),
        code: `SL-26-${900 + i}`,
        name,
        type,
        // Biochar piles are uncapped; feedstock/product bins store their capacity.
        capacityKg: type === 'biochar_bin' ? null : capacityBasisKg,
        facilityId: ids.facilityMoshi,
        storageMethod:
          type === 'feedstock_bin'
            ? 'covered_bin'
            : type === 'biochar_bin'
              ? 'tarped_pile'
              : 'bagged_palletized',
        feedstockTypeId:
          type === 'feedstock_bin'
            ? feedstockSupplyRotation[i % feedstockSupplyRotation.length]
                .feedstockTypeId
            : null,
      }));
      await tx.insert(schema.storageLocations).values(extraBins);

      const extraFeedstocks: (typeof schema.feedstocks.$inferInsert)[] = [];
      const extraRuns: (typeof schema.productionRuns.$inferInsert)[] = [];
      const extraProducts: (typeof schema.biocharProducts.$inferInsert)[] = [];

      extraBinSpecs.forEach(([type, capacityBasisKg, frac], i) => {
        const massKg = Math.round(capacityBasisKg * frac);
        if (massKg <= 0) return; // leave a few bins empty on purpose
        const binId = demoId(extraBinBase + i);
        if (type === 'feedstock_bin') {
          const supply =
            feedstockSupplyRotation[i % feedstockSupplyRotation.length];
          const moistureContentPercent = 15;
          const moistureFactor = 1 - moistureContentPercent / 100;
          extraFeedstocks.push({
            organizationId: DEC_ORG_ID,
            id: demoId(extraBinBase + 100 + i),
            code: `FI-26-${900 + i}`,
            facilityId: ids.facilityMoshi,
            status: 'complete',
            deliveryDate: new Date(Date.UTC(2026, 4, 19, 7 + i, 0, 0)),
            supplierId: supply.supplierId,
            vehicleId: supply.vehicleId,
            gpsLatitude: -3.3481,
            gpsLongitude: 37.3404,
            feedstockTypeId: supply.feedstockTypeId,
            massDryKg: massKg,
            massWetKg: Math.round(massKg / moistureFactor),
            moistureContentPercent,
            feedstockSourceRegion: supply.sourceRegion,
            storageLocationId: binId,
            counterfactualCategory: 'open_decay',
            baselineScenario: 'mulched_or_open_decay',
            baselineDescription:
              'Scale-demo lot follows the same documented regional residue baseline as the curated supply chain.',
            eligibilityStatus: 'eligible',
          });
        } else if (type === 'biochar_bin') {
          // All extra runs share one reactor, so their windows must not
          // overlap (#259: unique start per reactor AND no window overlap).
          // Stagger starts by 6 hours per bin index — each closed 4-hour
          // window then has a 2-hour gap before the next run.
          const runStart = new Date(Date.UTC(2026, 4, 20, i * 6, 0, 0));
          const runEnd = new Date(runStart.getTime() + 4 * 60 * 60 * 1000);
          extraRuns.push({
            organizationId: DEC_ORG_ID,
            id: demoId(extraBinBase + 200 + i),
            code: `PR-26-${900 + i}`,
            facilityId: ids.facilityMoshi,
            status: 'complete',
            startTime: runStart,
            endTime: runEnd,
            reactorId: ids.reactorMoshi1,
            biocharStorageLocationId: binId,
            biocharOutputKg: massKg,
          });
        } else {
          extraProducts.push({
            organizationId: DEC_ORG_ID,
            id: demoId(extraBinBase + 300 + i),
            code: `BP-26-${900 + i}`,
            facilityId: ids.facilityMoshi,
            productionDate: new Date('2026-05-20T12:00:00.000Z'),
            status: 'testing',
            composition: {},
            massKg,
            storageLocationId: binId,
          });
        }
      });

      if (extraFeedstocks.length > 0) {
        await tx.insert(schema.feedstocks).values(extraFeedstocks);
      }
      if (extraRuns.length > 0) {
        await tx.insert(schema.productionRuns).values(extraRuns);
      }
      if (extraProducts.length > 0) {
        await tx.insert(schema.biocharProducts).values(extraProducts);
      }
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
