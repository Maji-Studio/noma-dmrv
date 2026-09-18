import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import {
  creditBatches,
  creditBatchProductionRuns,
} from "@/db/schema/credits";
import { storageLocations } from "@/db/schema/facilities";
import {
  productionRuns,
  productionRunFeedstocks,
} from "@/db/schema/production";
import { feedstocks } from "@/db/schema/feedstock";
import {
  COMPLETED_PRODUCTION_RUN_STATUS,
  type ProductionRunStatus,
} from "@/lib/production-runs/lifecycle";

import { requireOrgScope } from "./utils";
import { assertCreditBatchProductionWindow } from "./credit-batch-production-window";
import { productionRunDateExpr } from "./production-runs/date-expr";

const CREDIT_BATCH_PREVIEW_PRODUCTION_RUN_STATUSES = [
  "draft",
  "running",
  COMPLETED_PRODUCTION_RUN_STATUS,
] as const;

export interface CreditBatchProductionRunOption {
  id: string;
  code: string;
  date: string;
  status: ProductionRunStatus;
  biocharStorageName: string | null;
  biocharOutputKg: number | null;
  biocharDryMassKg: number | null;
  /**
   * Run-local production-emission inputs, surfaced so the credit-batch form can
   * show a live cohort input summary as runs are (de)selected. These are the
   * front-loaded production-bucket quantities the batch claims (#349, ADR 0020);
   * the registry applies the emission factors (ADR 0018) — noma never holds a
   * CO₂e figure here, only the submitted quantities.
   */
  feedstockMassDryKg: number | null;
  dieselOperationLiters: number | null;
  dieselGensetLiters: number | null;
  preprocessingFuelLiters: number | null;
  electricityKwh: number | null;
  /**
   * The run's DISTINCT feedstock-type ids. A run can consume feedstocks of more
   * than one type (schema 1:N), so this is a set: the form treats a run as a
   * member of a declared-type batch iff its set is exactly `{declaredType}`
   * (single). Empty or multi-type sets can't join a single-feedstock batch
   * (ADR 0016) and are filtered out.
   */
  feedstockTypeIds: string[];
  assignedCreditBatchId: string | null;
  assignedCreditBatchCode: string | null;
}

export async function getCreditBatchProductionRunOptions(
  ctx: OrgContext,
  params: {
    facilityId: string;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
    includeCreditBatchId?: string | null;
  },
): Promise<CreditBatchProductionRunOption[]> {
  requireOrgScope(ctx);

  const conditions = [
    eq(productionRuns.organizationId, ctx.organizationId),
    eq(productionRuns.facilityId, params.facilityId),
    inArray(productionRuns.status, [
      ...CREDIT_BATCH_PREVIEW_PRODUCTION_RUN_STATUSES,
    ]),
    isNull(productionRuns.archivedAt),
  ];

  if (params.startDate && params.endDate) {
    const { startStr, endStr } = assertCreditBatchProductionWindow(
      params.startDate,
      params.endDate,
    );
    conditions.push(
      gte(productionRunDateExpr(), startStr),
      lte(productionRunDateExpr(), endStr),
    );
  }

  if (params.includeCreditBatchId) {
    const assignmentScope = or(
      isNull(creditBatchProductionRuns.creditBatchId),
      eq(creditBatchProductionRuns.creditBatchId, params.includeCreditBatchId),
    );
    if (assignmentScope) conditions.push(assignmentScope);
  }

  const rows = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRunDateExpr(),
      status: productionRuns.status,
      biocharStorageName: storageLocations.name,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      feedstockMassDryKg: productionRuns.feedstockMassDryKg,
      dieselOperationLiters: productionRuns.dieselOperationLiters,
      dieselGensetLiters: productionRuns.dieselGensetLiters,
      preprocessingFuelLiters: productionRuns.preprocessingFuelLiters,
      electricityKwh: productionRuns.electricityKwh,
      assignedCreditBatchId: creditBatchProductionRuns.creditBatchId,
      assignedCreditBatchCode: creditBatches.code,
    })
    .from(productionRuns)
    .leftJoin(
      storageLocations,
      and(
        eq(productionRuns.biocharStorageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      creditBatchProductionRuns,
      and(eq(creditBatchProductionRuns.productionRunId, productionRuns.id), eq(creditBatchProductionRuns.organizationId, ctx.organizationId)),
    )
    .leftJoin(
      creditBatches,
      and(eq(creditBatches.id, creditBatchProductionRuns.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)),
    )
    .where(and(...conditions))
    .orderBy(desc(productionRuns.startTime));

  // Resolve each run's DISTINCT feedstock-type set in a SEPARATE query — joining
  // productionRunFeedstocks into the select above would fan out the row set (a
  // run has N feedstock rows). Attach as a set so the form can scope runs to a
  // single declared feedstock type (ADR 0016).
  const runIds = rows.map((row) => row.id);
  const typeRows = runIds.length
    ? await db
        .selectDistinct({
          productionRunId: productionRunFeedstocks.productionRunId,
          feedstockTypeId: feedstocks.feedstockTypeId,
        })
        .from(productionRunFeedstocks)
        .innerJoin(
          feedstocks,
          and(eq(feedstocks.id, productionRunFeedstocks.feedstockId), eq(feedstocks.organizationId, ctx.organizationId)),
        )
        .where(and(inArray(productionRunFeedstocks.productionRunId, runIds), eq(productionRunFeedstocks.organizationId, ctx.organizationId)))
    : [];
  const typesByRun = new Map<string, string[]>();
  for (const typeRow of typeRows) {
    const list = typesByRun.get(typeRow.productionRunId) ?? [];
    list.push(typeRow.feedstockTypeId);
    typesByRun.set(typeRow.productionRunId, list);
  }

  return rows.map((row) => ({
    ...row,
    feedstockTypeIds: typesByRun.get(row.id) ?? [],
  }));
}
