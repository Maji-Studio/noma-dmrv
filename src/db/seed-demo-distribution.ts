import { buildDemoOutputStock, demoIngredientRecipes, seedDemoSavedOutputAllocations } from './seed-demo-output-stock';
import type { DbTransaction } from '.';
import * as schema from './schema';
import { DEC_ORG_ID } from './org-defaults';
import { ids, demoTimestamps, withBootstrapOrg, curatedProductSourceAllocations, curatedBiocharChainMasses } from './seed-demo-facts';

export async function seedDemoDistribution(tx: DbTransaction) {
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

  // Stable line IDs bind the immutable ingredient facts to their recipe.
  await tx.insert(schema.formulationIngredients).values(demoIngredientRecipes.map(recipe => ({ id: recipe.id, formulationId: recipe.formulationId, feedstockTypeId: recipe.feedstockTypeId, ratio: recipe.ratio, sortOrder: recipe.sortOrder, organizationId: DEC_ORG_ID })));
  const outputFacts = buildDemoOutputStock();

  console.log('Creating biochar products...');
  const products = await tx.insert(schema.biocharProducts).values(withBootstrapOrg<typeof schema.biocharProducts.$inferInsert>([
    {
      id: ids.biocharProduct1,
      composition: outputFacts[0].composition,
      code: 'BP-26-001',
      facilityId: ids.facilityMoshi,
      productionDate: demoTimestamps.run3End,
      placedAt: demoTimestamps.run3End.toISOString().slice(0, 10),
      status: 'ready',
      formulationId: ids.formulationStandard,
      biocharRatio: curatedBiocharChainMasses.product1.biocharRatio,
      sourceBiocharStorageLocationId: ids.storageCharMoshi,
      linkedProductionRunId: null,
      massKg: curatedBiocharChainMasses.product1.productWetKg,
      moistureContentPercent: 5.5,
      densityKgM3: 480,
      storageLocationId: ids.storageProdMoshi,
      expiresAt: new Date('2027-05-17T15:00:00.000Z'),
    },
    {
      id: ids.biocharProduct2,
      composition: outputFacts[1].composition,
      code: 'BP-26-002',
      facilityId: ids.facilityMoshi,
      productionDate: demoTimestamps.run3End,
      placedAt: demoTimestamps.run3End.toISOString().slice(0, 10),
      status: 'ready',
      formulationId: ids.formulationPremium,
      biocharRatio: curatedBiocharChainMasses.product2.biocharRatio,
      sourceBiocharStorageLocationId: ids.storageCharMoshi,
      linkedProductionRunId: null,
      massKg: curatedBiocharChainMasses.product2.productWetKg,
      moistureContentPercent: 4.8,
      densityKgM3: 520,
      storageLocationId: ids.storageProdPremium,
      expiresAt: new Date('2027-05-17T15:00:00.000Z'),
    },
    {
      id: ids.biocharProduct3,
      composition: outputFacts[2].composition,
      code: 'BP-26-003',
      facilityId: ids.facilityMoshi,
      productionDate: demoTimestamps.run3End,
      placedAt: demoTimestamps.run3End.toISOString().slice(0, 10),
      status: 'ready',
      formulationId: ids.formulationOrganic,
      biocharRatio: curatedBiocharChainMasses.product3.biocharRatio,
      sourceBiocharStorageLocationId: ids.storageCharMoshi,
      linkedProductionRunId: null,
      massKg: curatedBiocharChainMasses.product3.productWetKg,
      moistureContentPercent: 6.0,
      densityKgM3: 490,
      storageLocationId: ids.storageProdOrganic,
      expiresAt: new Date('2027-05-17T15:00:00.000Z'),
    },
  ])).returning({ id: schema.biocharProducts.id, postingSequence: schema.biocharProducts.stockPostingSequence });

  console.log('Creating biochar product source allocations...');
  await tx.insert(schema.biocharProductSourceAllocations).values(
    withBootstrapOrg<typeof schema.biocharProductSourceAllocations.$inferInsert>(
      [...curatedProductSourceAllocations],
    ),
  );
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
      loadMassKg: curatedBiocharChainMasses.product2.deliveredWetKg,
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
      loadMassKg: curatedBiocharChainMasses.product3.deliveredWetKg,
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
      formulationId: ids.formulationStandard,
      quantityKg: curatedBiocharChainMasses.product1.orderWetKg,
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
      formulationId: ids.formulationPremium,
      quantityKg: curatedBiocharChainMasses.product2.orderWetKg,
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
      formulationId: ids.formulationOrganic,
      quantityKg: curatedBiocharChainMasses.product3.orderWetKg,
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
      deliveredWetMassKg:
        curatedBiocharChainMasses.product1.deliveredWetKg,
      massDryKg: curatedBiocharChainMasses.product1.deliveredDryKg,
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
      deliveredWetMassKg:
        curatedBiocharChainMasses.product2.deliveredWetKg,
      massDryKg: curatedBiocharChainMasses.product2.deliveredDryKg,
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
      deliveredWetMassKg:
        curatedBiocharChainMasses.product3.deliveredWetKg,
      massDryKg: curatedBiocharChainMasses.product3.deliveredDryKg,
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
      biocharAppliedTons:
        curatedBiocharChainMasses.product1.appliedWetTons,
      biocharAppliedDryTons:
        curatedBiocharChainMasses.product1.appliedDryTons,
      gpsLatitude: -3.245,
      gpsLongitude: 37.425,
      fieldSizeHa: 1.2,
      cropType: 'Coffee',
      applicationMethodType: 'mechanical',
      fieldIdentifier: 'KILEMA-N-12',
      evidenceMethod: 'boundary',
      gisBoundary: {
        version: 1,
        source: 'paste',
        fileName: null,
        capturedAt: '2026-06-15T08:00:00.000Z',
        collection: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {
              name: 'Kilema north',
              description: 'Coffee field application area',
              reference_id: 'TZ-KLM-KILEMA-N12-2026',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [37.423, -3.247],
                [37.427, -3.247],
                [37.427, -3.243],
                [37.423, -3.243],
                [37.423, -3.247],
              ]],
            },
          }],
          bbox: [37.423, -3.247, 37.427, -3.243],
        },
        stats: {
          features: 1,
          vertices: 5,
          areaHectares: 19.75,
          bbox: [37.423, -3.247, 37.427, -3.243],
          center: [37.425, -3.245],
        },
        notes: [],
      },
      soilTemperatureSource: 'baseline',
      soilTemperatureC: 24.5,
    },
    {
      id: ids.application2,
      code: 'AP-26-002',
      applicationDate: demoTimestamps.application2Date,
      status: 'applied',
      deliveryId: ids.delivery2,
      biocharAppliedTons:
        curatedBiocharChainMasses.product2.appliedWetTons,
      biocharAppliedDryTons:
        curatedBiocharChainMasses.product2.appliedDryTons,
      gpsLatitude: -4.789,
      gpsLongitude: 38.312,
      fieldSizeHa: 0.8,
      cropType: 'Tea',
      applicationMethodType: 'mechanical',
      fieldIdentifier: 'USAMBARA-E-1',
      evidenceMethod: 'boundary',
      gisBoundary: {
        version: 1,
        source: 'paste',
        fileName: null,
        capturedAt: '2026-06-18T08:00:00.000Z',
        collection: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {
              name: 'Usambara east',
              description: 'Tea field application area',
              reference_id: 'TZ-TGA-LUSHOTO-E1-2026',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [38.31, -4.791],
                [38.314, -4.791],
                [38.314, -4.787],
                [38.31, -4.787],
                [38.31, -4.791],
              ]],
            },
          }],
          bbox: [38.31, -4.791, 38.314, -4.787],
        },
        stats: {
          features: 1,
          vertices: 5,
          areaHectares: 19.72,
          bbox: [38.31, -4.791, 38.314, -4.787],
          center: [38.312, -4.789],
        },
        notes: [],
      },
      soilTemperatureSource: 'baseline',
      soilTemperatureC: 22.8,
    },
    {
      id: ids.application3,
      code: 'AP-26-003',
      applicationDate: demoTimestamps.application3Date,
      status: 'applied',
      deliveryId: ids.delivery3,
      biocharAppliedTons:
        curatedBiocharChainMasses.product3.appliedWetTons,
      biocharAppliedDryTons:
        curatedBiocharChainMasses.product3.appliedDryTons,
      gpsLatitude: -3.289,
      gpsLongitude: 37.198,
      fieldSizeHa: 1.0,
      cropType: 'Coffee',
      applicationMethodType: 'manual',
      fieldIdentifier: 'MACHAME-S-8',
      evidenceMethod: 'boundary',
      gisBoundary: {
        version: 1,
        source: 'paste',
        fileName: null,
        capturedAt: '2026-06-22T08:00:00.000Z',
        collection: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {
              name: 'Machame south',
              description: 'Coffee field application area',
              reference_id: 'TZ-KLM-MACHAME-S8-2026',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [37.196, -3.291],
                [37.2, -3.291],
                [37.2, -3.287],
                [37.196, -3.287],
                [37.196, -3.291],
              ]],
            },
          }],
          bbox: [37.196, -3.291, 37.2, -3.287],
        },
        stats: {
          features: 1,
          vertices: 5,
          areaHectares: 19.75,
          bbox: [37.196, -3.291, 37.2, -3.287],
          center: [37.198, -3.289],
        },
        notes: [],
      },
      soilTemperatureSource: 'baseline',
      soilTemperatureC: 25.2,
    },
  ]));

    await seedDemoSavedOutputAllocations(tx, new Map(products.map(p => [p.id, p.postingSequence])));
}
