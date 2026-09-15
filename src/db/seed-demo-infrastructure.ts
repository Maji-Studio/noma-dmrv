import type { DbTransaction } from '.';
import * as schema from './schema';
import { DEC_ORG_ID } from './org-defaults';
import { demoCodes, ids, demoTimestamps, withBootstrapOrg } from './seed-demo-facts';
import { STARTER_FEEDSTOCK_TYPES } from './org-defaults';

export async function seedDemoInfrastructure(tx: DbTransaction) {
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

}
