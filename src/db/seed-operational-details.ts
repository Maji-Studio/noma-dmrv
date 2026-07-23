import type { DbTransaction } from '.';
import * as schema from './schema';

type OperationalSeedIds = {
  facilityMoshi: string;
  supplierKili: string;
  supplierMeru: string;
  supplierVictoria: string;
  supplierLocationKiliMachame: string;
  supplierLocationKiliSawmill: string;
  supplierLocationMeruKilema: string;
  supplierLocationVictoriaTengeru: string;
  productionRun1: string;
  productionRun2: string;
  productionRun3: string;
  productionSample1: string;
  productionSample2: string;
  productionSample3: string;
  productionSample4: string;
  productionSample5: string;
  productionSample6: string;
  productionSample7: string;
  productionSample8: string;
  productionSample9: string;
  incident1: string;
  incident2: string;
  operatorNeema: string;
  operatorJuma: string;
  reactorMoshi1: string;
  reactorMoshi2: string;
  storageFeedMoshi: string;
  storageCharMoshi: string;
  storageProdMoshi: string;
  feedstock1: string;
  biocharProduct1: string;
  binMovement1: string;
  binMovement2: string;
  binMovement3: string;
  stockpileEvent1: string;
  stockpileEvent2: string;
  powerEvidence1: string;
};

type OperationalSeedTimestamps = {
  run1Start: Date;
  run2Start: Date;
  run3Start: Date;
};

const hoursAfter = (date: Date, hours: number) =>
  new Date(date.getTime() + hours * 60 * 60 * 1000);

export async function seedOperationalDetails(
  tx: DbTransaction,
  organizationId: string,
  ids: OperationalSeedIds,
  timestamps: OperationalSeedTimestamps,
) {
  console.log('Creating supplier locations...');
  await tx.insert(schema.supplierLocations).values([
    {
      organizationId,
      id: ids.supplierLocationKiliMachame,
      supplierId: ids.supplierKili,
      name: 'Machame Collection Yard',
      country: 'Tanzania',
      stateRegion: 'Kilimanjaro',
      city: 'Machame',
      gpsLatitude: -3.286,
      gpsLongitude: 37.157,
      address: 'Machame Road, Hai District',
      distanceFromFacilityKm: 34,
      distanceSource: 'document',
      isDefault: true,
    },
    {
      organizationId,
      id: ids.supplierLocationKiliSawmill,
      supplierId: ids.supplierKili,
      name: 'Rundugai Sawmill Residue Point',
      country: 'Tanzania',
      stateRegion: 'Kilimanjaro',
      city: 'Rundugai',
      gpsLatitude: -3.448,
      gpsLongitude: 37.173,
      address: 'Rundugai Village Forestry Yard',
      distanceFromFacilityKm: 41,
      distanceSource: 'document',
    },
    {
      organizationId,
      id: ids.supplierLocationMeruKilema,
      supplierId: ids.supplierMeru,
      name: 'Kilema Coffee Mill',
      country: 'Tanzania',
      stateRegion: 'Kilimanjaro',
      city: 'Kilema',
      gpsLatitude: -3.244,
      gpsLongitude: 37.421,
      address: 'Kilema Road, Moshi Rural District',
      distanceFromFacilityKm: 29,
      distanceSource: 'document',
      isDefault: true,
    },
    {
      organizationId,
      id: ids.supplierLocationVictoriaTengeru,
      supplierId: ids.supplierVictoria,
      name: 'Tengeru Materials Depot',
      country: 'Tanzania',
      stateRegion: 'Arusha',
      city: 'Tengeru',
      gpsLatitude: -3.374,
      gpsLongitude: 36.803,
      address: 'Old Moshi Road, Tengeru',
      distanceFromFacilityKm: 92,
      distanceSource: 'document',
      isDefault: true,
    },
  ]);

  console.log('Creating in-process production samples...');
  await tx.insert(schema.productionSamples).values([
    {
      organizationId,
      id: ids.productionSample1,
      productionRunId: ids.productionRun1,
      sampleCode: 'PS-26-001-A',
      timestamp: hoursAfter(timestamps.run1Start, 2),
      weightGrams: 245,
      volumeMl: 510,
      temperatureC: 472,
      moistureContentPercent: 6.8,
      fixedCarbonPercent: 71.2,
      volatileMatterPercent: 18.6,
      ashContentPercent: 10.2,
      sampledById: ids.operatorNeema,
      notes: 'Two-hour field check; colour and fracture consistent with target.',
    },
    {
      organizationId,
      id: ids.productionSample2,
      productionRunId: ids.productionRun1,
      sampleCode: 'PS-26-001-B',
      timestamp: hoursAfter(timestamps.run1Start, 4),
      weightGrams: 252,
      volumeMl: 500,
      temperatureC: 538,
      moistureContentPercent: 5.3,
      fixedCarbonPercent: 74.5,
      volatileMatterPercent: 15.7,
      ashContentPercent: 9.8,
      sampledById: ids.operatorNeema,
      notes: 'Mid-run sample after feed-rate adjustment.',
    },
    {
      organizationId,
      id: ids.productionSample3,
      productionRunId: ids.productionRun1,
      sampleCode: 'PS-26-001-C',
      timestamp: hoursAfter(timestamps.run1Start, 6),
      weightGrams: 248,
      volumeMl: 485,
      temperatureC: 559,
      moistureContentPercent: 4.6,
      fixedCarbonPercent: 76.1,
      volatileMatterPercent: 14.4,
      ashContentPercent: 9.5,
      sampledById: ids.operatorNeema,
      notes: 'Final steady-state check before controlled cool-down.',
    },
    {
      organizationId,
      id: ids.productionSample4,
      productionRunId: ids.productionRun2,
      sampleCode: 'PS-26-002-A',
      timestamp: hoursAfter(timestamps.run2Start, 2),
      weightGrams: 230,
      volumeMl: 480,
      temperatureC: 458,
      moistureContentPercent: 5.9,
      fixedCarbonPercent: 73.4,
      volatileMatterPercent: 17.8,
      ashContentPercent: 8.8,
      sampledById: ids.operatorJuma,
      notes: 'Coffee-husk char developing evenly across the discharge.',
    },
    {
      organizationId,
      id: ids.productionSample5,
      productionRunId: ids.productionRun2,
      sampleCode: 'PS-26-002-B',
      timestamp: hoursAfter(timestamps.run2Start, 4),
      weightGrams: 238,
      volumeMl: 470,
      temperatureC: 521,
      moistureContentPercent: 4.8,
      fixedCarbonPercent: 76.8,
      volatileMatterPercent: 14.9,
      ashContentPercent: 8.3,
      sampledById: ids.operatorJuma,
      notes: 'Stable sample following hopper bridge clearance.',
    },
    {
      organizationId,
      id: ids.productionSample6,
      productionRunId: ids.productionRun2,
      sampleCode: 'PS-26-002-C',
      timestamp: hoursAfter(timestamps.run2Start, 6),
      weightGrams: 236,
      volumeMl: 465,
      temperatureC: 543,
      moistureContentPercent: 4.4,
      fixedCarbonPercent: 78.0,
      volatileMatterPercent: 13.8,
      ashContentPercent: 8.2,
      sampledById: ids.operatorJuma,
      notes: 'End-of-run field sample retained for shift handover.',
    },
    {
      organizationId,
      id: ids.productionSample7,
      productionRunId: ids.productionRun3,
      sampleCode: 'PS-26-003-A',
      timestamp: hoursAfter(timestamps.run3Start, 2),
      weightGrams: 260,
      volumeMl: 530,
      temperatureC: 431,
      moistureContentPercent: 7.1,
      fixedCarbonPercent: 70.6,
      volatileMatterPercent: 18.7,
      ashContentPercent: 10.7,
      sampledById: ids.operatorNeema,
      notes: 'Batch-kiln sample from the first discharge zone.',
    },
    {
      organizationId,
      id: ids.productionSample8,
      productionRunId: ids.productionRun3,
      sampleCode: 'PS-26-003-B',
      timestamp: hoursAfter(timestamps.run3Start, 4),
      weightGrams: 265,
      volumeMl: 515,
      temperatureC: 493,
      moistureContentPercent: 5.8,
      fixedCarbonPercent: 73.7,
      volatileMatterPercent: 15.9,
      ashContentPercent: 10.4,
      sampledById: ids.operatorNeema,
      notes: 'Centre-zone sample; no visible uncharred inclusions.',
    },
    {
      organizationId,
      id: ids.productionSample9,
      productionRunId: ids.productionRun3,
      sampleCode: 'PS-26-003-C',
      timestamp: hoursAfter(timestamps.run3Start, 6),
      weightGrams: 258,
      volumeMl: 495,
      temperatureC: 519,
      moistureContentPercent: 5.0,
      fixedCarbonPercent: 75.2,
      volatileMatterPercent: 14.6,
      ashContentPercent: 10.2,
      sampledById: ids.operatorNeema,
      notes: 'Final composite field sample before quench.',
    },
  ]);

  console.log('Creating production incident history...');
  await tx.insert(schema.incidentReports).values([
    {
      organizationId,
      id: ids.incident1,
      productionRunId: ids.productionRun1,
      incidentTime: hoursAfter(timestamps.run1Start, 3.5),
      incidentDate: hoursAfter(timestamps.run1Start, 3.5),
      operatorId: ids.operatorNeema,
      reactorId: ids.reactorMoshi1,
      description: 'Feed screw torque briefly exceeded the operating band.',
      severity: 'low',
      correctiveActions:
        'Reduced the feed rate, inspected the hopper throat, and restored the setpoint after five minutes.',
      notes: 'No interruption to the monitored temperature window.',
    },
    {
      organizationId,
      id: ids.incident2,
      productionRunId: ids.productionRun2,
      incidentTime: hoursAfter(timestamps.run2Start, 3.25),
      incidentDate: hoursAfter(timestamps.run2Start, 3.25),
      operatorId: ids.operatorJuma,
      reactorId: ids.reactorMoshi1,
      description: 'Coffee husk bridged above the metering hopper.',
      severity: 'medium',
      correctiveActions:
        'Paused feeding, cleared the bridge using the approved isolation procedure, and documented the restart checks.',
      notes: 'Residence time remained within the validated operating range.',
    },
  ]);

  console.log('Creating storage reconciliation history...');
  await tx.insert(schema.binMovements).values([
    {
      organizationId,
      id: ids.binMovement1,
      storageLocationId: ids.storageFeedMoshi,
      lane: 'feedstock',
      movementType: 'loss',
      massDeltaKg: -42,
      reason: 'Documented dry-mass loss from screening fines during intake handling.',
    },
    {
      organizationId,
      id: ids.binMovement2,
      storageLocationId: ids.storageCharMoshi,
      lane: 'biochar',
      movementType: 'loss',
      massDeltaKg: -18,
      reason: 'Curing-pad sweepings isolated and written off after the weekly stock take.',
    },
    {
      organizationId,
      id: ids.binMovement3,
      storageLocationId: ids.storageProdMoshi,
      lane: 'product',
      movementType: 'adjustment',
      massDeltaKg: 25,
      reason: 'Bag count reconciled to the calibrated platform-scale total.',
      countedMassKg: 475,
      derivedMassKgAtTime: 450,
    },
  ]);

  console.log('Creating stockpile and power-procurement evidence...');
  await tx.insert(schema.stockpileEvents).values([
    {
      organizationId,
      id: ids.stockpileEvent1,
      facilityId: ids.facilityMoshi,
      materialType: 'feedstock',
      materialId: ids.feedstock1,
      startedAt: new Date('2026-05-08T12:00:00.000Z'),
      endedAt: new Date('2026-05-13T05:30:00.000Z'),
      lastControlAt: new Date('2026-05-12T14:00:00.000Z'),
      riskLevel: 'low',
      mitigationNotes:
        'Covered bay, raised floor, and daily moisture inspection recorded on the shift sheet.',
      documentRef: 'SPC-MOSHI-2026-001',
    },
    {
      organizationId,
      id: ids.stockpileEvent2,
      facilityId: ids.facilityMoshi,
      materialType: 'biochar',
      materialId: ids.biocharProduct1,
      startedAt: new Date('2026-05-14T08:00:00.000Z'),
      endedAt: new Date('2026-05-21T06:00:00.000Z'),
      lastControlAt: new Date('2026-05-20T15:30:00.000Z'),
      riskLevel: 'low',
      mitigationNotes:
        'Bagged product stored under cover on pallets with lot labels facing the inspection aisle.',
      documentRef: 'SPC-MOSHI-2026-002',
    },
  ]);
  await tx.insert(schema.powerProcurementEvidence).values({
    organizationId,
    id: ids.powerEvidence1,
    facilityId: ids.facilityMoshi,
    periodStart: '2026-05-01',
    periodEnd: '2026-05-31',
    contractType: 'grid',
    gridRegion: 'TANESCO Northern Zone',
    matchingType: 'none',
    documentRef: 'TANESCO-MOSHI-2026-05',
    notes:
      'Monthly utility statement retained; production runs conservatively use the grid-average EC1 category.',
  });
}
