/**
 * Seed Data Constants
 *
 * Deterministic UUIDs, codes, and timestamps for demo seed data.
 * Shared between seed-data.ts and seed-logistics.ts.
 */

/** Generate deterministic UUIDs for demo data */
export const demoId = (n: number) => `de000000-0000-4000-a000-${n.toString().padStart(12, '0')}`;

export const demoCodes = {
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
  storageFeedArusha: 'SL-FEED-ARUSHA-01',
  storageCharArusha: 'SL-CHAR-ARUSHA-01',
  storageProdArusha: 'SL-PROD-ARUSHA-01',

  // Suppliers
  supplierKili: 'SUP-KILI-001',
  supplierMeru: 'SUP-MERU-001',
  supplierVictoria: 'SUP-VICTORIA-001',

  // Customers
  customerCoffee: 'CUS-COFFEE-001',
  customerTea: 'CUS-TEA-001',
  customerVegetable: 'CUS-VEG-001',
} as const;

export const ids = {
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
  storageProdArusha: demoId(1205),

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
  biocharProduct4: demoId(1953),

  // Orders
  order1: demoId(2000),
  order2: demoId(2001),
  order3: demoId(2002),
  order4: demoId(2003),
  order5: demoId(2004),

  // Deliveries (outbound)
  delivery1: demoId(2050),
  delivery2: demoId(2051),
  delivery3: demoId(2052),
  delivery4: demoId(2053),
  delivery5: demoId(2054),

  // Applications
  application1: demoId(2100),
  application2: demoId(2101),
  application3: demoId(2102),
  application4: demoId(2103),
  application5: demoId(2104),

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

export const demoTimestamps = {
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

  // Arusha orders and deliveries (overlapping timeline)
  order4Date: new Date('2026-01-22T14:00:00.000Z'),
  order5Date: new Date('2026-01-23T09:30:00.000Z'),
  delivery4Date: new Date('2026-01-26T07:30:00.000Z'),
  delivery5Date: new Date('2026-01-27T08:00:00.000Z'),

  // Week 4: Applications and credits
  application1Date: new Date('2026-01-27T11:00:00.000Z'),
  application2Date: new Date('2026-01-28T10:30:00.000Z'),
  application3Date: new Date('2026-01-29T09:00:00.000Z'),
  application4Date: new Date('2026-01-30T07:00:00.000Z'),
  application5Date: new Date('2026-02-01T10:00:00.000Z'),
  creditBatch1Start: new Date('2026-01-13T00:00:00.000Z'),
  creditBatch1End: new Date('2026-01-31T23:59:59.000Z'),
  creditBatch2Start: new Date('2026-02-01T00:00:00.000Z'),
  creditBatch2End: new Date('2026-02-28T23:59:59.000Z'),
} as const;
