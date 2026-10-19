import type { OrgContext } from "@/lib/auth/server";
import { createStorageLocation } from "@/data-access/storage-locations";
import { createFeedstockType } from "@/data-access/feedstock-types";
import { createReactor } from "@/data-access/reactors";
import { logFeedstockDelivery } from "@/lib/operations/feedstocks";
import { startProductionRun } from "@/lib/operations/production-runs";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { recordOrder } from "@/lib/operations/orders";
import { recordDelivery } from "@/lib/operations/deliveries";
import { recordApplicationApi } from "@/lib/operations/application-api";
import { runOperation } from "@/lib/operations/runner";
import { applicationEtag } from "@/lib/api/representation-etags";
import { formatFacilityDate } from "@/lib/date-utils";

const FEEDSTOCK_WET_MASS_KG = 300;
const FEEDSTOCK_MOISTURE_PERCENT = 20;
const BIOCHAR_WET_MASS_KG = 60;
const BIOCHAR_MOISTURE_PERCENT = 10;
const DELIVERY_WET_MASS_KG = 50;
const APPLICATION_WET_MASS_KG = 1;
const FIELD_SIZE_HA = 1;
const RUN_START_HOURS_AGO = 6;
const RUN_END_HOURS_AGO = 5;
const PLACED_HOURS_AGO = 4;
const DELIVERED_HOURS_AGO = 1;
const MS_PER_HOUR = 3_600_000;
const SCRIPT_OPTIONS = { activitySource: "script" } as const;
// A small WGS 84 field around the fixture site's GPS pair.
const BOUNDARY = { type: "Polygon", coordinates: [[[35.3, -8.3], [35.301, -8.3], [35.301, -8.301], [35.3, -8.301], [35.3, -8.3]]] };

/** Independent supply leaves every pre-existing fuzz record and stock unchanged. */
export async function seedApplications(ctx: OrgContext, input: {
  facilityId: string; supplierId: string; formulationId: string;
  customerId: string; customerLocationId: string; gpsLatitude: number; gpsLongitude: number; timeZone: string;
}) {
  const now = Date.now();
  const instant = (hoursAgo: number) => new Date(now - hoursAgo * MS_PER_HOUR).toISOString();
  const applicationDate = formatFacilityDate(new Date(now), input.timeZone);
  const feedstockType = await createFeedstockType(ctx, {
    code: "FUZZ-APP-WOOD", name: "API fuzz application wood", category: "forestry", usage: "pyrolysis",
  });
  const feedstockBin = await createStorageLocation(ctx, {
    code: "FUZZ-APP-IN", name: "API fuzz application feedstock", type: "feedstock_bin",
    facilityId: input.facilityId, feedstockTypeId: feedstockType.id,
  });
  const biocharBin = await createStorageLocation(ctx, {
    code: "FUZZ-APP-BC", name: "API fuzz application biochar", type: "biochar_bin", facilityId: input.facilityId,
  });
  const productBin = await createStorageLocation(ctx, {
    code: "FUZZ-APP-PB", name: "API fuzz application product", type: "product_bin", facilityId: input.facilityId,
  });
  const reactor = await createReactor(ctx, {
    code: "FUZZ-APP-RX", identifier: "FUZZ-APP-RX-1", facilityId: input.facilityId, reactorType: "fixed-bed",
  });
  await runOperation(logFeedstockDelivery, ctx, {
    facilityId: input.facilityId, supplierId: input.supplierId, feedstockTypeId: feedstockType.id,
    deliveryDate: applicationDate, totalWetMassKg: FEEDSTOCK_WET_MASS_KG, moisturePercent: FEEDSTOCK_MOISTURE_PERCENT,
    allocations: [{ storageLocationId: feedstockBin.id, allocatedWetMassKg: FEEDSTOCK_WET_MASS_KG }],
  }, SCRIPT_OPTIONS);
  await runOperation(startProductionRun, ctx, {
    facilityId: input.facilityId, reactorId: reactor.id, status: "complete",
    startTime: instant(RUN_START_HOURS_AGO), endTime: instant(RUN_END_HOURS_AGO),
    feedstockDraws: [{ storageLocationId: feedstockBin.id, wetMassKg: FEEDSTOCK_WET_MASS_KG }],
    feedstockMoisturePercent: FEEDSTOCK_MOISTURE_PERCENT, biocharStorageLocationId: biocharBin.id,
    biocharOutputKg: BIOCHAR_WET_MASS_KG, biocharMoisturePercent: BIOCHAR_MOISTURE_PERCENT,
  }, SCRIPT_OPTIONS);
  await runOperation(makeBiocharProduct, ctx, {
    facilityId: input.facilityId, formulationId: input.formulationId, placedAt: instant(PLACED_HOURS_AGO),
    sourceBiocharStorageLocationId: biocharBin.id, storageLocationId: productBin.id,
    biocharWetMassKg: DELIVERY_WET_MASS_KG, biocharMoisturePercent: BIOCHAR_MOISTURE_PERCENT, waterAddedKg: 0,
  }, SCRIPT_OPTIONS);
  const order = (await runOperation(recordOrder, ctx, {
    facilityId: input.facilityId, customerId: input.customerId, customerLocationId: input.customerLocationId,
    formulationId: input.formulationId, orderDate: applicationDate, quantityKg: DELIVERY_WET_MASS_KG, packaging: "loose",
  }, SCRIPT_OPTIONS)).data;
  const delivery = (await runOperation(recordDelivery, ctx, {
    orderId: order.id, storageLocationId: productBin.id, deliveredAt: instant(DELIVERED_HOURS_AGO),
    deliveredWetMassKg: DELIVERY_WET_MASS_KG, moisturePercent: BIOCHAR_MOISTURE_PERCENT,
  }, SCRIPT_OPTIONS)).data.delivery;
  const application = (await runOperation(recordApplicationApi, ctx, {
    deliveryId: delivery.id, applicationDate, appliedWetMassKg: APPLICATION_WET_MASS_KG,
    fieldSizeHa: FIELD_SIZE_HA, evidenceMethod: "location", gisBoundary: BOUNDARY,
    gpsLatitude: input.gpsLatitude, gpsLongitude: input.gpsLongitude,
  }, SCRIPT_OPTIONS)).data.application;
  return {
    applicationId: application.id, applicationCode: application.code, applicationEtag: applicationEtag(application),
    applicationDeliveryId: delivery.id, applicationDeliveryCode: delivery.code, applicationDate,
    applicationGpsLatitude: input.gpsLatitude, applicationGpsLongitude: input.gpsLongitude,
  };
}
