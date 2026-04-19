/**
 * Chain of custody data access
 * Resolves the upstream lineage for a single application back to its feedstocks.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  deliveries,
  facilities,
  feedstockDeliveries,
  feedstockTypes,
  feedstocks,
  orders,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  suppliers,
} from "@/db/schema";
import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";

export interface ChainFacility {
  id: string;
  code: string;
  name: string;
}

export interface ChainApplicationLineage {
  id: string;
  code: string;
  status: string | null;
  applicationDate: Date;
  fieldIdentifier: string | null;
  biocharAppliedDryTons: number | null;
  href: string;
}

export interface ChainDeliveryLineage {
  id: string;
  code: string;
  status: string | null;
  deliveryDate: Date;
  massDryKg: number | null;
  href: string;
}

export interface ChainOrderLineage {
  id: string;
  code: string;
  orderDate: Date;
  quantityKg: number | null;
  href: string;
}

export interface ChainBiocharProductLineage {
  id: string;
  code: string;
  status: string | null;
  productionDate: Date;
  massKg: number | null;
  linkedProductionRunId: string | null;
  href: string;
}

export interface ChainProductionRunLineage {
  id: string;
  code: string;
  status: string | null;
  date: Date | string;
  biocharDryMassKg: number | null;
  feedstockMassDryKg: number | null;
  href: string;
}

export interface ChainReactorLineage {
  id: string;
  code: string;
  identifier: string;
  reactorType: string | null;
  href: string;
}

export interface ChainFeedstockLineage {
  id: string;
  code: string;
  status: string | null;
  deliveryDate: Date | null;
  massDryKg: number | null;
  massUsedKg: number | null;
  supplierName: string | null;
  feedstockTypeName: string | null;
  feedstockDeliveryCode: string | null;
  href: string;
}

export interface ChainOfCustodyData {
  facility: ChainFacility;
  application: ChainApplicationLineage;
  delivery: ChainDeliveryLineage;
  order: ChainOrderLineage | null;
  biocharProduct: ChainBiocharProductLineage | null;
  productionRun: ChainProductionRunLineage | null;
  reactor: ChainReactorLineage | null;
  feedstocks: ChainFeedstockLineage[];
  warnings: string[];
}

export async function getChainOfCustodyData(
  userId: string,
  applicationId: string
): Promise<ChainOfCustodyData> {
  requireAuth(userId);

  const [applicationRow] = await db
    .select({
      applicationId: applications.id,
      applicationCode: applications.code,
      applicationStatus: applications.status,
      applicationDate: applications.applicationDate,
      fieldIdentifier: applications.fieldIdentifier,
      biocharAppliedDryTons: applications.biocharAppliedDryTons,
      deliveryId: deliveries.id,
      deliveryCode: deliveries.code,
      deliveryStatus: deliveries.status,
      deliveryDate: deliveries.deliveryDate,
      deliveryMassDryKg: deliveries.massDryKg,
      deliveryBiocharProductId: deliveries.biocharProductId,
      orderId: orders.id,
      orderCode: orders.code,
      orderDate: orders.orderDate,
      orderQuantityKg: orders.quantityKg,
      orderBiocharProductId: orders.biocharProductId,
      facilityId: facilities.id,
      facilityCode: facilities.code,
      facilityName: facilities.name,
    })
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .leftJoin(orders, eq(deliveries.orderId, orders.id))
    .innerJoin(facilities, eq(deliveries.facilityId, facilities.id))
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!applicationRow) {
    throw new SafeError("Application not found");
  }

  const warnings: string[] = [];
  const biocharProductId =
    applicationRow.deliveryBiocharProductId ?? applicationRow.orderBiocharProductId;

  const biocharProduct = biocharProductId
    ? await getBiocharProductLineage(biocharProductId)
    : null;

  if (!biocharProductId) {
    warnings.push(
      "This application is not linked to a biochar product through its delivery or order."
    );
  }

  const productionRun = biocharProduct?.linkedProductionRunId
    ? await getProductionRunLineage(biocharProduct.linkedProductionRunId)
    : null;

  if (biocharProduct && !biocharProduct.linkedProductionRunId) {
    warnings.push(
      "The linked biochar product does not point to a production run yet, so feedstock rollback stops at product level."
    );
  }

  const [reactor, feedstocksForRun] = productionRun
    ? await Promise.all([
        getReactorLineageForRun(productionRun.id),
        getFeedstocksForRun(productionRun.id),
      ])
    : [null, []];

  if (productionRun && feedstocksForRun.length === 0) {
    warnings.push(
      "The linked production run does not have any recorded feedstock allocations."
    );
  }

  return {
    facility: {
      id: applicationRow.facilityId,
      code: applicationRow.facilityCode,
      name: applicationRow.facilityName,
    },
    application: {
      id: applicationRow.applicationId,
      code: applicationRow.applicationCode,
      status: applicationRow.applicationStatus,
      applicationDate: applicationRow.applicationDate,
      fieldIdentifier: applicationRow.fieldIdentifier,
      biocharAppliedDryTons: applicationRow.biocharAppliedDryTons,
      href: "/applications",
    },
    delivery: {
      id: applicationRow.deliveryId,
      code: applicationRow.deliveryCode,
      status: applicationRow.deliveryStatus,
      deliveryDate: applicationRow.deliveryDate,
      massDryKg: applicationRow.deliveryMassDryKg,
      href: "/deliveries",
    },
    order: applicationRow.orderId
      ? {
          id: applicationRow.orderId,
          code: applicationRow.orderCode!,
          orderDate: applicationRow.orderDate!,
          quantityKg: applicationRow.orderQuantityKg,
          href: "/orders",
        }
      : null,
    biocharProduct,
    productionRun,
    reactor,
    feedstocks: feedstocksForRun,
    warnings,
  };
}

async function getBiocharProductLineage(
  biocharProductId: string
): Promise<ChainBiocharProductLineage | null> {
  const [product] = await db
    .select({
      id: biocharProducts.id,
      code: biocharProducts.code,
      status: biocharProducts.status,
      productionDate: biocharProducts.productionDate,
      massKg: biocharProducts.massKg,
      linkedProductionRunId: biocharProducts.linkedProductionRunId,
    })
    .from(biocharProducts)
    .where(eq(biocharProducts.id, biocharProductId))
    .limit(1);

  if (!product) {
    return null;
  }

  return {
    ...product,
    href: "/biochar-products",
  };
}

async function getProductionRunLineage(
  productionRunId: string
): Promise<ChainProductionRunLineage | null> {
  const [productionRun] = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      status: productionRuns.status,
      date: productionRuns.date,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      feedstockMassDryKg: productionRuns.feedstockMassDryKg,
    })
    .from(productionRuns)
    .where(eq(productionRuns.id, productionRunId))
    .limit(1);

  if (!productionRun) {
    return null;
  }

  return {
    ...productionRun,
    href: "/production-runs",
  };
}

async function getReactorLineageForRun(
  productionRunId: string
): Promise<ChainReactorLineage | null> {
  const [reactor] = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      reactorType: reactors.reactorType,
    })
    .from(productionRuns)
    .innerJoin(reactors, eq(productionRuns.reactorId, reactors.id))
    .where(eq(productionRuns.id, productionRunId))
    .limit(1);

  if (!reactor) {
    return null;
  }

  return {
    ...reactor,
    href: "/reactors",
  };
}

async function getFeedstocksForRun(
  productionRunId: string
): Promise<ChainFeedstockLineage[]> {
  const rows = await db
    .select({
      id: feedstocks.id,
      code: feedstocks.code,
      status: feedstocks.status,
      deliveryDate: feedstocks.deliveryDate,
      massDryKg: feedstocks.massDryKg,
      massUsedKg: productionRunFeedstocks.massUsedKg,
      supplierName: suppliers.name,
      feedstockTypeName: feedstockTypes.name,
      feedstockDeliveryCode: feedstockDeliveries.code,
    })
    .from(productionRunFeedstocks)
    .innerJoin(feedstocks, eq(productionRunFeedstocks.feedstockId, feedstocks.id))
    .leftJoin(feedstockDeliveries, eq(feedstocks.feedstockDeliveryId, feedstockDeliveries.id))
    .leftJoin(suppliers, eq(feedstocks.supplierId, suppliers.id))
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
    .where(eq(productionRunFeedstocks.productionRunId, productionRunId));

  return rows.map((row) => ({
    ...row,
    href: "/feedstocks",
  }));
}
