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
import { demoCodes, ids, demoTimestamps } from './seed-constants';
import { seedLogistics } from './seed-logistics';

config({ path: '.env.local' });

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
        {
          id: ids.storageProdArusha,
          code: 'SL-PROD-ARUSHA-01',
          name: 'Arusha Product Dispatch',
          type: 'product_bin',
          capacityKg: 15000,
          latitude: -3.3866,
          longitude: 36.6837,
          storageMethod: 'covered_bin',
          storageDescription: 'Covered dispatch area with weigh station',
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
        {
          id: ids.biocharProduct4,
          code: 'BP-2026-104',
          facilityId: ids.facilityArusha,
          productionDate: new Date('2026-01-19T08:30:00.000Z'),
          status: 'ready',
          formulationId: ids.formulationStandard,
          massKg: 1650,
          densityKgM3: 510,
          storageLocationId: ids.storageProdArusha,
        },
      ]);

      // ============================================================
      // LOGISTICS, APPLICATIONS & CREDITS
      // ============================================================

      await seedLogistics(tx);
    });

    console.log('');
    console.log('Demo data seed completed successfully!');
    console.log('');
    console.log('Summary of created entities:');
    console.log('  - 3 Facilities (Moshi, Arusha, Mwanza)');
    console.log('  - 3 Reactors');
    console.log('  - 6 Storage Locations');
    console.log('  - 3 Suppliers');
    console.log('  - 3 Customers with 3 Locations');
    console.log('  - 2 Drivers, 2 Operators, 2 Vehicles');
    console.log('  - 4 Feedstock Types');
    console.log('  - 3 Feedstock Deliveries -> 3 Feedstocks');
    console.log('  - 3 Production Runs -> 3 Samples');
    console.log('  - 3 Formulations');
    console.log('  - 4 Biochar Products');
    console.log('  - 5 Orders -> 5 Deliveries');
    console.log('  - 5 Applications (3 Moshi, 2 Arusha)');
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
