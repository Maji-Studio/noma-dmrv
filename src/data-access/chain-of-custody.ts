/**
 * Chain of custody data access
 * Resolves the upstream lineage for a single application back to its feedstocks.
 */
import { and, eq } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  deliveries,
  facilities,
  feedstockDeliveries,
  feedstockTypes,
  feedstocks,
  formulations,
  orders,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  suppliers,
} from "@/db/schema";
import { requireOrgScope } from "./utils";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { SafeError } from "@/lib/errors";
import type {
  BatchLineageApplicationFact,
  BatchLineageRunFact,
} from "./credit-batch-lineage-facts";

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
  evidenceMethod: "visual" | "boundary";
  gisBoundaryReference: string | null;
  biocharAppliedDryTons: number | null;
  /**
   * The application site's own declared annual-average soil temperature (°C),
   * or null. Used only to reconcile against the facility reference value
   * (conservative-direction check) — NOT the submitted durability input.
   */
  soilTemperatureC: number | null;
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
  /**
   * Recorded moisture (%) of the lot's wet `massKg`. Lets the Sankey convert
   * the lot to a dry basis so it balances against the runs' dry output
   * (issue #361 F14).
   */
  moistureContentPercent: number | null;
  /** Blend name (formulations.name); null = pure biochar (no formulation). */
  formulationName: string | null;
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
  /** Drives the Sankey's derived ineligible-feedstock exit (issue #285). */
  eligibilityStatus: "eligible" | "ineligible" | "conditional" | null;
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

export function projectChainOfCustodyFromBatchFacts(
  application: BatchLineageApplicationFact,
  run: BatchLineageRunFact | undefined,
): ChainOfCustodyData {
  if (!run) {
    throw new SafeError(
      `Application ${application.id} has no resolved production run`,
    );
  }
  const warnings = run.feedstocks.length === 0
    ? ["The linked production run does not have any recorded feedstock allocations."]
    : [];
  return {
    facility: application.facility,
    application: {
      id: application.id, code: application.code, status: application.status,
      applicationDate: application.applicationDate,
      fieldIdentifier: application.fieldIdentifier,
      evidenceMethod: application.evidenceMethod,
      gisBoundaryReference: application.gisBoundaryReference,
      biocharAppliedDryTons: application.biocharAppliedDryTons,
      soilTemperatureC: application.soilTemperatureC,
      href: "/applications",
    },
    delivery: { ...application.delivery, href: "/deliveries" },
    order: application.order ? { ...application.order, href: "/orders" } : null,
    biocharProduct: { ...application.biocharProduct, href: "/biochar-products" },
    productionRun: {
      id: run.id, code: run.code, status: run.status, date: run.date,
      biocharDryMassKg: run.biocharDryMassKg,
      feedstockMassDryKg: run.feedstockMassDryKg,
      href: "/production-runs",
    },
    reactor: run.reactor ? { ...run.reactor, href: "/reactors" } : null,
    feedstocks: run.feedstocks.map((feedstock) => ({
      ...feedstock,
      href: "/feedstocks",
    })),
    warnings,
  };
}

export async function getChainOfCustodyData(
  ctx: OrgContext,
  applicationId: string
): Promise<ChainOfCustodyData> {
  requireOrgScope(ctx);

  const [applicationRow] = await db
    .select({
      applicationId: applications.id,
      applicationCode: applications.code,
      applicationStatus: applications.status,
      applicationDate: applications.applicationDate,
      fieldIdentifier: applications.fieldIdentifier,
      evidenceMethod: applications.evidenceMethod,
      gisBoundaryReference: applications.gisBoundaryReference,
      biocharAppliedDryTons: applications.biocharAppliedDryTons,
      applicationSoilTemperatureC: applications.soilTemperatureC,
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
    .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .innerJoin(facilities, and(eq(deliveries.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(applications.id, applicationId), eq(applications.organizationId, ctx.organizationId)))
    .limit(1);

  if (!applicationRow) {
    throw new SafeError("Application not found");
  }

  const warnings: string[] = [];
  const biocharProductId =
    applicationRow.deliveryBiocharProductId ?? applicationRow.orderBiocharProductId;

  const biocharProduct = biocharProductId
    ? await getBiocharProductLineage(ctx, biocharProductId)
    : null;

  if (!biocharProductId) {
    warnings.push(
      "This application is not linked to a biochar product through its delivery or order."
    );
  }

  const productionRun = biocharProduct?.linkedProductionRunId
    ? await getProductionRunLineage(ctx, biocharProduct.linkedProductionRunId)
    : null;

  if (biocharProduct && !biocharProduct.linkedProductionRunId) {
    warnings.push(
      "The linked biochar product does not point to a production run yet, so feedstock rollback stops at product level."
    );
  }

  const [reactor, feedstocksForRun] = productionRun
    ? await Promise.all([
        getReactorLineageForRun(ctx, productionRun.id),
        getFeedstocksForRun(ctx, productionRun.id),
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
      evidenceMethod: applicationRow.evidenceMethod,
      gisBoundaryReference: applicationRow.gisBoundaryReference,
      biocharAppliedDryTons: applicationRow.biocharAppliedDryTons,
      soilTemperatureC: applicationRow.applicationSoilTemperatureC,
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
  ctx: OrgContext,
  biocharProductId: string
): Promise<ChainBiocharProductLineage | null> {
  const [product] = await db
    .select({
      id: biocharProducts.id,
      code: biocharProducts.code,
      status: biocharProducts.status,
      productionDate: biocharProducts.productionDate,
      massKg: biocharProducts.massKg,
      moistureContentPercent: biocharProducts.moistureContentPercent,
      formulationName: formulations.name,
      linkedProductionRunId: biocharProducts.linkedProductionRunId,
    })
    .from(biocharProducts)
    .leftJoin(formulations, and(eq(biocharProducts.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
    .where(and(eq(biocharProducts.id, biocharProductId), eq(biocharProducts.organizationId, ctx.organizationId)))
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
  ctx: OrgContext,
  productionRunId: string
): Promise<ChainProductionRunLineage | null> {
  const [productionRun] = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      status: productionRuns.status,
      date: productionRunDateExpr(),
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      feedstockMassDryKg: productionRuns.feedstockMassDryKg,
    })
    .from(productionRuns)
    .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
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
  ctx: OrgContext,
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
    .innerJoin(reactors, and(eq(productionRuns.reactorId, reactors.id), eq(reactors.organizationId, ctx.organizationId)))
    .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
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
  ctx: OrgContext,
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
      eligibilityStatus: feedstocks.eligibilityStatus,
      supplierName: suppliers.name,
      feedstockTypeName: feedstockTypes.name,
      feedstockDeliveryCode: feedstockDeliveries.code,
    })
    .from(productionRunFeedstocks)
    .innerJoin(feedstocks, and(eq(productionRunFeedstocks.feedstockId, feedstocks.id), eq(feedstocks.organizationId, ctx.organizationId)))
    .leftJoin(feedstockDeliveries, and(eq(feedstocks.feedstockDeliveryId, feedstockDeliveries.id), eq(feedstockDeliveries.organizationId, ctx.organizationId)))
    .leftJoin(suppliers, and(eq(feedstocks.supplierId, suppliers.id), eq(suppliers.organizationId, ctx.organizationId)))
    .leftJoin(feedstockTypes, and(eq(feedstocks.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .where(and(eq(productionRunFeedstocks.productionRunId, productionRunId), eq(productionRunFeedstocks.organizationId, ctx.organizationId)));

  return rows.map((row) => ({
    ...row,
    href: "/feedstocks",
  }));
}
