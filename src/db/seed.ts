import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from 'dotenv';
import { Pool } from 'pg';

import * as schema from './schema';

config({ path: '.env.local' });

const makeId = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`;

const seedCodes = {
  facility: 'FAC-NOMA-001',
} as const;

const ids = {
  // Auth + legacy template entities
  project: makeId(1),
  projectMemberAdmin: makeId(2),
  projectMemberOperator: makeId(3),
  itemIntake: makeId(4),
  itemCredit: makeId(5),

  // Core entities
  facility: makeId(100),
  reactor: makeId(101),
  storageFeedstock: makeId(102),
  storageBiochar: makeId(103),
  storageProduct: makeId(104),

  supplier: makeId(120),
  customer: makeId(121),
  customerLocation: makeId(122),
  driver: makeId(123),
  operator: makeId(124),
  vehicle: makeId(125),

  feedstockTypeWoodchips: makeId(140),
  feedstockTypeCoffeeHusk: makeId(141),
  feedstockDelivery: makeId(142),
  feedstock: makeId(143),

  productionRun: makeId(160),
  productionReading1: makeId(161),
  productionReading2: makeId(162),
  sample: makeId(163),
  incident: makeId(164),
  productionFeedstockLink: makeId(165),

  formulation: makeId(180),
  biocharProduct: makeId(181),

  order: makeId(200),
  delivery: makeId(201),
  transportFeedstock: makeId(202),
  transportDelivery: makeId(203),

  application: makeId(220),
  soilTemp1: makeId(221),
  soilTemp2: makeId(222),

  creditBatch: makeId(240),
  creditBatchApplication: makeId(241),

  feedstockDoc: makeId(260),
  feedstockDeliveryDoc: makeId(261),
  productionRunDoc: makeId(262),
  sampleDoc: makeId(263),
  incidentDoc: makeId(264),
  biocharProductDoc: makeId(265),
  deliveryDoc: makeId(266),
  transportDoc: makeId(267),
  applicationDoc: makeId(268),
  creditBatchDoc: makeId(269),

  feedstockAssessment: makeId(280),
  custodyHandoff: makeId(281),
  materialityAssessment: makeId(282),

  emissionFactorDiesel: makeId(300),
  emissionFactorElectricity: makeId(301),

  certifierProject: makeId(320),
  certifierSource: makeId(321),
  submissionMonitoring: makeId(322),
  submissionProductionBatch: makeId(323),
  submissionStorageLocation: makeId(324),
  submissionBiocharApplication: makeId(325),
  submissionRemoval: makeId(326),
  submissionGhgStatement: makeId(327),
  certifierDocumentUpload: makeId(328),
  certifierSyncEvent: makeId(329),
} as const;

const userIds = {
  admin: 'seed-admin-user',
  operator: 'seed-operator-user',
  viewer: 'seed-viewer-user',
} as const;

const seedEmails = {
  admin: process.env.ADMIN_EMAIL || 'seed.admin@noma.local',
  operator: 'seed.operator@noma.local',
  viewer: 'seed.viewer@noma.local',
} as const;

const timestamps = {
  createdEarly: new Date('2026-01-10T07:00:00.000Z'),
  deliveryTime: new Date('2026-01-12T08:30:00.000Z'),
  runStart: new Date('2026-01-13T06:00:00.000Z'),
  runEnd: new Date('2026-01-13T12:30:00.000Z'),
  incidentTime: new Date('2026-01-13T09:10:00.000Z'),
  sampleTime: new Date('2026-01-13T09:45:00.000Z'),
  orderTime: new Date('2026-01-14T08:00:00.000Z'),
  deliveryOutTime: new Date('2026-01-15T09:30:00.000Z'),
  applicationTime: new Date('2026-01-16T11:00:00.000Z'),
  analysisTime: new Date('2026-01-18T10:00:00.000Z'),
  submissionTime: new Date('2026-01-19T14:00:00.000Z'),
  verificationExpiry: new Date('2026-02-15T00:00:00.000Z'),
  sessionExpiry: new Date('2026-03-01T00:00:00.000Z'),
} as const;

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool, { schema });

  try {
    console.log('Starting comprehensive seed...');

    const [existingFacility] = await db
      .select({ id: schema.facilities.id })
      .from(schema.facilities)
      .where(eq(schema.facilities.code, seedCodes.facility))
      .limit(1);

    if (existingFacility) {
      console.log(`Seed data already present (facility ${seedCodes.facility}). Skipping.`);
      return;
    }

    await db.transaction(async (tx) => {
      // ------------------------------------------------------------
      // Auth + legacy template entities
      // ------------------------------------------------------------
      await tx
        .insert(schema.users)
        .values([
          {
            id: userIds.admin,
            email: seedEmails.admin,
            name: 'Seed Admin',
            role: 'admin',
            emailVerified: true,
          },
          {
            id: userIds.operator,
            email: seedEmails.operator,
            name: 'Seed Operator',
            role: 'user',
            emailVerified: true,
          },
          {
            id: userIds.viewer,
            email: seedEmails.viewer,
            name: 'Seed Viewer',
            role: 'user',
            emailVerified: true,
          },
        ])
        .onConflictDoNothing();

      const seededUsers = await tx
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(
          inArray(schema.users.email, [
            seedEmails.admin,
            seedEmails.operator,
            seedEmails.viewer,
          ])
        );

      const userIdByEmail = new Map(
        seededUsers.map((user) => [user.email, user.id] as const)
      );

      const adminUserId = userIdByEmail.get(seedEmails.admin);
      const operatorUserId = userIdByEmail.get(seedEmails.operator);
      const viewerUserId = userIdByEmail.get(seedEmails.viewer);

      if (!adminUserId || !operatorUserId || !viewerUserId) {
        throw new Error('Unable to resolve seeded users by email.');
      }

      await tx.insert(schema.accounts).values([
        {
          id: 'seed-account-admin',
          userId: adminUserId,
          accountId: 'seed-admin-account',
          providerId: 'credential',
          password: '$2b$12$seededhashplaceholder.admin',
        },
        {
          id: 'seed-account-operator',
          userId: operatorUserId,
          accountId: 'seed-operator-account',
          providerId: 'credential',
          password: '$2b$12$seededhashplaceholder.operator',
        },
      ]);

      await tx.insert(schema.sessions).values({
        id: 'seed-session-admin',
        userId: adminUserId,
        expiresAt: timestamps.sessionExpiry,
        token: 'seed-token-admin-2026',
        ipAddress: '127.0.0.1',
        userAgent: 'seed-script',
      });

      await tx.insert(schema.verifications).values({
        id: 'seed-verification-operator',
        identifier: seedEmails.operator,
        value: 'seed-reset-token-operator',
        expiresAt: timestamps.verificationExpiry,
      });

      await tx.insert(schema.projects).values({
        id: ids.project,
        name: 'Comprehensive Seed Project',
        description: 'Project scaffold used to explain linked record flows',
        ownerId: adminUserId,
      });

      await tx.insert(schema.projectMembers).values([
        {
          id: ids.projectMemberAdmin,
          projectId: ids.project,
          userId: adminUserId,
          role: 'owner',
        },
        {
          id: ids.projectMemberOperator,
          projectId: ids.project,
          userId: operatorUserId,
          role: 'member',
        },
      ]);

      await tx.insert(schema.items).values([
        {
          id: ids.itemIntake,
          projectId: ids.project,
          title: 'Validate feedstock intake data',
          description: 'Ensure incoming biomass records are complete and traceable.',
          status: 'active',
        },
        {
          id: ids.itemCredit,
          projectId: ids.project,
          title: 'Prepare credit batch package',
          description: 'Compile evidence before certifier submission.',
          status: 'active',
        },
      ]);

      // ------------------------------------------------------------
      // Core master data
      // ------------------------------------------------------------
      await tx.insert(schema.facilities).values({
        id: ids.facility,
        code: seedCodes.facility,
        name: 'NOMA Maji Kiln Site',
        location: 'Moshi, Tanzania',
        gpsLatitude: -3.334,
        gpsLongitude: 37.339,
        country: 'Tanzania',
        address: 'Maji Ward, Moshi District',
        contactEmail: 'ops@noma.local',
        contactPhone: '+255700000001',
        defaultDurabilityOption: '200_year',
      });

      await tx.insert(schema.reactors).values({
        id: ids.reactor,
        code: 'R-001',
        identifier: 'Kiln-A',
        facilityId: ids.facility,
        reactorType: 'auger',
        type: 'continuous',
        capacityKg: 500,
        designSpecs: 'Continuous auger pyrolysis reactor with condensate capture.',
        specifications: {
          manufacturer: 'NOMA Engineering',
          insulationClass: 'high-temp ceramic',
          pressureMonitoring: true,
        },
      });

      await tx.insert(schema.storageLocations).values([
        {
          id: ids.storageFeedstock,
          code: 'SL-FEED-01',
          name: 'Feedstock Bin 01',
          type: 'feedstock_bin',
          capacityKg: 15000,
          latitude: -3.3338,
          longitude: 37.3385,
          facilityId: ids.facility,
          isometricStorageMethod: 'covered_bin',
          isometricDescription: 'Covered bin with runoff protection',
          isometricSupplierReferenceId: 'ISO-STOR-FEED-01',
        },
        {
          id: ids.storageBiochar,
          code: 'SL-CHAR-01',
          name: 'Biochar Pile 01',
          type: 'biochar_pile',
          capacityKg: 8000,
          latitude: -3.3339,
          longitude: 37.3387,
          facilityId: ids.facility,
          isometricStorageMethod: 'tarped_pile',
          isometricDescription: 'Raised pile on impermeable liner',
          isometricSupplierReferenceId: 'ISO-STOR-CHAR-01',
        },
        {
          id: ids.storageProduct,
          code: 'SL-PROD-01',
          name: 'Product Staging Pile',
          type: 'product_pile',
          capacityKg: 5000,
          latitude: -3.3341,
          longitude: 37.3389,
          facilityId: ids.facility,
          isometricStorageMethod: 'bagged_palletized',
          isometricDescription: 'Bagged product on pallets under shelter',
          isometricSupplierReferenceId: 'ISO-STOR-PROD-01',
        },
      ]);

      await tx.insert(schema.suppliers).values({
        id: ids.supplier,
        code: 'SUP-001',
        name: 'Kilimanjaro Forestry Cooperative',
        location: 'Hai, Tanzania',
        gpsLatitude: -3.261,
        gpsLongitude: 37.126,
        address: 'Hai District, Kilimanjaro Region',
        contactName: 'Asha Mallya',
        contactEmail: 'ashara@kili-forest.coop',
        contactPhone: '+255700000010',
        annualRevenueUsd: 48000,
        chainOfCustodyRef: 'COC-KILI-2026',
      });

      await tx.insert(schema.customers).values({
        id: ids.customer,
        code: 'CUS-001',
        name: 'Moshi Coffee Growers Union',
        location: 'Moshi Rural, Tanzania',
        gpsLatitude: -3.277,
        gpsLongitude: 37.421,
        distanceKm: 34,
        cropType: 'Coffee',
        address: 'Mweka Road, Moshi Rural',
        contactEmail: 'field@moshicoffee.tz',
        contactPhone: '+255700000020',
      });

      await tx.insert(schema.customerLocations).values({
        id: ids.customerLocation,
        customerId: ids.customer,
        name: 'North Plot Application Zone',
        gpsLatitude: -3.279,
        gpsLongitude: 37.425,
        address: 'Plot N-12, Mweka',
      });

      await tx.insert(schema.drivers).values({
        id: ids.driver,
        code: 'DRV-001',
        name: 'Jackson Mrema',
        contact: '+255700000030',
        licenseNumber: 'TZ-C-99821',
        contactPhone: '+255700000030',
      });

      await tx.insert(schema.operators).values({
        id: ids.operator,
        code: 'OP-001',
        name: 'Neema Kweka',
        credentials: 'Pyrolysis operations certification',
        contactPhone: '+255700000040',
      });

      await tx.insert(schema.vehicles).values({
        id: ids.vehicle,
        code: 'VEH-001',
        name: 'Isuzu Forward 10T',
        identifier: 'T-420-XYZ',
        type: 'truck',
        vehicleType: 'heavy_truck',
        fuelType: 'diesel',
        fuelConsumptionLPerKm: 0.31,
        fuelConsumptionRate: 0.31,
        modelYear: 2021,
      });

      await tx.insert(schema.emissionFactors).values([
        {
          id: ids.emissionFactorDiesel,
          country: 'Tanzania',
          region: 'National',
          fuelType: 'diesel',
          emissionFactorKgCo2ePerUnit: 2.68,
          unit: 'liter',
          source: 'IPCC 2021',
          sourceUrl: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
          methodologyVersion: '2006GL',
          notes: 'Default stationary/mobile combustion factor.',
          validFrom: '2025-01-01',
          validTo: '2027-12-31',
        },
        {
          id: ids.emissionFactorElectricity,
          country: 'Tanzania',
          region: 'National Grid',
          fuelType: 'electricity',
          emissionFactorKgCo2ePerUnit: 0.43,
          unit: 'kWh',
          source: 'IEA 2024',
          sourceUrl: 'https://www.iea.org/data-and-statistics',
          methodologyVersion: 'IEA-2024',
          notes: 'Grid-average factor used for process electricity.',
          validFrom: '2025-01-01',
          validTo: '2027-12-31',
        },
      ]);

      // ------------------------------------------------------------
      // Feedstock intake
      // ------------------------------------------------------------
      await tx.insert(schema.feedstockTypes).values([
        {
          id: ids.feedstockTypeWoodchips,
          code: 'FT-001',
          name: 'Mixed Wood Chips',
          category: 'forestry',
          description: 'Pruned branches and sawmill residues.',
        },
        {
          id: ids.feedstockTypeCoffeeHusk,
          code: 'FT-002',
          name: 'Coffee Husk',
          category: 'agricultural',
          description: 'Coffee processing residue from nearby mills.',
        },
      ]);

      await tx.insert(schema.feedstockDeliveries).values({
        id: ids.feedstockDelivery,
        code: 'FD-2026-001',
        facilityId: ids.facility,
        status: 'complete',
        deliveryDate: timestamps.deliveryTime,
        supplierId: ids.supplier,
        driverId: ids.driver,
        vehicleId: ids.vehicle,
        vehicleDescription: 'Isuzu 10T flatbed',
        vehicleType: 'heavy_truck',
        fuelType: 'diesel',
        gpsLatitude: -3.3335,
        gpsLongitude: 37.3383,
        distanceKm: 34,
        fuelConsumedLiters: 10.5,
        transportEmissionsTco2e: 0.028,
        transportEmissionsCo2eKg: 28,
        emissionFactorUsed: 'diesel_2.68_kg_per_liter',
        feedstockTypeId: ids.feedstockTypeWoodchips,
        weightKg: 3200,
        moisturePercent: 18,
        notes: 'Load inspected at gate and weighed on calibrated scale.',
      });

      await tx.insert(schema.feedstocks).values({
        id: ids.feedstock,
        code: 'FS-2026-001',
        facilityId: ids.facility,
        date: '2026-01-12',
        status: 'complete',
        feedstockDeliveryId: ids.feedstockDelivery,
        collectionDate: new Date('2026-01-11T10:00:00.000Z'),
        deliveryDate: timestamps.deliveryTime,
        supplierId: ids.supplier,
        driverId: ids.driver,
        vehicleType: 'heavy_truck',
        fuelType: 'diesel',
        fuelConsumedLiters: 10.5,
        distanceKm: 34,
        transportEmissionsTco2e: 0.028,
        feedstockTypeId: ids.feedstockTypeWoodchips,
        weightKg: 3200,
        massWetKg: 3200,
        massDryKg: 2624,
        moisturePercent: 18,
        moistureContentPercent: 18,
        totalCarbonPercent: 49.5,
        inorganicCarbonPercent: 0.4,
        totalOrganicCarbonPercent: 49.1,
        co2eFeedstockTons: 4.8,
        feedstockSourceRegion: 'Kilimanjaro',
        storageLocationId: ids.storageFeedstock,
        counterfactualCategory: 'open_decay',
        counterfactualEmissions15Tons: 1.4,
        counterfactualStorage50Tons: 1.0,
        marketLeakageMethod: 'ml4_revenue_test',
        marketLeakageTons: 0.08,
        baselineScenario: 'open decay without controlled pyrolysis',
        baselineDescription: 'Residues would otherwise decompose aerobically.',
        notes: 'Moisture measured on receipt with handheld meter.',
      });

      // ------------------------------------------------------------
      // Production + QA
      // ------------------------------------------------------------
      await tx.insert(schema.productionRuns).values({
        id: ids.productionRun,
        code: 'PR-2026-001',
        facilityId: ids.facility,
        date: '2026-01-13',
        status: 'complete',
        startTime: timestamps.runStart,
        endTime: timestamps.runEnd,
        reactorId: ids.reactor,
        operatorId: ids.operator,
        feedstockMix: 'Mixed Wood Chips',
        feedstockStorageLocationId: ids.storageFeedstock,
        feedstockAmountKg: 2500,
        feedingRateKgHr: 420,
        moistureBeforeDryingPercent: 18,
        moistureAfterDryingPercent: 11,
        biocharAmountKg: 760,
        biocharDryWeightKg: 720,
        biocharWetWeightKg: 760,
        biocharDryMoisturePercent: 5,
        uncarbonizedBiocharKg: 15,
        yieldPercent: 30.4,
        biocharStorageLocationId: ids.storageBiochar,
        pyrolysisTemperatureC: 610,
        temperatureCelsius: 610,
        residenceTimeMinutes: 42,
        dieselOperationLiters: 11,
        dieselGensetLiters: 3,
        preprocessingFuelLiters: 2,
        electricityKwh: 145,
        plcDataFileUrl: 'https://files.noma.local/plc/PR-2026-001.csv',
        emissionsFromFossilsKg: 39,
        emissionsFromGridKg: 62,
        totalEmissionsKg: 101,
        energyEmissionsCo2eKg: 101,
        totalEmissionsCo2eKg: 115,
        emissionFactorsUsed: {
          diesel: 2.68,
          electricity: 0.43,
        },
        quenchingDryWeightKg: 710,
        quenchingWetWeightKg: 760,
        biocharOutputKg: 760,
        yieldPercentage: 30.4,
      });

      await tx.insert(schema.productionRunReadings).values([
        {
          id: ids.productionReading1,
          productionRunId: ids.productionRun,
          timestamp: new Date('2026-01-13T07:00:00.000Z'),
          temperatureC: 590,
          temperatureCelsius: 590,
          pressureBar: 0.2,
          continuousGasMeasurement: false,
          ch4Composition: 0.8,
          n2oComposition: 0.03,
          coComposition: 2.7,
          co2Composition: 16.2,
          gasFlowRate: 1.4,
          flowRate: 1.4,
        },
        {
          id: ids.productionReading2,
          productionRunId: ids.productionRun,
          timestamp: new Date('2026-01-13T08:00:00.000Z'),
          temperatureC: 612,
          temperatureCelsius: 612,
          pressureBar: 0.21,
          continuousGasMeasurement: true,
          ch4Composition: 0.7,
          n2oComposition: 0.03,
          coComposition: 2.5,
          co2Composition: 16.4,
          gasFlowRate: 1.45,
          ch4Ppm: 7100,
          n2oPpm: 320,
          coPpm: 25700,
          co2Ppm: 164000,
          flowRate: 1.45,
        },
      ]);

      await tx.insert(schema.samples).values({
        id: ids.sample,
        productionRunId: ids.productionRun,
        samplingTime: timestamps.sampleTime,
        operatorId: ids.operator,
        reactorId: ids.reactor,
        sampleCode: 'S-2026-001',
        weightG: 480,
        weightGrams: 480,
        volumeMl: 900,
        temperatureC: 34,
        analysisDate: '2026-01-18',
        totalCarbonPercent: 78.5,
        inorganicCarbonPercent: 0.8,
        organicCarbonPercent: 77.7,
        carbonContentPercent: 77.7,
        hydrogenContentPercent: 1.7,
        totalHydrogenPercent: 1.7,
        oxygenContentPercent: 7.3,
        totalOxygenPercent: 7.3,
        nitrogenPercent: 0.6,
        totalNitrogenPercent: 0.6,
        sulfurPercent: 0.12,
        totalSulfurPercent: 0.12,
        hCorgMolarRatio: 0.26,
        hToCOrgRatio: 0.26,
        oCorgMolarRatio: 0.07,
        oToCOrgRatio: 0.07,
        moisturePercent: 5.1,
        moistureContentPercent: 5.1,
        ashPercent: 9.8,
        ashContentPercent: 9.8,
        volatileMatterPercent: 14.5,
        fixedCarbonPercent: 70.6,
        ph: 8.9,
        saltContentGPerKg: 1.8,
        bulkDensityKgPerM3: 410,
        waterHoldingCapacityPercent: 145,
        leadMgPerKg: 8,
        leadMgKg: 8,
        cadmiumMgPerKg: 0.2,
        cadmiumMgKg: 0.2,
        copperMgPerKg: 22,
        copperMgKg: 22,
        nickelMgPerKg: 7,
        nickelMgKg: 7,
        mercuryMgPerKg: 0.03,
        mercuryMgKg: 0.03,
        zincMgPerKg: 95,
        zincMgKg: 95,
        chromiumMgPerKg: 11,
        chromiumMgKg: 11,
        arsenicMgPerKg: 0.7,
        arsenicMgKg: 0.7,
        pahsEfsa8MgPerKg: 0.11,
        pahTotalMgKg: 0.11,
        pahsEpa16MgPerKg: 0.17,
        pcddFNgPerKg: 1.3,
        dioxinsNgKg: 0.6,
        furansNgKg: 0.7,
        pcbMgPerKg: 0.01,
        pcbTotalMgKg: 0.01,
        nutrientClaimEnabled: true,
        phosphorusGPerKg: 2.5,
        potassiumGPerKg: 5.4,
        magnesiumGPerKg: 1.6,
        calciumGPerKg: 9.9,
        ironGPerKg: 3.7,
        randomReflectanceR0: 2.4,
        randomReflectanceR0Percent: 2.4,
        r0MeasurementCount: 540,
        residualOrganicCarbonPercent: 65,
        residualCarbonPercent: 65,
        reactiveCarbonPercent: 12,
        tgaAnalysisDate: '2026-01-18',
        r0AnalysisDate: '2026-01-18',
        r0HistogramFileUrl: 'https://files.noma.local/lab/r0-histogram-S-2026-001.pdf',
        tgaThermogramFileUrl: 'https://files.noma.local/lab/tga-S-2026-001.pdf',
        labName: 'Kibo Analytical Labs',
        labAccreditationNumber: 'ISO17025-TZ-1182',
        labAccreditation: 'ISO 17025',
        analysisMethod: 'ISO 29541 + ISO 16948',
        labAnalysisAt: timestamps.analysisTime,
        iso17025Accreditation: true,
        labResults: {
          h_to_c_org_ratio: 0.26,
          o_to_c_org_ratio: 0.07,
          fixed_carbon_percent: 70.6,
          cadmium_mg_per_kg: 0.2,
        },
        labAnalystName: 'Dr. Grace Mushi',
        labReportFileUrl: 'https://files.noma.local/lab/analysis-2026-001.pdf',
        labReportFile: 'analysis-2026-001.pdf',
        notes: 'Representative sample from stable operating window.',
      });

      await tx.insert(schema.incidentReports).values({
        id: ids.incident,
        productionRunId: ids.productionRun,
        incidentTime: timestamps.incidentTime,
        incidentDate: timestamps.incidentTime,
        operatorId: ids.operator,
        reactorId: ids.reactor,
        description: 'Short-lived temperature overshoot in secondary chamber.',
        severity: 'low',
        correctiveActions: 'Adjusted feed rate and increased airflow damping.',
        notes: 'Resolved in under 15 minutes with no unsafe conditions.',
      });

      await tx.insert(schema.productionRunFeedstocks).values({
        id: ids.productionFeedstockLink,
        productionRunId: ids.productionRun,
        feedstockId: ids.feedstock,
        massUsedKg: 2500,
      });

      // ------------------------------------------------------------
      // Products, logistics, applications
      // ------------------------------------------------------------
      await tx.insert(schema.formulations).values({
        id: ids.formulation,
        code: 'BCF-01',
        name: 'Biochar Compost Blend 30/70',
        biocharRatio: 30,
        compostRatio: 70,
        description: 'Field application blend for coffee farms.',
        ratio: { biochar: 0.3, compost: 0.7 },
      });

      await tx.insert(schema.biocharProducts).values({
        id: ids.biocharProduct,
        code: 'BP-2026-001',
        facilityId: ids.facility,
        productionDate: new Date('2026-01-14T09:00:00.000Z'),
        status: 'ready',
        formulationId: ids.formulation,
        sourceStorageLocationId: ids.storageBiochar,
        destinationStorageLocationId: ids.storageProduct,
        biocharSourceStorageId: ids.storageBiochar,
        linkedProductionRunId: ids.productionRun,
        biocharAmountKg: 760,
        biocharPerM3Kg: 180,
        compostWeightKg: 1770,
        compostPerM3Kg: 420,
        totalWeightKg: 2530,
        massKg: 2530,
        totalVolumeLiters: 5200,
        densityKgL: 0.49,
        densityKgM3: 490,
        composition: {
          biochar_pct: 30,
          compost_pct: 70,
          additives: [],
        },
        storageLocationId: ids.storageProduct,
      });

      await tx.insert(schema.orders).values({
        id: ids.order,
        code: 'OR-2026-001',
        facilityId: ids.facility,
        orderDate: timestamps.orderTime,
        status: 'processed',
        customerId: ids.customer,
        customerLocationId: ids.customerLocation,
        invoiceNumber: 'INV-2026-001',
        formulationId: ids.formulation,
        biocharProductId: ids.biocharProduct,
        quantityTons: 2.2,
        quantityKg: 2200,
        quantityM3: 4.5,
        biocharTons: 0.66,
        packaging: 'bagged',
        packagingType: 'bagged',
        valueTzs: 1650000,
        applicationStatus: 'In preparation',
        bulkDensityKgL: 0.49,
        cSinkType: 'Geo-localized C sink',
        compostPerM3Percent: 70,
      });

      await tx.insert(schema.deliveries).values({
        id: ids.delivery,
        code: 'DL-2026-001',
        facilityId: ids.facility,
        deliveryDate: timestamps.deliveryOutTime,
        status: 'delivered',
        orderId: ids.order,
        customerLocationId: ids.customerLocation,
        biocharProductId: ids.biocharProduct,
        storageLocationId: ids.storageProduct,
        quantityTons: 2.2,
        quantityM3: 4.5,
        biocharTons: 0.66,
        fixedCarbonPercent: 70.6,
        deliveredWetMassKg: 2200,
        massDryKg: 2068,
        driverId: ids.driver,
        vehicleId: ids.vehicle,
        vehicleDescription: 'Isuzu 10T flatbed',
        vehicleType: 'heavy_truck',
        transportEmissionsCo2eKg: 31,
      });

      await tx.insert(schema.transportLegs).values([
        {
          id: ids.transportFeedstock,
          entityType: 'feedstock',
          entityId: ids.feedstock,
          originGpsLatitude: -3.261,
          originGpsLongitude: 37.126,
          originName: 'Kilimanjaro Forestry Cooperative',
          destinationGpsLatitude: -3.334,
          destinationGpsLongitude: 37.339,
          destinationName: 'NOMA Maji Kiln Site',
          distanceKm: 34,
          transportMethodType: 'road',
          vehicleType: 'heavy_truck',
          vehicleModelYear: '2021',
          modelYear: 2021,
          fuelType: 'diesel',
          fuelConsumedLiters: 10.5,
          loadWeightTonnes: 3.2,
          loadMassKg: 3200,
          loadCapacityUtilizationPercent: 62,
          calculationMethodType: 'energy_usage',
          emissionFactorUsed: 2.68,
          emissionFactorSource: 'IPCC 2021',
          emissionsCo2eKg: 28,
          transportEmissionsCo2eKg: 28,
          billOfLading: 'BOL-FD-2026-001',
          weighScaleTicketRef: 'WST-FD-2026-001',
        },
        {
          id: ids.transportDelivery,
          entityType: 'delivery',
          entityId: ids.delivery,
          originGpsLatitude: -3.334,
          originGpsLongitude: 37.339,
          originName: 'NOMA Maji Kiln Site',
          destinationGpsLatitude: -3.279,
          destinationGpsLongitude: 37.425,
          destinationName: 'North Plot Application Zone',
          distanceKm: 41,
          transportMethodType: 'road',
          vehicleType: 'heavy_truck',
          vehicleModelYear: '2021',
          modelYear: 2021,
          fuelType: 'diesel',
          fuelConsumedLiters: 11.8,
          electricityKwh: 0,
          loadWeightTonnes: 2.2,
          loadMassKg: 2200,
          loadCapacityUtilizationPercent: 55,
          calculationMethodType: 'energy_usage',
          emissionFactorUsed: 2.68,
          emissionFactorSource: 'IPCC 2021',
          emissionsCo2eKg: 31,
          transportEmissionsCo2eKg: 31,
          billOfLading: 'BOL-DL-2026-001',
          weighScaleTicketRef: 'WST-DL-2026-001',
        },
      ]);

      await tx.insert(schema.applications).values({
        id: ids.application,
        code: 'AP-2026-001',
        facilityId: ids.facility,
        applicationDate: timestamps.applicationTime,
        status: 'applied',
        deliveryId: ids.delivery,
        biocharAppliedTons: 0.66,
        biocharAppliedDryTons: 0.62,
        biocharDryMatterTons: 0.62,
        totalAppliedTons: 2.2,
        averageApplicationRateMagnitude: 5.5,
        averageApplicationRateUnit: 't/ha',
        gpsLatitude: -3.279,
        gpsLongitude: 37.425,
        fieldSizeHa: 0.4,
        fieldSizeHectares: 0.4,
        cropType: 'Coffee',
        applicationMethodType: 'mechanical',
        fieldIdentifier: 'NORTH-12',
        gisBoundaryReference: 'gis://fields/north-12',
        co2eStoredTonnes: 1.1,
        co2eStoredTons: 1.1,
        truckMassOnArrivalKg: 8400,
        truckMassOnDepartureKg: 6200,
      });

      await tx.insert(schema.soilTemperatureMeasurements).values([
        {
          id: ids.soilTemp1,
          applicationId: ids.application,
          measurementDate: '2026-01-16',
          temperatureC: 24.7,
          temperatureCelsius: 24.7,
          measurementMethod: 'ISO 4974',
          measurementApproach: 'in-situ probe',
          measurementDepthCm: 15,
          depthCm: 15,
          gpsLatitude: -3.2791,
          gpsLongitude: 37.4251,
          notes: 'Morning reading',
        },
        {
          id: ids.soilTemp2,
          applicationId: ids.application,
          measurementDate: '2026-01-17',
          temperatureC: 25.1,
          temperatureCelsius: 25.1,
          measurementMethod: 'ISO 4974',
          measurementApproach: 'in-situ probe',
          measurementDepthCm: 15,
          depthCm: 15,
          gpsLatitude: -3.2792,
          gpsLongitude: 37.4252,
          notes: 'Afternoon reading',
        },
      ]);

      // ------------------------------------------------------------
      // Crediting + lab
      // ------------------------------------------------------------
      await tx.insert(schema.creditBatches).values({
        id: ids.creditBatch,
        code: 'CB-2026-001',
        facilityId: ids.facility,
        date: '2026-01-19',
        status: 'pending',
        reactorId: ids.reactor,
        startDate: new Date('2026-01-13T00:00:00.000Z'),
        endDate: new Date('2026-01-19T00:00:00.000Z'),
        reportingPeriodStart: '2026-01-01',
        reportingPeriodEnd: '2026-01-31',
        certifier: 'Isometric',
        registry: 'Isometric Registry',
        batchesCount: 1,
        weightTons: 0.62,
        creditsTco2e: 0.95,
        valueTzs: 1180000,
        bufferPoolPercent: 12,
        durabilityOptionType: '200_year',
        soilTemperatureC: 24.9,
        soilTemperatureCelsius: 24.9,
        soilTemperatureSource: 'baseline',
        hToCorgRatio: 0.26,
        fDurableCalculated: 0.87,
        fDurableFraction: 0.87,
        totalCo2eStoredTons: 1.1,
        totalCo2eEmissionsTons: 0.11,
        totalCo2eCounterfactualTons: 0.04,
        netCo2eRemovalTons: 0.95,
        totalCreditsTons: 0.95,
        siteManagementNotes:
          'Low-disturbance tilling, rainfed irrigation, no residue burning on plot.',
        affidavitReference: 'AFF-2026-001',
        intendedUseConfirmation: 'Biochar incorporated into agricultural soils only.',
        companyVerificationRef: 'BUS-VERIFY-2026-COFFEE-001',
        mixingTimelineDays: 4,
      });

      await tx.insert(schema.creditBatchApplications).values({
        id: ids.creditBatchApplication,
        creditBatchId: ids.creditBatch,
        applicationId: ids.application,
      });

      // ------------------------------------------------------------
      // Documentation (exactly one owner per row)
      // ------------------------------------------------------------
      await tx.insert(schema.documents).values([
        {
          id: ids.feedstockDoc,
          documentType: 'pdf',
          fileUrl: 'https://files.noma.local/docs/feedstock-profile-FS-2026-001.pdf',
          fileName: 'feedstock-profile-FS-2026-001.pdf',
          fileSizeBytes: 218834,
          mimeType: 'application/pdf',
          checksumSha256: 'seed-sha-feedstock-doc',
          issuedAt: timestamps.deliveryTime,
          description: 'Feedstock characterization sheet',
          metadata: { category: 'feedstock_profile' },
          createdBy: operatorUserId,
          feedstockId: ids.feedstock,
        },
        {
          id: ids.feedstockDeliveryDoc,
          documentType: 'weighbridge_ticket',
          fileUrl: 'https://files.noma.local/docs/weighbridge-FD-2026-001.pdf',
          fileName: 'weighbridge-FD-2026-001.pdf',
          fileSizeBytes: 123991,
          mimeType: 'application/pdf',
          checksumSha256: 'seed-sha-feedstock-delivery-doc',
          issuedAt: timestamps.deliveryTime,
          description: 'Inbound weighbridge ticket',
          metadata: { ticket_ref: 'WST-FD-2026-001' },
          createdBy: operatorUserId,
          feedstockDeliveryId: ids.feedstockDelivery,
        },
        {
          id: ids.productionRunDoc,
          documentType: 'calibration_certificate',
          fileUrl: 'https://files.noma.local/docs/reactor-calibration-2026-01.pdf',
          fileName: 'reactor-calibration-2026-01.pdf',
          fileSizeBytes: 311004,
          mimeType: 'application/pdf',
          checksumSha256: 'seed-sha-production-doc',
          issuedAt: timestamps.createdEarly,
          description: 'Monthly reactor sensor calibration certificate',
          metadata: { reactor_code: 'R-001' },
          createdBy: adminUserId,
          productionRunId: ids.productionRun,
        },
        {
          id: ids.sampleDoc,
          documentType: 'lab_report',
          fileUrl: 'https://files.noma.local/docs/sample-S-2026-001-report.pdf',
          fileName: 'sample-S-2026-001-report.pdf',
          fileSizeBytes: 445880,
          mimeType: 'application/pdf',
          checksumSha256: 'seed-sha-sample-doc',
          issuedAt: timestamps.analysisTime,
          description: 'Laboratory report for sample S-2026-001',
          metadata: { sample_code: 'S-2026-001' },
          createdBy: operatorUserId,
          sampleId: ids.sample,
        },
        {
          id: ids.incidentDoc,
          documentType: 'photo',
          fileUrl: 'https://files.noma.local/docs/incident-PR-2026-001.jpg',
          fileName: 'incident-PR-2026-001.jpg',
          fileSizeBytes: 94731,
          mimeType: 'image/jpeg',
          checksumSha256: 'seed-sha-incident-doc',
          capturedAt: timestamps.incidentTime,
          description: 'Photo captured during temperature overshoot event',
          metadata: { camera: 'mobile' },
          createdBy: operatorUserId,
          incidentReportId: ids.incident,
        },
        {
          id: ids.biocharProductDoc,
          documentType: 'invoice',
          fileUrl: 'https://files.noma.local/docs/product-batch-BP-2026-001-invoice.pdf',
          fileName: 'product-batch-BP-2026-001-invoice.pdf',
          fileSizeBytes: 156990,
          mimeType: 'application/pdf',
          checksumSha256: 'seed-sha-product-doc',
          issuedAt: timestamps.orderTime,
          description: 'Product batch invoice package',
          metadata: { invoice: 'INV-2026-001' },
          createdBy: adminUserId,
          biocharProductId: ids.biocharProduct,
        },
        {
          id: ids.deliveryDoc,
          documentType: 'delivery_receipt',
          fileUrl: 'https://files.noma.local/docs/delivery-receipt-DL-2026-001.pdf',
          fileName: 'delivery-receipt-DL-2026-001.pdf',
          fileSizeBytes: 102340,
          mimeType: 'application/pdf',
          checksumSha256: 'seed-sha-delivery-doc',
          issuedAt: timestamps.deliveryOutTime,
          description: 'Signed delivery receipt',
          metadata: { recipient: 'Moshi Coffee Growers Union' },
          createdBy: operatorUserId,
          deliveryId: ids.delivery,
        },
        {
          id: ids.transportDoc,
          documentType: 'bill_of_lading',
          fileUrl: 'https://files.noma.local/docs/bill-of-lading-DL-2026-001.pdf',
          fileName: 'bill-of-lading-DL-2026-001.pdf',
          fileSizeBytes: 135220,
          mimeType: 'application/pdf',
          checksumSha256: 'seed-sha-transport-doc',
          issuedAt: timestamps.deliveryOutTime,
          description: 'Bill of lading for application delivery leg',
          metadata: { bol_number: 'BOL-DL-2026-001' },
          createdBy: operatorUserId,
          transportLegId: ids.transportDelivery,
        },
        {
          id: ids.applicationDoc,
          documentType: 'photo',
          fileUrl: 'https://files.noma.local/docs/application-proof-AP-2026-001.jpg',
          fileName: 'application-proof-AP-2026-001.jpg',
          fileSizeBytes: 117893,
          mimeType: 'image/jpeg',
          checksumSha256: 'seed-sha-application-doc',
          capturedAt: timestamps.applicationTime,
          description: 'Geo-tagged photo of field application',
          metadata: { field: 'NORTH-12' },
          createdBy: operatorUserId,
          applicationId: ids.application,
        },
        {
          id: ids.creditBatchDoc,
          documentType: 'pdd',
          fileUrl: 'https://files.noma.local/docs/pdd-CB-2026-001.pdf',
          fileName: 'pdd-CB-2026-001.pdf',
          fileSizeBytes: 751122,
          mimeType: 'application/pdf',
          checksumSha256: 'seed-sha-credit-batch-doc',
          issuedAt: timestamps.submissionTime,
          description: 'Project design document excerpt for credit batch.',
          metadata: { credit_batch: 'CB-2026-001' },
          createdBy: adminUserId,
          creditBatchId: ids.creditBatch,
        },
      ]);

      // ------------------------------------------------------------
      // Compliance
      // ------------------------------------------------------------
      await tx.insert(schema.feedstockScAssessments).values({
        id: ids.feedstockAssessment,
        feedstockId: ids.feedstock,
        criterionCode: 'SC1.2',
        assessmentDate: '2026-01-12',
        outcome: 'pass',
        assessor: 'Compliance Team A',
        validFrom: '2026-01-12',
        validTo: '2027-01-11',
        evidenceDocumentId: ids.feedstockDoc,
        notes: 'Supplier evidence and chain-of-custody documentation validated.',
      });

      await tx.insert(schema.custodyHandoffs).values({
        id: ids.custodyHandoff,
        materialType: 'delivery',
        materialId: ids.delivery,
        fromPartyType: 'facility',
        fromPartyId: ids.facility,
        toPartyType: 'customer',
        toPartyId: ids.customer,
        handoffAt: timestamps.deliveryOutTime,
        quantityKg: 2200,
        referenceNumber: 'COC-HO-2026-001',
        documentId: ids.transportDoc,
        notes: 'Custody transferred at customer receiving point.',
      });

      await tx.insert(schema.ghgMaterialityAssessments).values({
        id: ids.materialityAssessment,
        creditBatchId: ids.creditBatch,
        assessmentDate: '2026-01-20',
        estimatedSsrEmissionsTco2e: 0.006,
        estimatedNetRemovalsTco2e: 0.95,
        materialityPercent: 0.63,
        isMaterial: false,
        reassessmentRequiredBy: '2027-01-20',
        methodologyReference: 'GHG Module v1.0 Section 5',
        notes: 'SSR emissions below 1% threshold; annual reassessment scheduled.',
      });

      // ------------------------------------------------------------
      // Certifier integration records
      // ------------------------------------------------------------
      await tx.insert(schema.certifierProjects).values({
        id: ids.certifierProject,
        facilityId: ids.facility,
        provider: 'isometric',
        externalProjectId: 'iso-project-noma-001',
        protocolSlug: 'biochar',
        protocolVersion: '1.2.0',
        metadata: {
          owner: 'NOMA',
          region: 'TZ',
        },
      });

      await tx.insert(schema.certifierSources).values({
        id: ids.certifierSource,
        provider: 'isometric',
        sourceType: 'reporting_period',
        sourceReferenceId: 'RP-2026-01',
        description: 'January 2026 reporting period source object.',
        metadata: {
          period_start: '2026-01-01',
          period_end: '2026-01-31',
        },
      });

      await tx.insert(schema.certificationSubmissions).values([
        {
          id: ids.submissionMonitoring,
          provider: 'isometric',
          submissionType: 'monitoring_submission',
          localEntityType: 'source',
          localEntityId: ids.certifierSource,
          sourceId: ids.certifierSource,
          externalId: 'iso-monitoring-2026-01-v1',
          version: 1,
          status: 'submitted',
          submittedAt: timestamps.submissionTime,
          payloadSnapshot: {
            monitoring_period_start: '2026-01-01T00:00:00.000Z',
            monitoring_period_end: '2026-01-31T23:59:59.000Z',
            credit_batch_codes: ['CB-2026-001'],
          },
        },
        {
          id: ids.submissionProductionBatch,
          provider: 'isometric',
          submissionType: 'production_batch',
          localEntityType: 'production_run',
          localEntityId: ids.productionRun,
          externalId: 'iso-production-PR-2026-001-v1',
          version: 1,
          status: 'submitted',
          submittedAt: timestamps.submissionTime,
          payloadSnapshot: {
            production_run_code: 'PR-2026-001',
          },
        },
        {
          id: ids.submissionStorageLocation,
          provider: 'isometric',
          submissionType: 'storage_location',
          localEntityType: 'application',
          localEntityId: ids.application,
          externalId: 'iso-storage-AP-2026-001-v1',
          version: 1,
          status: 'submitted',
          submittedAt: timestamps.submissionTime,
          payloadSnapshot: {
            field_identifier: 'NORTH-12',
            gps: [-3.279, 37.425],
          },
        },
        {
          id: ids.submissionBiocharApplication,
          provider: 'isometric',
          submissionType: 'biochar_application',
          localEntityType: 'application',
          localEntityId: ids.application,
          externalId: 'iso-application-AP-2026-001-v1',
          version: 1,
          status: 'submitted',
          submittedAt: timestamps.submissionTime,
          payloadSnapshot: {
            application_code: 'AP-2026-001',
            delivered_mass_kg: 2200,
          },
        },
        {
          id: ids.submissionRemoval,
          provider: 'isometric',
          submissionType: 'removal',
          localEntityType: 'credit_batch',
          localEntityId: ids.creditBatch,
          externalId: 'iso-removal-CB-2026-001-v1',
          version: 1,
          status: 'submitted',
          submittedAt: timestamps.submissionTime,
          payloadSnapshot: {
            net_removal_tco2e: 0.95,
          },
        },
        {
          id: ids.submissionGhgStatement,
          provider: 'isometric',
          submissionType: 'ghg_statement',
          localEntityType: 'credit_batch',
          localEntityId: ids.creditBatch,
          externalId: 'iso-ghg-CB-2026-001-v1',
          version: 1,
          status: 'submitted',
          submittedAt: timestamps.submissionTime,
          payloadSnapshot: {
            stored_tco2e: 1.1,
            emissions_tco2e: 0.11,
            counterfactual_tco2e: 0.04,
          },
        },
      ]);

      await tx.insert(schema.certifierDocumentUploads).values({
        id: ids.certifierDocumentUpload,
        documentId: ids.creditBatchDoc,
        provider: 'isometric',
        externalDocumentId: 'iso-doc-pdd-cb-2026-001',
        metadata: {
          type: 'pdd',
          linked_credit_batch: 'CB-2026-001',
        },
      });

      await tx.insert(schema.certifierSyncEvents).values({
        id: ids.certifierSyncEvent,
        provider: 'isometric',
        entityType: 'certification_submission',
        entityId: ids.submissionRemoval,
        operation: 'create',
        status: 'succeeded',
        requestPayload: {
          external_removal_id: 'iso-removal-CB-2026-001-v1',
        },
        responsePayload: {
          status: 'accepted',
        },
        attemptedAt: timestamps.submissionTime,
      });
    });

    console.log('Comprehensive seed completed successfully.');
    console.log('Seeded data includes auth, legacy templates, operations, compliance, and certifier integration records.');
  } catch (error) {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
