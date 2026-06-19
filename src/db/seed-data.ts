/**
 * Realistic Demo Seed Data Script
 *
 * Creates a realistic demo dataset for demonstrations and testing.
 * This includes one facility, realistic suppliers/customers, and a complete
 * traceability chain showing the full biochar carbon credit workflow.
 *
 * Usage: pnpm tsx src/db/seed-data.ts
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from 'dotenv';
import { Pool } from 'pg';
import * as schema from './schema';
import { getPgPoolConfig } from '../lib/pg-pool-config';
import {
  buildApplicationBoundaryDocuments,
  buildProductionRunReadings,
  buildSoilTemperatureMeasurements,
} from './seed-certification-evidence';

config({ path: '.env.local' });

// Helper to generate deterministic UUIDs for demo data
const demoId = (n: number) => `de000000-0000-4000-a000-${n.toString().padStart(12, '0')}`;

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

  // Samples
  sample1: demoId(1850),
  sample2: demoId(1851),
  sample3: demoId(1852),

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

  // Transport Legs (one feedstock + biochar + sample leg per production run)
  transportLegFeedstock1: demoId(2400),
  transportLegFeedstock2: demoId(2401),
  transportLegFeedstock3: demoId(2402),
  transportLegBiochar1: demoId(2403),
  transportLegBiochar2: demoId(2404),
  transportLegBiochar3: demoId(2405),
  transportLegSample1: demoId(2406),
  transportLegSample2: demoId(2407),
  transportLegSample3: demoId(2408),
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

    // Check if demo data already exists
    const [existingFacility] = await db
      .select({ id: schema.facilities.id })
      .from(schema.facilities)
      .where(eq(schema.facilities.code, demoCodes.facilityMoshi))
      .limit(1);

    if (existingFacility) {
      console.log(`Demo data already present (facility ${demoCodes.facilityMoshi}). Skipping.`);
      return;
    }

    await db.transaction(async (tx) => {
      // ============================================================
      // INFRASTRUCTURE: Facilities, Reactors, Storage Locations
      // ============================================================

      console.log('Creating facilities...');
      await tx.insert(schema.facilities).values([
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
          defaultDurabilityOption: '200_year',
        },
      ]);

      console.log('Creating reactors...');
      await tx.insert(schema.reactors).values([
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
      ]);

      console.log('Creating storage locations...');
      await tx.insert(schema.storageLocations).values([
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
      ]);

      // ============================================================
      // PARTIES: Suppliers, Customers, Drivers, Operators
      // ============================================================

      console.log('Creating suppliers...');
      await tx.insert(schema.suppliers).values([
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
          distanceSource: 'map_estimate',
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
          distanceSource: 'map_estimate',
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
          distanceSource: 'map_estimate',
        },
      ]);

      console.log('Creating customers...');
      await tx.insert(schema.customers).values([
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
      ]);

      console.log('Creating customer locations...');
      await tx.insert(schema.customerLocations).values([
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
          distanceSource: 'map_estimate',
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
          distanceSource: 'map_estimate',
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
          distanceSource: 'map_estimate',
          defaultSoilTemperatureC: 22.8,
          isDefault: true,
        },
      ]);

      console.log('Creating drivers and operators...');
      await tx.insert(schema.drivers).values([
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
      ]);

      await tx.insert(schema.operators).values([
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
      ]);

      await tx.insert(schema.vehicles).values([
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
      ]);

      // ============================================================
      // FEEDSTOCK: Types, Deliveries, Feedstocks
      // ============================================================

      console.log('Creating feedstock types...');
      await tx.insert(schema.feedstockTypes).values([
        {
          id: ids.feedstockWoodchips,
          code: 'FT-26-001',
          name: 'Mixed Hardwood Chips',
          category: 'forestry',
          usage: 'pyrolysis',
          description: 'Pruned branches and sawmill residues from local forestry operations',
        },
        {
          id: ids.feedstockCoffeeHusk,
          code: 'FT-26-002',
          name: 'Arabica Coffee Husk',
          category: 'agricultural',
          usage: 'pyrolysis',
          description: 'Coffee processing residue from wet mills',
        },
        {
          id: ids.feedstockRiceHusk,
          code: 'FT-26-003',
          name: 'Rice Husk',
          category: 'agricultural',
          usage: 'pyrolysis',
          description: 'Rice milling byproduct with high silica content',
        },
        {
          id: ids.feedstockCoconut,
          code: 'FT-26-004',
          name: 'Coconut Shell',
          category: 'agricultural',
          usage: 'pyrolysis',
          description: 'Coconut processing waste shells',
        },
        {
          id: ids.feedstockCowCompost,
          code: 'FT-26-005',
          name: 'Cow Manure Compost',
          category: 'compost',
          usage: 'blend',
          description: 'Matured cow manure compost used as a blend material',
        },
        {
          id: ids.feedstockGreenCompost,
          code: 'FT-26-006',
          name: 'Green Waste Compost',
          category: 'compost',
          usage: 'blend',
          description: 'Screened green waste compost used as a blend material',
        },
        {
          id: ids.feedstockRockDust,
          code: 'FT-26-007',
          name: 'Rock Dust',
          category: 'mineral',
          usage: 'blend',
          description: 'Fine mineral amendment for premium blends',
        },
        {
          id: ids.feedstockVermicompost,
          code: 'FT-26-008',
          name: 'Vermicompost',
          category: 'compost',
          usage: 'blend',
          description: 'Certified vermicompost for organic blends',
        },
        {
          id: ids.feedstockAgriculturalLime,
          code: 'FT-26-009',
          name: 'Agricultural Lime',
          category: 'lime',
          usage: 'blend',
          description: 'Agricultural lime used to adjust blend pH',
        },
      ]);

      console.log('Creating feedstock deliveries...');
      await tx.insert(schema.feedstockDeliveries).values([
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
      ]);

      console.log('Creating feedstocks...');
      await tx.insert(schema.feedstocks).values([
        {
          id: ids.feedstock1,
          code: 'FS-26-001',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          feedstockDeliveryId: ids.deliveryFeed1,
          feedstockTypeId: ids.feedstockWoodchips,
          supplierId: ids.supplierKili,
          vehicleId: ids.vehicleTruck1,
          truckMassOnArrivalKg: 12350,
          truckMassOnDepartureKg: 7850,
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
          truckMassOnArrivalKg: 10940,
          truckMassOnDepartureKg: 7740,
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
          truckMassOnArrivalKg: 12880,
          truckMassOnDepartureKg: 7880,
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
      ]);

      // ============================================================
      // PRODUCTION: Runs, Samples
      // ============================================================

      console.log('Creating production runs...');
      await tx.insert(schema.productionRuns).values([
        {
          id: ids.productionRun1,
          code: 'PR-26-001',
          facilityId: ids.facilityMoshi,
          date: '2026-05-13',
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
          date: '2026-05-15',
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
          date: '2026-05-17',
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
      ]);

      console.log('Creating production run feedstock links...');
      await tx.insert(schema.productionRunFeedstocks).values([
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
      ]);

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
      ]);

      console.log(`Creating ${productionRunReadingRows.length} production run readings...`);
      await tx.insert(schema.productionRunReadings).values(productionRunReadingRows);

      console.log('Creating samples...');
      await tx.insert(schema.samples).values([
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
          hToCOrgRatio: 0.27,
          ashContentPercent: 9.5,
          moistureContentPercent: 4.8,
        },
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
          hToCOrgRatio: 0.22,
          ashContentPercent: 8.2,
          moistureContentPercent: 5.1,
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
          hToCOrgRatio: 0.31,
          ashContentPercent: 10.8,
          moistureContentPercent: 5.4,
        },
      ]);

      // ============================================================
      // PRODUCTS: Formulations, Biochar Products
      // ============================================================

      console.log('Creating formulations...');
      await tx.insert(schema.formulations).values([
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
      ]);

      // Seed formulation ingredients
      await tx.insert(schema.formulationIngredients).values([
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
      ]);

      console.log('Creating biochar products...');
      await tx.insert(schema.biocharProducts).values([
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
      ]);

      // ============================================================
      // TRANSPORT LEGS (Isometric Transportation Module v1.1)
      // One feedstock + biochar + sample leg per production run, so the
      // Certify panel's per-run transport-coverage gate is satisfied and
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
      await tx.insert(schema.transportLegs).values([
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
          distanceSource: 'map_estimate',
          transportMethodType: 'road',
          vehicleType: 'heavy_truck',
          modelYear: 2022,
          loadMassKg: 4500,
          calculationMethodType: 'distance_based',
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
          distanceSource: 'map_estimate',
          transportMethodType: 'road',
          vehicleType: 'heavy_truck',
          modelYear: 2023,
          loadMassKg: 3200,
          calculationMethodType: 'distance_based',
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
          distanceSource: 'map_estimate',
          transportMethodType: 'road',
          vehicleType: 'heavy_truck',
          modelYear: 2022,
          loadMassKg: 5000,
          calculationMethodType: 'distance_based',
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
          distanceSource: 'map_estimate',
          transportMethodType: 'road',
          loadMassKg: 2000,
          calculationMethodType: 'distance_based',
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
          distanceSource: 'map_estimate',
          transportMethodType: 'road',
          loadMassKg: 1500,
          calculationMethodType: 'distance_based',
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
          distanceSource: 'map_estimate',
          transportMethodType: 'road',
          loadMassKg: 1800,
          calculationMethodType: 'distance_based',
        },
        // --- Sample: Moshi facility -> analysis lab ---
        {
          id: ids.transportLegSample1,
          entityType: 'sample',
          entityId: ids.sample1,
          originName: 'Dark Earth Moshi Biochar Hub',
          destinationName: 'Kibo Analytical Labs, Arusha',
          distanceKm: 82,
          distanceSource: 'map_estimate',
          transportMethodType: 'road',
          vehicleType: 'Courier van',
          loadMassKg: 5,
          calculationMethodType: 'distance_based',
        },
        {
          id: ids.transportLegSample2,
          entityType: 'sample',
          entityId: ids.sample2,
          originName: 'Dark Earth Moshi Biochar Hub',
          destinationName: 'Kibo Analytical Labs, Arusha',
          distanceKm: 82,
          distanceSource: 'map_estimate',
          transportMethodType: 'road',
          vehicleType: 'Courier van',
          loadMassKg: 5,
          calculationMethodType: 'distance_based',
        },
        {
          id: ids.transportLegSample3,
          entityType: 'sample',
          entityId: ids.sample3,
          originName: 'Dark Earth Moshi Biochar Hub',
          destinationName: 'Kibo Analytical Labs, Arusha',
          distanceKm: 82,
          distanceSource: 'map_estimate',
          transportMethodType: 'road',
          vehicleType: 'Courier van',
          loadMassKg: 5,
          calculationMethodType: 'distance_based',
        },
      ]);

      // ============================================================
      // LOGISTICS: Orders, Deliveries
      // ============================================================

      console.log('Creating orders...');
      await tx.insert(schema.orders).values([
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
      ]);

      console.log('Creating deliveries...');
      await tx.insert(schema.deliveries).values([
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
          truckMassOnArrivalKg: 8820,
          truckMassOnDepartureKg: 6820,
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
          truckMassOnArrivalKg: 9600,
          truckMassOnDepartureKg: 8100,
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
          truckMassOnArrivalKg: 8610,
          truckMassOnDepartureKg: 6810,
          driverId: ids.driverJackson,
          vehicleId: ids.vehicleTruck1,
        },
      ]);

      // ============================================================
      // APPLICATIONS & CREDITS
      // ============================================================

      console.log('Creating applications...');
      await tx.insert(schema.applications).values([
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
      ]);

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
      ]);

      console.log(`Creating ${soilTemperatureRows.length} soil temperature measurements...`);
      await tx.insert(schema.soilTemperatureMeasurements).values(soilTemperatureRows);

      console.log('Creating application boundary evidence documents...');
      await tx.insert(schema.documents).values(
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
        ])
      );

      // ADR 0016: a production process is the (facility, feedstock) sampling-regime
      // campaign that scopes Method A/B; each credit batch is a <=1-month protocol
      // production batch slicing exactly one process. Moshi runs two feedstocks, so
      // two processes — both Method A (the default; Method B is deferred to ADR 0017).
      console.log('Creating production processes...');
      await tx.insert(schema.productionProcesses).values([
        {
          id: ids.processMoshiWoodchips,
          facilityId: ids.facilityMoshi,
          feedstockTypeId: ids.feedstockWoodchips,
          establishedAt: demoTimestamps.facilitySetup,
        },
        {
          id: ids.processMoshiCoffee,
          facilityId: ids.facilityMoshi,
          feedstockTypeId: ids.feedstockCoffeeHusk,
          establishedAt: demoTimestamps.facilitySetup,
        },
      ]);

      // Each batch is single-feedstock (ADR 0016): CB-26-001 is the woodchips
      // production batch (runs PR-26-001 + PR-26-003), CB-26-002 the coffee-husk
      // one (run PR-26-002). Both sit inside the May window of their process.
      console.log('Creating credit batches...');
      await tx.insert(schema.creditBatches).values([
        {
          id: ids.creditBatch1,
          code: 'CB-26-001',
          facilityId: ids.facilityMoshi,
          feedstockTypeId: ids.feedstockWoodchips,
          productionProcessId: ids.processMoshiWoodchips,
          status: 'pending',
          startDate: '2026-05-13',
          endDate: '2026-05-31',
          certifier: 'isometric',
          registry: 'Isometric Registry',
          weightTons: 5.01,
          bufferPoolPercent: 10,
          durabilityOption: '200_year',
          hToCorgRatio: 0.269,
          fDurableCalculated: 0.851,
          totalCo2eStoredTons: 11.61,
          totalCo2eEmissionsTons: 0.64,
          totalCo2eCounterfactualTons: 0.31,
          totalFeedstockMassKg: 6500,
          ineligibleFeedstockMassKg: 0,
          siteManagementNotes:
            'Biochar incorporated into planting rows within 48 hours; no synthetic nitrogen applied during the application window.',
          affidavitReference: 'AFF-MOSHI-2026-001',
          intendedUseConfirmation: 'Customer purchase orders specify soil application on named coffee and tea plots.',
          companyVerificationRef: 'BRELA-agri-customer-records-2026',
          mixingTimelineDays: 2,
        },
        {
          id: ids.creditBatch2,
          code: 'CB-26-002',
          facilityId: ids.facilityMoshi,
          feedstockTypeId: ids.feedstockCoffeeHusk,
          productionProcessId: ids.processMoshiCoffee,
          status: 'draft',
          startDate: '2026-05-15',
          endDate: '2026-05-31',
          certifier: 'isometric',
          registry: 'Isometric Registry',
          durabilityOption: '1000_year',
          meanRandomReflectancePercent: 2.8,
          meanNonReactiveCarbonPercent: 68,
        },
      ]);

      console.log('Creating credit batch production-run membership...');
      await tx.insert(schema.creditBatchProductionRuns).values([
        {
          creditBatchId: ids.creditBatch1,
          productionRunId: ids.productionRun1,
        },
        {
          creditBatchId: ids.creditBatch1,
          productionRunId: ids.productionRun3,
        },
        {
          creditBatchId: ids.creditBatch2,
          productionRunId: ids.productionRun2,
        },
      ]);

      // Links the Moshi facility to the Isometric sandbox project +
      // Dark Earth Carbon Template, with the Phase 3.7 emission-estimate
      // config seeded from the Sifuri Halisi LCA. The Isometric facility
      // id stays operator-managed because it must come from Certify UI.
      console.log('Creating Isometric certifier project (Moshi)...');
      await tx.insert(schema.certifierProjects).values([
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
      ]);

      // ============================================================
      // EXTRA STORAGE BINS (Moshi) — exercises the storage flow board at
      // realistic scale (20+ bins) with a spread of fill levels. Pure demo
      // data in a reserved id/code range (9xxx) so it never collides with
      // the curated entities above. Fill comes from the same sources the
      // board reads: feedstock rows, production-run output, and products.
      // ============================================================
      console.log('Creating extra storage bins (scale demo)...');

      const extraBinBase = 9000;
      const feedstockTypeRotation = [
        ids.feedstockWoodchips,
        ids.feedstockCoffeeHusk,
        ids.feedstockCoconut,
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
            ? feedstockTypeRotation[i % feedstockTypeRotation.length]
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
          const moistureContentPercent = 15;
          const moistureFactor = 1 - moistureContentPercent / 100;
          extraFeedstocks.push({
            id: demoId(extraBinBase + 100 + i),
            code: `FI-26-${900 + i}`,
            facilityId: ids.facilityMoshi,
            status: 'complete',
            feedstockTypeId: feedstockTypeRotation[i % feedstockTypeRotation.length],
            massDryKg: massKg,
            massWetKg: Math.round(massKg / moistureFactor),
            moistureContentPercent,
            storageLocationId: binId,
          });
        } else if (type === 'biochar_bin') {
          extraRuns.push({
            id: demoId(extraBinBase + 200 + i),
            code: `PR-26-${900 + i}`,
            facilityId: ids.facilityMoshi,
            date: '2026-05-20',
            status: 'complete',
            reactorId: ids.reactorMoshi1,
            biocharStorageLocationId: binId,
            biocharOutputKg: massKg,
          });
        } else {
          extraProducts.push({
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
    });

    console.log('');
    console.log('Demo data seed completed successfully!');
    console.log('');
    console.log('Summary of created entities:');
    console.log('  - 1 Facility (Dark Earth Moshi Biochar Hub)');
    console.log('  - 2 Reactors');
    console.log('  - 24 Storage Locations (6 curated + 18 scale-demo on Moshi)');
    console.log('  - 3 Suppliers');
    console.log('  - 3 Customers with 3 Locations');
    console.log('  - 2 Drivers, 2 Operators, 2 Vehicles');
    console.log('  - 9 Feedstock Types');
    console.log('  - 3 Feedstock Deliveries -> 3 Feedstocks');
    console.log('  - 3 Production Runs -> 285 telemetry readings -> 3 Samples');
    console.log('  - 9 Transport Legs (3 feedstock, 3 biochar, 3 sample)');
    console.log('  - 3 Formulations');
    console.log('  - 3 Biochar Products');
    console.log('  - 3 Orders -> 3 Deliveries');
    console.log('  - 3 Applications -> 30 soil temperature measurements + 3 boundary PDFs');
    console.log('  - 2 Credit Batches (1 with 3 linked applications)');
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
