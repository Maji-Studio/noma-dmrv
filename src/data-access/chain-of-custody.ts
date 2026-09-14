/**
 * Chain of custody data access
 * Resolves the upstream lineage for a single application back to its feedstocks.
 */
import { db } from "@/db";
import {
  applicationOutputAllocations,
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
  storageLocations,
  suppliers,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { GisBoundary } from "@/lib/geojson/types";
import { and, eq, inArray } from "drizzle-orm";
import type {
  BatchLineageApplicationFact,
  BatchLineageRunFact,
} from "./credit-batch-accounting";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { requireOrgScope } from "./utils";

const CHAIN_HREFS = {
  application: "/applications",
  delivery: "/deliveries",
  order: "/orders",
  biocharProduct: "/biochar-products",
  productionRun: "/production-runs",
  reactor: "/reactors",
  feedstock: "/feedstocks",
} as const;

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
  evidenceMethod: "location" | "boundary" | "visual";
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gisBoundary: GisBoundary | null;
  biocharAppliedTons?: number | null;
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
  deliveredWetMassKg?: number | null;
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
  biocharStorageName?: string | null;
  biocharOutputKg?: number | null;
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
  wetMassUsedKg: number | null;
  /** Drives the Sankey's derived ineligible-feedstock exit (issue #285). */
  eligibilityStatus: "eligible" | "ineligible" | "conditional" | null;
  supplierName: string | null;
  feedstockTypeName: string | null;
  feedstockDeliveryCode: string | null;
  href: string;
}

export interface ChainSourceLineage {
  productionRun: ChainProductionRunLineage;
  reactor: ChainReactorLineage | null;
  feedstocks: ChainFeedstockLineage[];
  /** Biochar drawn from this run into the product, on both mass bases. */
  allocatedWetMassKg: number | null;
  allocatedDryMassKg: number | null;
}

export interface ChainOfCustodyData {
  facility: ChainFacility;
  application: ChainApplicationLineage;
  delivery: ChainDeliveryLineage;
  order: ChainOrderLineage | null;
  biocharProduct: ChainBiocharProductLineage | null;
  products?: Array<{ product: ChainBiocharProductLineage; sources: ChainSourceLineage[]; allocatedWetMassKg: number; allocatedDryMassKg: number }>;
  productionRun: ChainProductionRunLineage | null;
  reactor: ChainReactorLineage | null;
  feedstocks: ChainFeedstockLineage[];
  /**
   * Every run contributing biochar to the product. The singular fields above
   * remain populated only for a true one-run chain.
   */
  sources?: ChainSourceLineage[];
  warnings: string[];
}

export function projectChainOfCustodyFromBatchFacts(
  application: BatchLineageApplicationFact,
  run: BatchLineageRunFact | undefined,
): ChainOfCustodyData {
  if (!run) {
    throw new SafeError(
      `Application ${application.code} has no linked production run. Link a production run before viewing its traceability.`,
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
      gpsLatitude: application.gpsLatitude,
      gpsLongitude: application.gpsLongitude,
      gisBoundary: application.gisBoundary,
      biocharAppliedTons: application.biocharAppliedTons,
      biocharAppliedDryTons: application.biocharAppliedDryTons,
      soilTemperatureC: application.soilTemperatureC,
      href: CHAIN_HREFS.application,
    },
    delivery: { ...application.delivery, href: CHAIN_HREFS.delivery },
    order: application.order
      ? { ...application.order, href: CHAIN_HREFS.order }
      : null,
    biocharProduct: {
      ...application.biocharProduct,
      href: CHAIN_HREFS.biocharProduct,
    },
    productionRun: {
      id: run.id, code: run.code, status: run.status, date: run.date,
      biocharStorageName: run.biocharStorageName,
      biocharOutputKg: run.biocharOutputKg,
      biocharDryMassKg: run.biocharDryMassKg,
      feedstockMassDryKg: run.feedstockMassDryKg,
      href: CHAIN_HREFS.productionRun,
    },
    reactor: run.reactor
      ? { ...run.reactor, href: CHAIN_HREFS.reactor }
      : null,
    feedstocks: run.feedstocks.map((feedstock) => ({
      ...feedstock,
      href: CHAIN_HREFS.feedstock,
    })),
    sources: [{
      productionRun: {
        id: run.id, code: run.code, status: run.status, date: run.date,
        biocharStorageName: run.biocharStorageName,
        biocharOutputKg: run.biocharOutputKg,
        biocharDryMassKg: run.biocharDryMassKg,
        feedstockMassDryKg: run.feedstockMassDryKg,
        href: CHAIN_HREFS.productionRun,
      },
      reactor: run.reactor
        ? { ...run.reactor, href: CHAIN_HREFS.reactor }
        : null,
      feedstocks: run.feedstocks.map((feedstock) => ({
        ...feedstock,
        href: CHAIN_HREFS.feedstock,
      })),
      allocatedWetMassKg:
        application.sourceAllocation?.allocatedWetMassKg ?? null,
      allocatedDryMassKg:
        application.sourceAllocation?.allocatedDryMassKg ?? null,
    }],
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
      gpsLatitude: applications.gpsLatitude,
      gpsLongitude: applications.gpsLongitude,
      gisBoundary: applications.gisBoundary,
      biocharAppliedTons: applications.biocharAppliedTons,
      biocharAppliedDryTons: applications.biocharAppliedDryTons,
      applicationSoilTemperatureC: applications.soilTemperatureC,
      deliveryId: deliveries.id,
      deliveryCode: deliveries.code,
      deliveryStatus: deliveries.status,
      deliveryDate: deliveries.deliveryDate,
      deliveryWetMassKg: deliveries.deliveredWetMassKg,
      deliveryMassDryKg: deliveries.massDryKg,
      orderId: orders.id,
      orderCode: orders.code,
      orderDate: orders.orderDate,
      orderQuantityKg: orders.quantityKg,
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
  const allocations = await db.select().from(applicationOutputAllocations)
    .where(and(eq(applicationOutputAllocations.applicationId, applicationId), eq(applicationOutputAllocations.organizationId, ctx.organizationId)));
  const products: NonNullable<ChainOfCustodyData["products"]> = [];
  for (const productId of [...new Set(allocations.map(a => a.biocharProductId))].sort()) {
    const product = await getBiocharProductLineage(ctx, productId);
    if (!product) throw new SafeError("Saved application product could not be loaded.");
    const shares = allocations.filter(a => a.biocharProductId === productId);
    const sources: ChainSourceLineage[] = [];
    for (const share of shares) {
      const [productionRun, reactor, feedstocks] = await Promise.all([
        getProductionRunLineage(ctx, share.productionRunId),
        getReactorLineageForRun(ctx, share.productionRunId),
        getFeedstocksForRun(ctx, share.productionRunId),
      ]);
      if (!productionRun) throw new SafeError("Saved application source run could not be loaded.");
      sources.push({ productionRun, reactor, feedstocks, allocatedWetMassKg: Number(share.wetMassKg), allocatedDryMassKg: Number(share.dryMassKg) });
    }
    products.push({ product: { ...product, linkedProductionRunId: sources.length === 1 ? sources[0].productionRun.id : null }, sources,
      allocatedWetMassKg: shares.reduce((n, a) => n + Number(a.wetMassKg), 0),
      allocatedDryMassKg: shares.reduce((n, a) => n + Number(a.dryMassKg), 0) });
  }
  const biocharProduct = products.length === 1 ? products[0].product : null;
  const sources = products.flatMap(p => p.sources);
  const singleSource = sources.length === 1 ? sources[0] : null;
  if (!products.length) warnings.push("This application has no saved delivery source allocations.");

  for (const source of sources) {
    if (source.feedstocks.length === 0) {
      warnings.push(
        `Production run ${source.productionRun.code} does not have any recorded feedstock allocations.`
      );
    }
  }
  const feedstocksForSources = Array.from(
    new Map(
      sources
        .flatMap((source) => source.feedstocks)
        .map((feedstock) => [feedstock.id, feedstock]),
    ).values(),
  );

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
      gpsLatitude: applicationRow.gpsLatitude,
      gpsLongitude: applicationRow.gpsLongitude,
      gisBoundary: applicationRow.gisBoundary,
      biocharAppliedTons: applicationRow.biocharAppliedTons,
      biocharAppliedDryTons: applicationRow.biocharAppliedDryTons,
      soilTemperatureC: applicationRow.applicationSoilTemperatureC,
      href: "/applications",
    },
    delivery: {
      id: applicationRow.deliveryId,
      code: applicationRow.deliveryCode,
      status: applicationRow.deliveryStatus,
      deliveryDate: applicationRow.deliveryDate,
      deliveredWetMassKg: applicationRow.deliveryWetMassKg,
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
    products,
    productionRun: singleSource?.productionRun ?? null,
    reactor: singleSource?.reactor ?? null,
    feedstocks: feedstocksForSources,
    sources,
    warnings,
  };
}

async function getBiocharProductLineage(
  ctx: OrgContext,
  biocharProductId: string
): Promise<ChainBiocharProductLineage | null> {
  requireOrgScope(ctx);
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
  requireOrgScope(ctx);
  const [productionRun] = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      status: productionRuns.status,
      date: productionRunDateExpr(),
      biocharStorageName: storageLocations.name,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      feedstockMassDryKg: productionRuns.feedstockMassDryKg,
    })
    .from(productionRuns)
    .leftJoin(
      storageLocations,
      and(
        eq(productionRuns.biocharStorageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
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
  requireOrgScope(ctx);
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
  requireOrgScope(ctx);
  return (
    await getFeedstocksForRuns(ctx, [productionRunId])
  ).get(productionRunId) ?? [];
}

async function getFeedstocksForRuns(
  ctx: OrgContext,
  productionRunIds: string[],
): Promise<Map<string, ChainFeedstockLineage[]>> {
  requireOrgScope(ctx);
  if (productionRunIds.length === 0) return new Map();
  const rows = await db
    .select({
      productionRunId: productionRunFeedstocks.productionRunId,
      id: feedstocks.id,
      code: feedstocks.code,
      status: feedstocks.status,
      deliveryDate: feedstocks.deliveryDate,
      massDryKg: feedstocks.massDryKg,
      wetMassUsedKg: productionRunFeedstocks.wetMassUsedKg,
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
    .where(
      and(
        inArray(
          productionRunFeedstocks.productionRunId,
          productionRunIds,
        ),
        eq(
          productionRunFeedstocks.organizationId,
          ctx.organizationId,
        ),
      ),
    );

  const byRun = new Map<string, ChainFeedstockLineage[]>();
  for (const { productionRunId, ...row } of rows) {
    const feedstocksForRun = byRun.get(productionRunId) ?? [];
    feedstocksForRun.push({
      ...row,
      href: CHAIN_HREFS.feedstock,
    });
    byRun.set(productionRunId, feedstocksForRun);
  }
  return byRun;
}
