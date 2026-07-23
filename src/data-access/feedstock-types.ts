import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  creditBatches,
  feedstockDeliveries,
  feedstocks,
  feedstockTypes,
  formulationIngredients,
  productionProcesses,
  storageLocations,
  type FeedstockType,
} from "@/db/schema";
import { isPgUniqueViolation } from "@/db/errors";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { ActionConflictError, SafeError } from "@/lib/errors";
import {
  getFeedstockTypeDeleteDecision,
  type FeedstockTypeDeleteConflict,
} from "@/lib/feedstock-type-deletion";
import type { IsometricFeedstockType } from "@/lib/isometric";
import type {
  CreateFeedstockTypeData,
  FeedstockCategory,
  UpdateFeedstockTypeData,
} from "@/schemas/feedstock-types";
import { assertSameOrg, requireOrgScope } from "./utils";
import { hasCertifierCredentials } from "./certifier-credentials";

const ISOMETRIC_FEEDSTOCK_TYPE_CONSTRAINT =
  "feedstock_types_organization_id_isometric_id_unique";
const FEEDSTOCK_TYPE_NAME_USAGE_CONSTRAINT =
  "feedstock_types_organization_id_name_usage_unique";

export async function listFeedstockTypes(
  ctx: OrgContext,
): Promise<FeedstockType[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(feedstockTypes)
    .where(eq(feedstockTypes.organizationId, ctx.organizationId))
    .orderBy(asc(feedstockTypes.name));
}

export async function createFeedstockType(
  ctx: OrgContext,
  data: CreateFeedstockTypeData & { code: string },
): Promise<FeedstockType> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  const [created] = await db
    .insert(feedstockTypes)
    .values({
      organizationId: ctx.organizationId,
      code: data.code,
      name: data.name.trim(),
      category: data.category,
      usage: data.usage,
      description: data.description || null,
      registryUrl: data.registryUrl || null,
      isometricFeedstockTypeId: data.isometricFeedstockTypeId || null,
    })
    .returning();
  return created;
}

export async function updateFeedstockType(
  ctx: OrgContext,
  data: UpdateFeedstockTypeData,
): Promise<FeedstockType> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  await assertSameOrg(ctx, feedstockTypes, data.feedstockTypeId);
  const { feedstockTypeId, ...changes } = data;
  const [updated] = await db
    .update(feedstockTypes)
    .set({
      ...changes,
      name: changes.name?.trim(),
      description:
        changes.description === undefined ? undefined : changes.description || null,
      registryUrl:
        changes.registryUrl === undefined ? undefined : changes.registryUrl || null,
      isometricFeedstockTypeId:
        changes.isometricFeedstockTypeId === undefined
          ? undefined
          : changes.isometricFeedstockTypeId || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(feedstockTypes.id, feedstockTypeId),
        eq(feedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  return updated;
}

export async function archiveFeedstockType(
  ctx: OrgContext,
  feedstockTypeId: string,
): Promise<FeedstockType> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  await assertSameOrg(ctx, feedstockTypes, feedstockTypeId);
  const [archived] = await db
    .update(feedstockTypes)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(feedstockTypes.id, feedstockTypeId),
        eq(feedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  return archived;
}

export async function unarchiveFeedstockType(
  ctx: OrgContext,
  feedstockTypeId: string,
): Promise<FeedstockType> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  await assertSameOrg(ctx, feedstockTypes, feedstockTypeId);
  const [restored] = await db
    .update(feedstockTypes)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(feedstockTypes.id, feedstockTypeId),
        eq(feedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  return restored;
}

async function findDeleteConflict(
  ctx: OrgContext,
  feedstockTypeId: string,
): Promise<FeedstockTypeDeleteConflict | null> {
  const queries: Array<Promise<FeedstockTypeDeleteConflict[]>> = [
    db.select({ id: feedstocks.id, code: feedstocks.code })
      .from(feedstocks)
      .where(and(eq(feedstocks.feedstockTypeId, feedstockTypeId), eq(feedstocks.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "feedstock", id: row.id, code: row.code }))),
    db.select({ id: feedstockDeliveries.id, code: feedstockDeliveries.code })
      .from(feedstockDeliveries)
      .where(and(eq(feedstockDeliveries.feedstockTypeId, feedstockTypeId), eq(feedstockDeliveries.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "feedstock-delivery", id: row.id, code: row.code }))),
    db.select({ id: productionProcesses.id })
      .from(productionProcesses)
      .where(and(eq(productionProcesses.feedstockTypeId, feedstockTypeId), eq(productionProcesses.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "production-process", id: row.id, code: row.id }))),
    db.select({ id: creditBatches.id, code: creditBatches.code })
      .from(creditBatches)
      .where(and(eq(creditBatches.feedstockTypeId, feedstockTypeId), eq(creditBatches.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "credit-batch", id: row.id, code: row.code }))),
    db.select({ id: formulationIngredients.id })
      .from(formulationIngredients)
      .where(and(eq(formulationIngredients.feedstockTypeId, feedstockTypeId), eq(formulationIngredients.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "formulation-ingredient", id: row.id, code: row.id }))),
    db.select({ id: storageLocations.id, code: storageLocations.code })
      .from(storageLocations)
      .where(and(eq(storageLocations.feedstockTypeId, feedstockTypeId), eq(storageLocations.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "storage-location", id: row.id, code: row.code }))),
  ];
  const results = await Promise.all(queries);
  return results.flatMap((rows) => rows)[0] ?? null;
}

export async function deleteFeedstockType(
  ctx: OrgContext,
  feedstockTypeId: string,
): Promise<{ id: string }> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  await assertSameOrg(ctx, feedstockTypes, feedstockTypeId);
  const conflict = await findDeleteConflict(ctx, feedstockTypeId);
  const decision = getFeedstockTypeDeleteDecision(conflict ? [conflict] : []);
  if (decision.action === "conflict") {
    throw new ActionConflictError(
      "This feedstock type is in use. Archive it instead.",
      decision.conflict,
    );
  }
  const [deleted] = await db
    .delete(feedstockTypes)
    .where(
      and(
        eq(feedstockTypes.id, feedstockTypeId),
        eq(feedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .returning({ id: feedstockTypes.id });
  if (!deleted) throw new SafeError("Feedstock type not found.");
  return deleted;
}

export async function importIsometricFeedstockType(
  ctx: OrgContext,
  entry: IsometricFeedstockType,
  category: FeedstockCategory,
  code: string,
): Promise<FeedstockType> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  if (!(await hasCertifierCredentials(ctx, "isometric"))) {
    throw new SafeError(
      "Connect this organization to Isometric before importing feedstock types.",
    );
  }
  const [existingImport] = await db
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(
      and(
        eq(feedstockTypes.organizationId, ctx.organizationId),
        eq(feedstockTypes.isometricFeedstockTypeId, entry.id),
      ),
    )
    .limit(1);
  if (existingImport) {
    throw new SafeError(
      "This Isometric feedstock type has already been imported.",
    );
  }
  try {
    const [created] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: ctx.organizationId,
        code,
        name: entry.name.trim(),
        category,
        usage: "pyrolysis",
        isometricFeedstockTypeId: entry.id,
      })
      .returning();
    return created;
  } catch (error) {
    if (isPgUniqueViolation(error, ISOMETRIC_FEEDSTOCK_TYPE_CONSTRAINT)) {
      throw new SafeError(
        "This Isometric feedstock type has already been imported.",
      );
    }
    if (isPgUniqueViolation(error, FEEDSTOCK_TYPE_NAME_USAGE_CONSTRAINT)) {
      throw new SafeError(
        "A pyrolysis feedstock type with this name already exists.",
      );
    }
    throw error;
  }
}

export async function listActiveFeedstockTypes(
  ctx: OrgContext,
): Promise<FeedstockType[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(feedstockTypes)
    .where(
      and(
        eq(feedstockTypes.organizationId, ctx.organizationId),
        isNull(feedstockTypes.archivedAt),
      ),
    );
}
