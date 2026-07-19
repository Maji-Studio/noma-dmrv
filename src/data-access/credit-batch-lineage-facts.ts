import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  applications,
  biocharProducts,
  creditBatchProductionRuns,
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
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { requireOrgScope } from "./utils";

type Executor = DbTransaction | typeof db;

export interface BatchLineageFeedstockFact {
  id: string;
  code: string;
  status: string | null;
  deliveryDate: Date | null;
  massDryKg: number | null;
  massUsedKg: number | null;
  eligibilityStatus: "eligible" | "ineligible" | "conditional" | null;
  supplierName: string | null;
  feedstockTypeName: string | null;
  feedstockDeliveryCode: string | null;
}

export interface BatchLineageRunFact {
  id: string;
  code: string;
  status: string | null;
  date: Date | string;
  biocharDryMassKg: number | null;
  feedstockMassDryKg: number | null;
  reactor: {
    id: string;
    code: string;
    identifier: string;
    reactorType: string | null;
  } | null;
  feedstocks: BatchLineageFeedstockFact[];
}

export interface BatchLineageApplicationFact {
  id: string;
  code: string;
  status: string | null;
  applicationDate: Date;
  fieldIdentifier: string | null;
  evidenceMethod: "visual" | "boundary";
  gisBoundaryReference: string | null;
  biocharAppliedTons: number;
  biocharAppliedDryTons: number | null;
  soilTemperatureC: number | null;
  facility: { id: string; code: string; name: string };
  delivery: {
    id: string;
    code: string;
    status: string | null;
    deliveryDate: Date;
    massDryKg: number | null;
  };
  order: {
    id: string;
    code: string;
    orderDate: Date;
    quantityKg: number | null;
  } | null;
  biocharProduct: {
    id: string;
    code: string;
    status: string | null;
    productionDate: Date;
    massKg: number | null;
    moistureContentPercent: number | null;
    formulationName: string | null;
    linkedProductionRunId: string;
  };
}

export interface CreditBatchLineageFacts {
  batchId: string;
  productionRunIds: string[];
  runs: BatchLineageRunFact[];
  applications: BatchLineageApplicationFact[];
  applicationIds: string[];
  appliedWeightTons: number;
}

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

/** Three set-based queries regardless of batch/application count. */
export async function loadCreditBatchLineageFacts(
  ctx: OrgContext,
  batchIds: string[],
  executor: Executor = db,
  options?: { onQuery?: () => void },
): Promise<Record<string, CreditBatchLineageFacts>> {
  requireOrgScope(ctx);
  const ids = uniqueSorted(batchIds);
  if (ids.length === 0) return {};

  if (executor === db) {
    return db.transaction((tx) =>
      loadCreditBatchLineageFacts(ctx, ids, tx, options),
    );
  }

  options?.onQuery?.();
  const membershipRows = await executor
    .select({
      batchId: creditBatchProductionRuns.creditBatchId,
      runId: productionRuns.id,
      runCode: productionRuns.code,
      runStatus: productionRuns.status,
      runDate: productionRunDateExpr(),
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      feedstockMassDryKg: productionRuns.feedstockMassDryKg,
      reactorId: reactors.id,
      reactorCode: reactors.code,
      reactorIdentifier: reactors.identifier,
      reactorType: reactors.reactorType,
    })
    .from(creditBatchProductionRuns)
    .innerJoin(
      productionRuns,
      and(
        eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
        eq(productionRuns.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      reactors,
      and(
        eq(productionRuns.reactorId, reactors.id),
        eq(reactors.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(creditBatchProductionRuns.creditBatchId, ids),
        eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      ),
    );

  const runIds = uniqueSorted(membershipRows.map((row) => row.runId));
  if (runIds.length) options?.onQuery?.();
  const applicationRows = runIds.length
    ? await executor
        .select({
          id: applications.id,
          code: applications.code,
          status: applications.status,
          applicationDate: applications.applicationDate,
          fieldIdentifier: applications.fieldIdentifier,
          evidenceMethod: applications.evidenceMethod,
          gisBoundaryReference: applications.gisBoundaryReference,
          biocharAppliedTons: applications.biocharAppliedTons,
          biocharAppliedDryTons: applications.biocharAppliedDryTons,
          soilTemperatureC: applications.soilTemperatureC,
          facilityId: facilities.id,
          facilityCode: facilities.code,
          facilityName: facilities.name,
          deliveryId: deliveries.id,
          deliveryCode: deliveries.code,
          deliveryStatus: deliveries.status,
          deliveryDate: deliveries.deliveryDate,
          deliveryMassDryKg: deliveries.massDryKg,
          orderId: orders.id,
          orderCode: orders.code,
          orderDate: orders.orderDate,
          orderQuantityKg: orders.quantityKg,
          productId: biocharProducts.id,
          productCode: biocharProducts.code,
          productStatus: biocharProducts.status,
          productionDate: biocharProducts.productionDate,
          productMassKg: biocharProducts.massKg,
          productMoisturePercent: biocharProducts.moistureContentPercent,
          formulationName: formulations.name,
          linkedProductionRunId: biocharProducts.linkedProductionRunId,
        })
        .from(applications)
        .innerJoin(
          deliveries,
          and(
            eq(applications.deliveryId, deliveries.id),
            eq(deliveries.organizationId, ctx.organizationId),
          ),
        )
        .leftJoin(
          orders,
          and(
            eq(deliveries.orderId, orders.id),
            eq(orders.organizationId, ctx.organizationId),
          ),
        )
        .innerJoin(
          biocharProducts,
          and(
            sql`${biocharProducts.id} = coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
            eq(biocharProducts.organizationId, ctx.organizationId),
          ),
        )
        .leftJoin(
          formulations,
          and(
            eq(biocharProducts.formulationId, formulations.id),
            eq(formulations.organizationId, ctx.organizationId),
          ),
        )
        .innerJoin(
          facilities,
          and(
            eq(deliveries.facilityId, facilities.id),
            eq(facilities.organizationId, ctx.organizationId),
          ),
        )
        .where(
          and(
            inArray(biocharProducts.linkedProductionRunId, runIds),
            eq(applications.organizationId, ctx.organizationId),
          ),
        )
    : [];

  if (runIds.length) options?.onQuery?.();
  const feedstockRows = runIds.length
    ? await executor
        .select({
          runId: productionRunFeedstocks.productionRunId,
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
        .innerJoin(
          feedstocks,
          and(
            eq(productionRunFeedstocks.feedstockId, feedstocks.id),
            eq(feedstocks.organizationId, ctx.organizationId),
          ),
        )
        .leftJoin(feedstockDeliveries, and(eq(feedstocks.feedstockDeliveryId, feedstockDeliveries.id), eq(feedstockDeliveries.organizationId, ctx.organizationId)))
        .leftJoin(suppliers, and(eq(feedstocks.supplierId, suppliers.id), eq(suppliers.organizationId, ctx.organizationId)))
        .leftJoin(feedstockTypes, and(eq(feedstocks.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
        .where(and(inArray(productionRunFeedstocks.productionRunId, runIds), eq(productionRunFeedstocks.organizationId, ctx.organizationId)))
    : [];

  const feedstocksByRun = new Map<string, BatchLineageFeedstockFact[]>();
  for (const row of feedstockRows) {
    const facts = feedstocksByRun.get(row.runId) ?? [];
    facts.push({ ...row });
    feedstocksByRun.set(row.runId, facts);
  }
  const runById = new Map<string, BatchLineageRunFact>();
  for (const row of membershipRows) {
    if (runById.has(row.runId)) continue;
    runById.set(row.runId, {
      id: row.runId,
      code: row.runCode,
      status: row.runStatus,
      date: row.runDate,
      biocharDryMassKg: row.biocharDryMassKg,
      feedstockMassDryKg: row.feedstockMassDryKg,
      reactor: row.reactorId
        ? { id: row.reactorId, code: row.reactorCode!, identifier: row.reactorIdentifier!, reactorType: row.reactorType }
        : null,
      feedstocks: (feedstocksByRun.get(row.runId) ?? []).sort((a, b) => a.id.localeCompare(b.id)),
    });
  }

  const applicationsByRun = new Map<string, BatchLineageApplicationFact[]>();
  for (const row of applicationRows) {
    if (!row.linkedProductionRunId) {
      throw new SafeError(`Application ${row.id} has missing production lineage`);
    }
    const facts = applicationsByRun.get(row.linkedProductionRunId) ?? [];
    facts.push({
      id: row.id, code: row.code, status: row.status,
      applicationDate: row.applicationDate, fieldIdentifier: row.fieldIdentifier,
      evidenceMethod: row.evidenceMethod, gisBoundaryReference: row.gisBoundaryReference,
      biocharAppliedTons: row.biocharAppliedTons,
      biocharAppliedDryTons: row.biocharAppliedDryTons, soilTemperatureC: row.soilTemperatureC,
      facility: { id: row.facilityId, code: row.facilityCode, name: row.facilityName },
      delivery: { id: row.deliveryId, code: row.deliveryCode, status: row.deliveryStatus, deliveryDate: row.deliveryDate, massDryKg: row.deliveryMassDryKg },
      order: row.orderId ? { id: row.orderId, code: row.orderCode!, orderDate: row.orderDate!, quantityKg: row.orderQuantityKg } : null,
      biocharProduct: { id: row.productId, code: row.productCode, status: row.productStatus, productionDate: row.productionDate, massKg: row.productMassKg, moistureContentPercent: row.productMoisturePercent, formulationName: row.formulationName, linkedProductionRunId: row.linkedProductionRunId },
    });
    applicationsByRun.set(row.linkedProductionRunId, facts);
  }

  return Object.fromEntries(ids.map((batchId) => {
    const productionRunIds = uniqueSorted(membershipRows.filter((row) => row.batchId === batchId).map((row) => row.runId));
    const applications = Array.from(new Map(productionRunIds.flatMap((runId) => applicationsByRun.get(runId) ?? []).map((app) => [app.id, app])).values()).sort((a, b) => a.id.localeCompare(b.id));
    return [batchId, {
      batchId,
      productionRunIds,
      runs: productionRunIds.map((runId) => runById.get(runId)).filter((run): run is BatchLineageRunFact => !!run),
      applications,
      applicationIds: applications.map((app) => app.id),
      appliedWeightTons: applications.reduce((total, app) => total + app.biocharAppliedTons, 0),
    }];
  }));
}
