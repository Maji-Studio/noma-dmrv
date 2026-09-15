import type { DbTransaction } from '.';
import * as schema from './schema';
import { DEC_ORG_ID } from './org-defaults';
import { demoId, ids } from './seed-demo-facts';

export async function seedDemoScale(tx: DbTransaction) {
  // ============================================================
  // EXTRA STORAGE BINS (Moshi) — exercises the storage flow board at
  // realistic scale (20+ bins) with a spread of fill levels. Pure demo
  // data in a reserved id/code range (9xxx) so it never collides with
  // the curated entities above. Fill comes from the same sources the
  // board reads: feedstock rows, production-run output, and products.
  // ============================================================
  console.log('Creating extra storage bins (scale demo)...');

  const extraBinBase = 9000;
  const scaleDemoBiocharMoisturePercent = 2;
  const scaleDemoBiocharDryFraction = 0.98;
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
        biocharMoisturePercent: scaleDemoBiocharMoisturePercent,
        biocharDryMassKg: massKg * scaleDemoBiocharDryFraction,
      });
    } else {
      // Additional product bins are intentionally empty until a traced product is posted.
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
}
