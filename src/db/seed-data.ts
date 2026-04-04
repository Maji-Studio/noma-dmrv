/**
 * Realistic Demo Seed Data Script
 *
 * Creates a realistic demo dataset for demonstrations and testing.
 * This includes multiple facilities, suppliers, customers, and a complete
 * traceability chain showing the full biochar carbon credit workflow.
 *
 * Usage: pnpm tsx src/db/seed-data.ts
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from 'dotenv';
import { Pool } from 'pg';
import * as schema from './schema';

config({ path: '.env.local' });

// Helper to generate deterministic UUIDs for demo data
const demoId = (n: number) => `de000000-0000-4000-a000-${n.toString().padStart(12, '0')}`;

// Demo data codes
const demoCodes = {
  // Facilities
  facilityMoshi: 'FAC-MOSHI-001',
  facilityArusha: 'FAC-ARUSHA-001',
  facilityMwanza: 'FAC-MWANZA-001',

  // Reactors
  reactorMoshi1: 'R-MOSHI-001',
  reactorMoshi2: 'R-MOSHI-002',
  reactorArusha1: 'R-ARUSHA-001',

  // Storage
  storageFeedMoshi: 'SL-FEED-MOSHI-01',
  storageCharMoshi: 'SL-CHAR-MOSHI-01',
  storageProdMoshi: 'SL-PROD-MOSHI-01',

  // Suppliers
  supplierKili: 'SUP-KILI-001',
  supplierMeru: 'SUP-MERU-001',
  supplierVictoria: 'SUP-VICTORIA-001',

  // Customers
  customerCoffee: 'CUS-COFFEE-001',
  customerTea: 'CUS-TEA-001',
  customerVegetable: 'CUS-VEG-001',
} as const;

// Demo entity IDs
const ids = {
  // Facilities
  facilityMoshi: demoId(1000),
  facilityArusha: demoId(1001),
  facilityMwanza: demoId(1002),

  // Reactors
  reactorMoshi1: demoId(1100),
  reactorMoshi2: demoId(1101),
  reactorArusha1: demoId(1102),

  // Storage Locations
  storageFeedMoshi: demoId(1200),
  storageCharMoshi: demoId(1201),
  storageProdMoshi: demoId(1202),
  storageFeedArusha: demoId(1203),
  storageCharArusha: demoId(1204),

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

  // Feedstock Deliveries
  deliveryFeed1: demoId(1700),
  deliveryFeed2: demoId(1701),
  deliveryFeed3: demoId(1702),

  // Feedstocks
  feedstock1: demoId(1750),
  feedstock2: demoId(1751),
  feedstock3: demoId(1752),

  // Production Runs
  productionRun1: demoId(1800),
  productionRun2: demoId(1801),
  productionRun3: demoId(1802),

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

  // Credit Batches
  creditBatch1: demoId(2200),
  creditBatch2: demoId(2201),

  // Junction table IDs
  prodFeedLink1: demoId(2300),
  prodFeedLink2: demoId(2301),
  prodFeedLink3: demoId(2302),
  creditApp1: demoId(2350),
  creditApp2: demoId(2351),
  creditApp3: demoId(2352),
} as const;

// Demo timestamps (realistic timeline)
const demoTimestamps = {
  // Week 1: Setup and first deliveries
  facilitySetup: new Date('2026-01-05T08:00:00.000Z'),
  firstDelivery: new Date('2026-01-08T09:30:00.000Z'),
  secondDelivery: new Date('2026-01-10T10:15:00.000Z'),
  thirdDelivery: new Date('2026-01-12T08:45:00.000Z'),

  // Week 2: Production runs
  run1Start: new Date('2026-01-13T06:00:00.000Z'),
  run1End: new Date('2026-01-13T14:00:00.000Z'),
  run2Start: new Date('2026-01-15T06:00:00.000Z'),
  run2End: new Date('2026-01-15T13:30:00.000Z'),
  run3Start: new Date('2026-01-17T07:00:00.000Z'),
  run3End: new Date('2026-01-17T15:00:00.000Z'),

  // Week 3: Orders and deliveries
  order1Date: new Date('2026-01-20T09:00:00.000Z'),
  order2Date: new Date('2026-01-21T10:30:00.000Z'),
  order3Date: new Date('2026-01-22T11:00:00.000Z'),
  delivery1Date: new Date('2026-01-23T08:00:00.000Z'),
  delivery2Date: new Date('2026-01-24T09:30:00.000Z'),
  delivery3Date: new Date('2026-01-25T10:00:00.000Z'),

  // Week 4: Applications and credits
  application1Date: new Date('2026-01-27T11:00:00.000Z'),
  application2Date: new Date('2026-01-28T10:30:00.000Z'),
  application3Date: new Date('2026-01-29T09:00:00.000Z'),
  creditBatch1Start: new Date('2026-01-13T00:00:00.000Z'),
  creditBatch1End: new Date('2026-01-31T23:59:59.000Z'),
} as const;

async function seedDemoData() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

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
          name: 'Moshi Biochar Production Center',
          location: 'Moshi, Tanzania',
          gpsLatitude: -3.334,
          gpsLongitude: 37.339,
          country: 'Tanzania',
          address: 'Industrial Zone, Moshi District',
          contactEmail: 'moshi@noma-biochar.tz',
          contactPhone: '+255700100001',
          defaultDurabilityOption: '200_year',
        },
        {
          id: ids.facilityArusha,
          code: demoCodes.facilityArusha,
          name: 'Arusha Green Energy Hub',
          location: 'Arusha, Tanzania',
          gpsLatitude: -3.386,
          gpsLongitude: 36.683,
          country: 'Tanzania',
          address: 'Njiro Industrial Area, Arusha',
          contactEmail: 'arusha@noma-biochar.tz',
          contactPhone: '+255700100002',
          defaultDurabilityOption: '200_year',
        },
        {
          id: ids.facilityMwanza,
          code: demoCodes.facilityMwanza,
          name: 'Mwanza Lakeside Facility',
          location: 'Mwanza, Tanzania',
          gpsLatitude: -2.516,
          gpsLongitude: 32.902,
          country: 'Tanzania',
          address: 'Nyamagana Industrial Park',
          contactEmail: 'mwanza@noma-biochar.tz',
          contactPhone: '+255700100003',
          defaultDurabilityOption: '1000_year',
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
          samplingMethod: 'method_a',
          capacityKg: 750,
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
          samplingMethod: 'method_b',
          capacityKg: 500,
          specifications: {
            manufacturer: 'NOMA Engineering',
            model: 'BatchPro-500',
            yearInstalled: 2025,
          },
        },
        {
          id: ids.reactorArusha1,
          code: demoCodes.reactorArusha1,
          identifier: 'Kiln-Gamma',
          facilityId: ids.facilityArusha,
          reactorType: 'auger',
          samplingMethod: 'method_a',
          capacityKg: 1000,
          specifications: {
            manufacturer: 'NOMA Engineering',
            model: 'AugerMax-1000',
            yearInstalled: 2026,
          },
        },
      ]);

      console.log('Creating storage locations...');
      await tx.insert(schema.storageLocations).values([
        {
          id: ids.storageFeedMoshi,
          code: demoCodes.storageFeedMoshi,
          name: 'Moshi Feedstock Bay A',
          type: 'feedstock_bin',
          capacityKg: 20000,
          latitude: -3.3338,
          longitude: 37.3385,
          storageMethod: 'covered_bin',
          storageDescription: 'Climate-controlled covered storage with moisture monitoring',
          facilityId: ids.facilityMoshi,
        },
        {
          id: ids.storageCharMoshi,
          code: demoCodes.storageCharMoshi,
          name: 'Moshi Biochar Storage',
          type: 'biochar_bin',
          capacityKg: 15000,
          latitude: -3.3339,
          longitude: 37.3387,
          storageMethod: 'tarped_pile',
          storageDescription: 'Covered pile on impermeable liner with drainage',
          facilityId: ids.facilityMoshi,
        },
        {
          id: ids.storageProdMoshi,
          code: demoCodes.storageProdMoshi,
          name: 'Moshi Product Warehouse',
          type: 'product_bin',
          capacityKg: 10000,
          latitude: -3.3340,
          longitude: 37.3389,
          storageMethod: 'bagged_palletized',
          storageDescription: 'Sheltered warehouse with bagged products on pallets',
          facilityId: ids.facilityMoshi,
        },
        {
          id: ids.storageFeedArusha,
          code: 'SL-FEED-ARUSHA-01',
          name: 'Arusha Feedstock Storage',
          type: 'feedstock_bin',
          capacityKg: 25000,
          latitude: -3.3862,
          longitude: 36.6833,
          storageMethod: 'covered_bin',
          facilityId: ids.facilityArusha,
        },
        {
          id: ids.storageCharArusha,
          code: 'SL-CHAR-ARUSHA-01',
          name: 'Arusha Biochar Storage',
          type: 'biochar_bin',
          capacityKg: 18000,
          latitude: -3.3864,
          longitude: 36.6835,
          storageMethod: 'tarped_pile',
          facilityId: ids.facilityArusha,
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
          name: 'Kilimanjaro Forestry Cooperative',
          location: 'Hai District, Kilimanjaro',
          gpsLatitude: -3.261,
          gpsLongitude: 37.126,
          address: 'Machame Road, Hai',
          contactName: 'Asha Mallya',
          contactEmail: 'asha@kili-forestry.coop',
          contactPhone: '+255700200001',
          sourceRegion: 'Kilimanjaro',
        },
        {
          id: ids.supplierMeru,
          code: demoCodes.supplierMeru,
          name: 'Mount Meru Agricultural Residues',
          location: 'Arumeru District',
          gpsLatitude: -3.252,
          gpsLongitude: 36.786,
          address: 'Usa River, Arumeru',
          contactName: 'John Kimaro',
          contactEmail: 'john@meru-agri.co.tz',
          contactPhone: '+255700200002',
          sourceRegion: 'Arumeru',
        },
        {
          id: ids.supplierVictoria,
          code: demoCodes.supplierVictoria,
          name: 'Lake Victoria Rice Mills',
          location: 'Mwanza Region',
          gpsLatitude: -2.516,
          gpsLongitude: 32.902,
          address: 'Ilemela District, Mwanza',
          contactName: 'Grace Mushi',
          contactEmail: 'grace@victoria-rice.tz',
          contactPhone: '+255700200003',
          sourceRegion: 'Mwanza',
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
          name: 'Arusha Organic Vegetable Farms',
          cropType: 'Mixed Vegetables',
          address: 'Tengeru, Arumeru District',
          contactEmail: 'orders@arusha-organic.tz',
          contactPhone: '+255700300003',
        },
      ]);

      console.log('Creating customer locations...');
      await tx.insert(schema.customerLocations).values([
        {
          id: ids.locationCoffeeNorth,
          customerId: ids.customerCoffee,
          name: 'North Plot - Kilema',
          gpsLatitude: -3.245,
          gpsLongitude: 37.425,
          address: 'Plot N-12, Kilema Village',
        },
        {
          id: ids.locationCoffeeSouth,
          customerId: ids.customerCoffee,
          name: 'South Plot - Machame',
          gpsLatitude: -3.289,
          gpsLongitude: 37.198,
          address: 'Plot S-8, Machame Weruweru',
        },
        {
          id: ids.locationTeaEast,
          customerId: ids.customerTea,
          name: 'Eastern Estate Block',
          gpsLatitude: -4.789,
          gpsLongitude: 38.312,
          address: 'Block E-1, Usambara Estate',
        },
      ]);

      console.log('Creating drivers and operators...');
      await tx.insert(schema.drivers).values([
        {
          id: ids.driverJackson,
          code: 'DRV-JACKSON',
          name: 'Jackson Mrema',
          licenseNumber: 'TZ-C-99821',
          contactPhone: '+255700400001',
        },
        {
          id: ids.driverAmina,
          code: 'DRV-AMINA',
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
          code: 'VEH-ISUZU-002',
          name: 'Isuzu NQR 7T',
          identifier: 'T-420-ABC',
          vehicleType: 'heavy_truck',
          fuelType: 'diesel',
          fuelConsumptionLPerKm: 0.28,
          modelYear: 2022,
        },
        {
          id: ids.vehicleTruck2,
          code: 'VEH-FUSO-001',
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
          code: 'FT-WOODCHIPS',
          name: 'Mixed Hardwood Chips',
          category: 'forestry',
          description: 'Pruned branches and sawmill residues from local forestry operations',
        },
        {
          id: ids.feedstockCoffeeHusk,
          code: 'FT-COFFEE-HUSK',
          name: 'Arabica Coffee Husk',
          category: 'agricultural',
          description: 'Coffee processing residue from wet mills',
        },
        {
          id: ids.feedstockRiceHusk,
          code: 'FT-RICE-HUSK',
          name: 'Rice Husk',
          category: 'agricultural',
          description: 'Rice milling byproduct with high silica content',
        },
        {
          id: ids.feedstockCoconut,
          code: 'FT-COCONUT',
          name: 'Coconut Shell',
          category: 'agricultural',
          description: 'Coconut processing waste shells',
        },
      ]);

      console.log('Creating feedstock deliveries...');
      await tx.insert(schema.feedstockDeliveries).values([
        {
          id: ids.deliveryFeed1,
          code: 'FD-2026-101',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          deliveryDate: demoTimestamps.firstDelivery,
          supplierId: ids.supplierKili,
          vehicleId: ids.vehicleTruck1,
          gpsLatitude: -3.3335,
          gpsLongitude: 37.3383,
          feedstockTypeId: ids.feedstockWoodchips,
          wetMassKg: 4500,
          moisturePercent: 16,
          notes: 'High quality hardwood chips from sustainable forestry',
        },
        {
          id: ids.deliveryFeed2,
          code: 'FD-2026-102',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          deliveryDate: demoTimestamps.secondDelivery,
          supplierId: ids.supplierMeru,
          vehicleId: ids.vehicleTruck2,
          gpsLatitude: -3.3335,
          gpsLongitude: 37.3383,
          feedstockTypeId: ids.feedstockCoffeeHusk,
          wetMassKg: 3200,
          moisturePercent: 12,
          notes: 'Fresh coffee husk from local processing mill',
        },
        {
          id: ids.deliveryFeed3,
          code: 'FD-2026-103',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          deliveryDate: demoTimestamps.thirdDelivery,
          supplierId: ids.supplierKili,
          vehicleId: ids.vehicleTruck1,
          gpsLatitude: -3.3335,
          gpsLongitude: 37.3383,
          feedstockTypeId: ids.feedstockWoodchips,
          wetMassKg: 5000,
          moisturePercent: 18,
          notes: 'Mixed hardwood batch with eucalyptus',
        },
      ]);

      console.log('Creating feedstocks...');
      await tx.insert(schema.feedstocks).values([
        {
          id: ids.feedstock1,
          code: 'FS-2026-101',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          feedstockDeliveryId: ids.deliveryFeed1,
          feedstockTypeId: ids.feedstockWoodchips,
          massWetKg: 4500,
          massDryKg: 3780,
          moistureContentPercent: 16,
          co2eFeedstockTons: 5.2,
          feedstockSourceRegion: 'Kilimanjaro',
          storageLocationId: ids.storageFeedMoshi,
          counterfactualCategory: 'open_decay',
          counterfactualEmissions15Tons: 1.8,
          counterfactualStorage50Tons: 1.2,
        },
        {
          id: ids.feedstock2,
          code: 'FS-2026-102',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          feedstockDeliveryId: ids.deliveryFeed2,
          feedstockTypeId: ids.feedstockCoffeeHusk,
          massWetKg: 3200,
          massDryKg: 2816,
          moistureContentPercent: 12,
          co2eFeedstockTons: 3.8,
          feedstockSourceRegion: 'Arumeru',
          storageLocationId: ids.storageFeedMoshi,
          counterfactualCategory: 'open_decay',
          counterfactualEmissions15Tons: 1.4,
          counterfactualStorage50Tons: 0.9,
        },
        {
          id: ids.feedstock3,
          code: 'FS-2026-103',
          facilityId: ids.facilityMoshi,
          status: 'complete',
          feedstockDeliveryId: ids.deliveryFeed3,
          feedstockTypeId: ids.feedstockWoodchips,
          massWetKg: 5000,
          massDryKg: 4100,
          moistureContentPercent: 18,
          co2eFeedstockTons: 5.8,
          feedstockSourceRegion: 'Kilimanjaro',
          storageLocationId: ids.storageFeedMoshi,
          counterfactualCategory: 'open_decay',
          counterfactualEmissions15Tons: 2.0,
          counterfactualStorage50Tons: 1.4,
        },
      ]);

      // ============================================================
      // PRODUCTION: Runs, Samples
      // ============================================================

      console.log('Creating production runs...');
      await tx.insert(schema.productionRuns).values([
        {
          id: ids.productionRun1,
          code: 'PR-2026-101',
          facilityId: ids.facilityMoshi,
          date: '2026-01-13',
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
          biocharOutputKg: 980,
          biocharStorageLocationId: ids.storageCharMoshi,
          feedstockStorageLocationId: ids.storageFeedMoshi,
        },
        {
          id: ids.productionRun2,
          code: 'PR-2026-102',
          facilityId: ids.facilityMoshi,
          date: '2026-01-15',
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
          biocharOutputKg: 720,
          biocharStorageLocationId: ids.storageCharMoshi,
          feedstockStorageLocationId: ids.storageFeedMoshi,
        },
        {
          id: ids.productionRun3,
          code: 'PR-2026-103',
          facilityId: ids.facilityMoshi,
          date: '2026-01-17',
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
          biocharOutputKg: 850,
          biocharStorageLocationId: ids.storageCharMoshi,
          feedstockStorageLocationId: ids.storageFeedMoshi,
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

      console.log('Creating samples...');
      await tx.insert(schema.samples).values([
        {
          id: ids.sample1,
          productionRunId: ids.productionRun1,
          samplingTime: new Date('2026-01-13T09:30:00.000Z'),
          sampleCode: 'S-2026-101',
          weightGrams: 520,
          volumeMl: 980,
          labName: 'Kibo Analytical Labs',
          labAccreditation: 'ISO 17025',
          analysisDate: '2026-01-20',
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
          samplingTime: new Date('2026-01-15T09:00:00.000Z'),
          sampleCode: 'S-2026-102',
          weightGrams: 485,
          volumeMl: 920,
          labName: 'Kibo Analytical Labs',
          labAccreditation: 'ISO 17025',
          analysisDate: '2026-01-22',
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
          samplingTime: new Date('2026-01-17T10:00:00.000Z'),
          sampleCode: 'S-2026-103',
          weightGrams: 510,
          volumeMl: 960,
          labName: 'Kibo Analytical Labs',
          labAccreditation: 'ISO 17025',
          analysisDate: '2026-01-24',
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
          code: 'BCF-STD-01',
          name: 'Standard Biochar Blend',
          biocharRatio: 0.4,
          description: 'Balanced blend for general agricultural use',
        },
        {
          id: ids.formulationPremium,
          code: 'BCF-PRM-01',
          name: 'Premium High-Carbon Blend',
          biocharRatio: 0.7,
          description: 'High biochar content for maximum carbon sequestration',
        },
        {
          id: ids.formulationOrganic,
          code: 'BCF-ORG-01',
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
          ingredientType: 'compost',
          name: 'Cow manure compost',
          ratio: 0.6,
          sortOrder: 0,
        },
        // Premium: 20% green waste compost, 10% rock dust
        {
          formulationId: ids.formulationPremium,
          ingredientType: 'compost',
          name: 'Green waste compost',
          ratio: 0.2,
          sortOrder: 0,
        },
        {
          formulationId: ids.formulationPremium,
          ingredientType: 'mineral',
          name: 'Rock dust',
          ratio: 0.1,
          sortOrder: 1,
        },
        // Organic: 40% vermicompost, 10% agricultural lime
        {
          formulationId: ids.formulationOrganic,
          ingredientType: 'compost',
          name: 'Vermicompost',
          ratio: 0.4,
          sortOrder: 0,
        },
        {
          formulationId: ids.formulationOrganic,
          ingredientType: 'lime',
          name: 'Agricultural lime',
          ratio: 0.1,
          sortOrder: 1,
        },
      ]);

      console.log('Creating biochar products...');
      await tx.insert(schema.biocharProducts).values([
        {
          id: ids.biocharProduct1,
          code: 'BP-2026-101',
          facilityId: ids.facilityMoshi,
          productionDate: new Date('2026-01-14T08:00:00.000Z'),
          status: 'ready',
          formulationId: ids.formulationStandard,
          linkedProductionRunId: ids.productionRun1,
          massKg: 2450,
          densityKgM3: 480,
          storageLocationId: ids.storageProdMoshi,
        },
        {
          id: ids.biocharProduct2,
          code: 'BP-2026-102',
          facilityId: ids.facilityMoshi,
          productionDate: new Date('2026-01-16T09:00:00.000Z'),
          status: 'ready',
          formulationId: ids.formulationPremium,
          linkedProductionRunId: ids.productionRun2,
          massKg: 1800,
          densityKgM3: 520,
          storageLocationId: ids.storageProdMoshi,
        },
        {
          id: ids.biocharProduct3,
          code: 'BP-2026-103',
          facilityId: ids.facilityMoshi,
          productionDate: new Date('2026-01-18T10:00:00.000Z'),
          status: 'ready',
          formulationId: ids.formulationOrganic,
          linkedProductionRunId: ids.productionRun3,
          massKg: 2125,
          densityKgM3: 490,
          storageLocationId: ids.storageProdMoshi,
        },
      ]);

      // ============================================================
      // LOGISTICS: Orders, Deliveries
      // ============================================================

      console.log('Creating orders...');
      await tx.insert(schema.orders).values([
        {
          id: ids.order1,
          code: 'OR-2026-101',
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
          code: 'OR-2026-102',
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
          code: 'OR-2026-103',
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
          code: 'DL-2026-101',
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
          code: 'DL-2026-102',
          facilityId: ids.facilityMoshi,
          deliveryDate: demoTimestamps.delivery2Date,
          status: 'delivered',
          orderId: ids.order2,
          customerLocationId: ids.locationTeaEast,
          biocharProductId: ids.biocharProduct2,
          storageLocationId: ids.storageProdMoshi,
          moistureContentPercent: 4.8,
          deliveredWetMassKg: 1500,
          massDryKg: 1428,
          driverId: ids.driverAmina,
          vehicleId: ids.vehicleTruck2,
        },
        {
          id: ids.delivery3,
          code: 'DL-2026-103',
          facilityId: ids.facilityMoshi,
          deliveryDate: demoTimestamps.delivery3Date,
          status: 'delivered',
          orderId: ids.order3,
          customerLocationId: ids.locationCoffeeSouth,
          biocharProductId: ids.biocharProduct3,
          storageLocationId: ids.storageProdMoshi,
          moistureContentPercent: 6.0,
          deliveredWetMassKg: 1800,
          massDryKg: 1692,
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
          code: 'AP-2026-101',
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
          co2eStoredTonnes: 3.2,
          soilTemperatureSource: 'baseline',
          soilTemperatureC: 24.5,
        },
        {
          id: ids.application2,
          code: 'AP-2026-102',
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
          co2eStoredTonnes: 2.4,
          soilTemperatureSource: 'baseline',
          soilTemperatureC: 22.8,
        },
        {
          id: ids.application3,
          code: 'AP-2026-103',
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
          co2eStoredTonnes: 2.8,
          soilTemperatureSource: 'baseline',
          soilTemperatureC: 25.2,
        },
      ]);

      console.log('Creating credit batches...');
      await tx.insert(schema.creditBatches).values([
        {
          id: ids.creditBatch1,
          code: 'CB-2026-101',
          facilityId: ids.facilityMoshi,
          status: 'pending',
          startDate: '2026-01-13',
          endDate: '2026-01-31',
          certifier: 'isometric',
          registry: 'Isometric Registry',
          weightTons: 5.01,
          bufferPoolPercent: 10,
          durabilityOption: '200_year',
          hToCorgRatio: 0.27,
          fDurableCalculated: 0.85,
          totalCo2eStoredTons: 8.4,
          totalCo2eEmissionsTons: 0.42,
          totalCo2eCounterfactualTons: 0.15,
        },
        {
          id: ids.creditBatch2,
          code: 'CB-2026-102',
          facilityId: ids.facilityMoshi,
          status: 'draft',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
          certifier: 'isometric',
          registry: 'Isometric Registry',
          durabilityOption: '1000_year',
          meanRandomReflectancePercent: 2.8,
          meanNonReactiveCarbonPercent: 68,
        },
      ]);

      console.log('Creating credit batch application links...');
      await tx.insert(schema.creditBatchApplications).values([
        {
          id: ids.creditApp1,
          creditBatchId: ids.creditBatch1,
          applicationId: ids.application1,
        },
        {
          id: ids.creditApp2,
          creditBatchId: ids.creditBatch1,
          applicationId: ids.application2,
        },
        {
          id: ids.creditApp3,
          creditBatchId: ids.creditBatch1,
          applicationId: ids.application3,
        },
      ]);
    });

    console.log('');
    console.log('Demo data seed completed successfully!');
    console.log('');
    console.log('Summary of created entities:');
    console.log('  - 3 Facilities (Moshi, Arusha, Mwanza)');
    console.log('  - 3 Reactors');
    console.log('  - 5 Storage Locations');
    console.log('  - 3 Suppliers');
    console.log('  - 3 Customers with 3 Locations');
    console.log('  - 2 Drivers, 2 Operators, 2 Vehicles');
    console.log('  - 4 Feedstock Types');
    console.log('  - 3 Feedstock Deliveries -> 3 Feedstocks');
    console.log('  - 3 Production Runs -> 3 Samples');
    console.log('  - 3 Formulations');
    console.log('  - 3 Biochar Products');
    console.log('  - 3 Orders -> 3 Deliveries');
    console.log('  - 3 Applications');
    console.log('  - 2 Credit Batches (1 with 3 linked applications)');
    console.log('');
  } catch (error) {
    console.error('Demo data seed failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seedDemoData();
