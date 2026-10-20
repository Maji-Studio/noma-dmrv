/**
 * Mirrors attachProductionRunToMatchingCreditBatch through shared helpers.
 * This read-only preview takes no row or advisory locks.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { creditBatchProductionRuns, creditBatches, facilities, feedstockTypes, productionRuns, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { ProductionRunCreditBatchPreviewParsed } from "@/schemas/production-run-credit-batch-preview";
import type { ProductionRunCreditBatchPreview, ProductionRunCreditBatchPreviewBasis } from "@/types/production-run-credit-batch-preview";
import { readCreditBatchMembershipSubmissionLock } from "./credit-batch-certification-lock";
import { creditBatchMemberConflict, findCreditBatchesCoveringDay } from "./credit-batch-membership";
import { facilityInstantDateExpr } from "./production-runs/date-expr";
import { requireOrgScope } from "./utils";

export async function getProductionRunCreditBatchPreview(
  ctx: OrgContext,
  input: ProductionRunCreditBatchPreviewParsed,
): Promise<ProductionRunCreditBatchPreview> {
  requireOrgScope(ctx);
  const member = input.productionRunId
    ? await readMember(ctx, input.productionRunId)
    : null;
  if (member && input.status !== "complete") {
    return { state: "member", batch: member.batch, basis: null, conflict: "reopen" };
  }
  if (!member && (input.status === "failed" || input.status === "cancelled")) {
    return { state: "not-applicable", status: input.status };
  }

  const facts = await readPreviewFacts(ctx, input);
  if (facts.state === "incomplete") {
    return member
      ? { state: "member", batch: member.batch, basis: null, conflict: null }
      : facts;
  }
  const [feedstockType] = facts.types;
  const singleType = facts.types.length === 1;
  const basis: ProductionRunCreditBatchPreviewBasis | null = singleType ? {
    day: facts.day,
    dayBasis: facts.dayBasis,
    facilityName: facts.facility.name,
    timeZone: facts.facility.timezone,
    feedstockTypeName: feedstockType.name,
  } : null;
  if (member) {
    return {
      state: "member", batch: member.batch, basis,
      conflict: creditBatchMemberConflict(member, {
        facilityId: facts.facility.id,
        feedstockTypeId: singleType ? feedstockType.id : null,
        day: facts.day,
      }),
    };
  }
  if (!basis) return { state: "mixed-feedstock", feedstockTypeCount: facts.types.length };

  const batches = await findCreditBatchesCoveringDay(ctx, db, {
    facilityId: facts.facility.id, feedstockTypeId: feedstockType.id, day: facts.day,
  });
  const expected = input.status !== "complete";
  if (batches.length === 0) return { state: "no-match", basis, expected };
  if (batches.length > 1) return { state: "ambiguous", batches, basis, expected };
  const [batch] = batches;
  const locked = await readCreditBatchMembershipSubmissionLock(ctx, db, batch.id);
  return { state: locked ? "locked" : "match", batch, basis, expected };
}

async function readMember(ctx: OrgContext, productionRunId: string) {
  // Joining the run proves the supplied edit ID exists in this organization.
  const [member] = await db.select({
    batch: {
      id: creditBatches.id, code: creditBatches.code,
      startDate: creditBatches.startDate, endDate: creditBatches.endDate,
    },
    facilityId: creditBatches.facilityId,
    feedstockTypeId: creditBatches.feedstockTypeId,
    startDate: creditBatches.startDate,
    endDate: creditBatches.endDate,
  }).from(productionRuns).innerJoin(creditBatchProductionRuns, and(
    eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
    eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
  )).innerJoin(creditBatches, and(
    eq(creditBatches.id, creditBatchProductionRuns.creditBatchId),
    eq(creditBatches.organizationId, ctx.organizationId),
  )).where(and(
    eq(productionRuns.id, productionRunId),
    eq(productionRuns.organizationId, ctx.organizationId),
  )).limit(1);
  return member ?? null;
}

async function readPreviewFacts(ctx: OrgContext, input: ProductionRunCreditBatchPreviewParsed) {
  if (!input.facilityId) return { state: "incomplete", missing: "facility" } as const;
  const [facility] = await db.select({ id: facilities.id, name: facilities.name, timezone: facilities.timezone })
    .from(facilities).where(and(
      eq(facilities.id, input.facilityId), eq(facilities.organizationId, ctx.organizationId),
    ));
  if (!facility) return { state: "incomplete", missing: "facility" } as const;

  const dayBasis = input.status === "complete" || input.endTime ? "end" : "start";
  const instant = dayBasis === "end" ? input.endTime : input.startTime;
  if (!instant) return { state: "incomplete", missing: dayBasis } as const;
  const [date] = await db.select({ day: facilityInstantDateExpr(ctx.organizationId, facility.id, instant) })
    .from(facilities).where(and(
      eq(facilities.id, facility.id), eq(facilities.organizationId, ctx.organizationId),
    ));
  if (!date?.day) return { state: "incomplete", missing: "facility" } as const;

  if (input.feedstockStorageLocationIds.length === 0) return { state: "incomplete", missing: "feedstock" } as const;
  // Intake and stocked-bin identity guards enforce this restriction. This
  // describes the selected bins; save still validates and allocates real stock.
  const types = await db.selectDistinct({ id: feedstockTypes.id, name: feedstockTypes.name })
    .from(storageLocations).innerJoin(feedstockTypes, and(
      eq(feedstockTypes.id, storageLocations.feedstockTypeId),
      eq(feedstockTypes.organizationId, ctx.organizationId),
      eq(feedstockTypes.usage, "pyrolysis"),
    )).where(and(
      eq(storageLocations.organizationId, ctx.organizationId),
      eq(storageLocations.facilityId, facility.id),
      eq(storageLocations.type, "feedstock_bin"),
      isNull(storageLocations.archivedAt),
      inArray(storageLocations.id, input.feedstockStorageLocationIds),
    )).orderBy(feedstockTypes.id);
  if (types.length === 0) return { state: "incomplete", missing: "feedstock" } as const;
  return { state: "resolved", facility, day: date.day, dayBasis, types } as const;
}
