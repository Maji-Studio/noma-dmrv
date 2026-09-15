import { grams, kilograms, rational, round } from '../lib/output-stock';
import { KG_PER_TONNE } from '../lib/calculations/unit-conversions';
import { DEC_ORG_ID } from './org-defaults';

// Helper to generate deterministic UUIDs for demo data
export const demoId = (n: number) => `de000000-0000-4000-a000-${n.toString().padStart(12, '0')}`;

export const withBootstrapOrg = <T extends { organizationId: string }>(
  rows: Omit<T, 'organizationId'>[],
): T[] =>
  rows.map((row) => ({ ...row, organizationId: DEC_ORG_ID }) as T);

// Demo data codes
export const demoCodes = {
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

export const demoProductionRunFeedstockWetMassKg = {
  run1: 3500,
  run2: 2500,
  run3: 3000,
} as const;

// Demo entity IDs
export const ids = {
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
  biocharProductSourceAllocation1: demoId(1953),
  biocharProductSourceAllocation2: demoId(1954),
  biocharProductSourceAllocation3: demoId(1955),
  biocharProductSourceAllocation4: demoId(1956),
  biocharProductSourceAllocation5: demoId(1957),
  biocharProductSourceAllocation6: demoId(1958),
  biocharProductSourceAllocation7: demoId(1959),
  biocharProductSourceAllocation8: demoId(1960),
  biocharProductSourceAllocation9: demoId(1961),

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
export const demoTimestamps = {
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

export const curatedProductSourceAllocations = [
  {
    id: ids.biocharProductSourceAllocation1,
    biocharProductId: ids.biocharProduct1,
    productionRunId: ids.productionRun1,
    sourceStorageLocationId: ids.storageCharMoshi,
    allocatedWetMassKg: 376.627,
    allocatedDryMassKg: 369.094,
  },
  {
    id: ids.biocharProductSourceAllocation2,
    biocharProductId: ids.biocharProduct1,
    productionRunId: ids.productionRun2,
    sourceStorageLocationId: ids.storageCharMoshi,
    allocatedWetMassKg: 276.706,
    allocatedDryMassKg: 271.172,
  },
  {
    id: ids.biocharProductSourceAllocation3,
    biocharProductId: ids.biocharProduct1,
    productionRunId: ids.productionRun3,
    sourceStorageLocationId: ids.storageCharMoshi,
    allocatedWetMassKg: 326.667,
    allocatedDryMassKg: 320.134,
  },
  {
    id: ids.biocharProductSourceAllocation4,
    biocharProductId: ids.biocharProduct2,
    productionRunId: ids.productionRun1,
    sourceStorageLocationId: ids.storageCharMoshi,
    allocatedWetMassKg: 269.02,
    allocatedDryMassKg: 263.64,
  },
  {
    id: ids.biocharProductSourceAllocation5,
    biocharProductId: ids.biocharProduct2,
    productionRunId: ids.productionRun2,
    sourceStorageLocationId: ids.storageCharMoshi,
    allocatedWetMassKg: 197.647,
    allocatedDryMassKg: 193.694,
  },
  {
    id: ids.biocharProductSourceAllocation6,
    biocharProductId: ids.biocharProduct2,
    productionRunId: ids.productionRun3,
    sourceStorageLocationId: ids.storageCharMoshi,
    allocatedWetMassKg: 233.333,
    allocatedDryMassKg: 228.666,
  },
  {
    id: ids.biocharProductSourceAllocation7,
    biocharProductId: ids.biocharProduct3,
    productionRunId: ids.productionRun1,
    sourceStorageLocationId: ids.storageCharMoshi,
    allocatedWetMassKg: 307.451,
    allocatedDryMassKg: 301.302,
  },
  {
    id: ids.biocharProductSourceAllocation8,
    biocharProductId: ids.biocharProduct3,
    productionRunId: ids.productionRun2,
    sourceStorageLocationId: ids.storageCharMoshi,
    allocatedWetMassKg: 225.882,
    allocatedDryMassKg: 221.364,
  },
  {
    id: ids.biocharProductSourceAllocation9,
    biocharProductId: ids.biocharProduct3,
    productionRunId: ids.productionRun3,
    sourceStorageLocationId: ids.storageCharMoshi,
    allocatedWetMassKg: 266.667,
    allocatedDryMassKg: 261.334,
  },
] as const;

const CURATED_MASS_RECONCILIATION_ERROR =
  'Curated biochar chain masses do not reconcile';

function deriveCuratedBiocharChainMasses(input: {
  productId: string;
  productWetKg: number;
  biocharRatio: number;
  orderWetKg: number;
  deliveredWetKg: number;
  appliedWetTons: number;
}) {
  const sourceDryKg = Number(kilograms(curatedProductSourceAllocations
    .filter((allocation) => allocation.biocharProductId === input.productId)
    .reduce((total, allocation) => total + grams(allocation.allocatedDryMassKg), BigInt(0))));
  const proportionalDryKg = (dryKg: number, wetKg: number, requestedWetKg: number) =>
    Number(kilograms(round(rational(grams(dryKg) * grams(requestedWetKg), grams(wetKg)))));
  const deliveredDryKg = proportionalDryKg(sourceDryKg, input.productWetKg, input.deliveredWetKg);
  const appliedWetKg = input.appliedWetTons * KG_PER_TONNE;
  const appliedDryKg = proportionalDryKg(deliveredDryKg, input.deliveredWetKg, appliedWetKg);
  if (
    deliveredDryKg == null ||
    appliedDryKg == null ||
    deliveredDryKg > sourceDryKg ||
    appliedDryKg > deliveredDryKg
  ) {
    throw new Error(CURATED_MASS_RECONCILIATION_ERROR);
  }

  return {
    ...input,
    sourceDryKg,
    deliveredDryKg,
    appliedDryTons: appliedDryKg / KG_PER_TONNE,
  };
}

/**
 * Keep the curated product chain physically reconcilable from the biochar bin
 * through certification. Product wet mass is the finished blend; the source
 * allocation is only its biochar share, distributed mass-weighted across the
 * production runs commingled in the source bin. Application wet mass is the applied finished blend; its dry mass tracks
 * only the proportional biochar share, excluding amendment solids.
 */
export const curatedBiocharChainMasses = {
  product1: deriveCuratedBiocharChainMasses({
    productId: ids.biocharProduct1,
    productWetKg: 2450,
    biocharRatio: 0.4,
    orderWetKg: 2000,
    deliveredWetKg: 2000,
    appliedWetTons: 0.756,
  }),
  product2: deriveCuratedBiocharChainMasses({
    productId: ids.biocharProduct2,
    productWetKg: 1000,
    biocharRatio: 0.7,
    orderWetKg: 900,
    deliveredWetKg: 900,
    appliedWetTons: 0.595,
  }),
  product3: deriveCuratedBiocharChainMasses({
    productId: ids.biocharProduct3,
    productWetKg: 1600,
    biocharRatio: 0.5,
    orderWetKg: 1400,
    deliveredWetKg: 1400,
    appliedWetTons: 0.65,
  }),
} as const;

