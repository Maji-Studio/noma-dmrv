import { assertRowVersion, nextVersion } from "./row-version";
import { and, asc, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  creditBatches,
  facilities,
  feedstockDeliveries,
  feedstocks,
  feedstockTypes,
  formulationIngredients,
  formulations,
  productionProcesses,
  storageLocations,
  type FeedstockType,
} from "@/db/schema";
import { isPgUniqueViolation } from "@/db/errors";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { conflictCode } from "@/lib/conflict-ref";
import { ActionConflictError, SafeError } from "@/lib/errors";
import {
  getFeedstockTypeDeleteDecision,
  type FeedstockTypeDeleteConflict,
} from "@/lib/feedstock-type-deletion";
import type { IsometricFeedstockType } from "@/lib/isometric";
import {
  categoryMatchesUsage,
  FEEDSTOCK_TYPE_CATEGORY_USAGE_CONFLICT_MESSAGE,
  type CreateFeedstockTypeData,
  type FeedstockCategory,
  type UpdateFeedstockTypeData,
} from "@/schemas/feedstock-types";
import { requireOrgScope } from "./utils";
import { hasCertifierCredentials } from "./certifier-credentials";

const ISOMETRIC_FEEDSTOCK_TYPE_CONSTRAINT =
  "feedstock_types_organization_id_isometric_id_unique";
const FEEDSTOCK_TYPE_NAME_USAGE_CONSTRAINT =
  "feedstock_types_organization_id_name_usage_unique";

const FEEDSTOCK_TYPE_CONFLICT_ENTITY = "feedstockType";

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
  const { feedstockTypeId, expectedVersion, ...changes } = data;
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        version: feedstockTypes.version,
        category: feedstockTypes.category,
        usage: feedstockTypes.usage,
      })
      .from(feedstockTypes)
      .where(
        and(
          eq(feedstockTypes.id, feedstockTypeId),
          eq(feedstockTypes.organizationId, ctx.organizationId),
        ),
      )
      .for("update");

    if (!locked) throw new SafeError("Feedstock type not found.");
    assertRowVersion({ entity: FEEDSTOCK_TYPE_CONFLICT_ENTITY, id: feedstockTypeId, expectedVersion, actualVersion: locked.version });

    // The form refine only fires when a payload carries both halves of the
    // pair. A patch naming one of them has to be judged against the stored
    // row, or "usage only" quietly lands a blend category on a pyrolysis type.
    const effectiveCategory = changes.category ?? locked.category;
    const effectiveUsage = changes.usage ?? locked.usage;
    if (!categoryMatchesUsage(effectiveCategory, effectiveUsage)) {
      throw new SafeError(FEEDSTOCK_TYPE_CATEGORY_USAGE_CONFLICT_MESSAGE);
    }

    const [updated] = await tx
      .update(feedstockTypes)
      .set({
        ...changes,
        version: nextVersion(feedstockTypes.version),
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
  });
}

export async function archiveFeedstockType(
  ctx: OrgContext,
  feedstockTypeId: string,
  expectedVersion: number,
): Promise<FeedstockType> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  return db.transaction(async (tx) => {
    const [versioned] = await tx.select({ version: feedstockTypes.version })
      .from(feedstockTypes)
      .where(and(eq(feedstockTypes.id, feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)))
      .for("update");
    if (!versioned) throw new SafeError("Feedstock type not found");
    assertRowVersion({ entity: FEEDSTOCK_TYPE_CONFLICT_ENTITY, id: feedstockTypeId, expectedVersion, actualVersion: versioned.version });


    const [archived] = await tx
      .update(feedstockTypes)
      .set({ version: nextVersion(feedstockTypes.version), archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(feedstockTypes.id, feedstockTypeId),
          eq(feedstockTypes.organizationId, ctx.organizationId),
        ),
      )
      .returning();
    return archived;

  });
}

export async function unarchiveFeedstockType(
  ctx: OrgContext,
  feedstockTypeId: string,
  expectedVersion: number,
): Promise<FeedstockType> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  return db.transaction(async (tx) => {
    const [versioned] = await tx.select({ version: feedstockTypes.version })
      .from(feedstockTypes)
      .where(and(eq(feedstockTypes.id, feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)))
      .for("update");
    if (!versioned) throw new SafeError("Feedstock type not found");
    assertRowVersion({ entity: FEEDSTOCK_TYPE_CONFLICT_ENTITY, id: feedstockTypeId, expectedVersion, actualVersion: versioned.version });


    const [restored] = await tx
      .update(feedstockTypes)
      .set({ version: nextVersion(feedstockTypes.version), archivedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(feedstockTypes.id, feedstockTypeId),
          eq(feedstockTypes.organizationId, ctx.organizationId),
        ),
      )
      .returning();
    return restored;

  });
}

async function findDeleteConflict(
  ctx: OrgContext,
  tx: DbTransaction,
  feedstockTypeId: string,
): Promise<FeedstockTypeDeleteConflict | null> {
  requireOrgScope(ctx);
  const queries: Array<Promise<FeedstockTypeDeleteConflict[]>> = [
    tx.select({ id: feedstocks.id, code: feedstocks.code })
      .from(feedstocks)
      .where(and(eq(feedstocks.feedstockTypeId, feedstockTypeId), eq(feedstocks.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "feedstock", id: row.id, code: conflictCode(row.code) }))),
    tx.select({ id: feedstockDeliveries.id, code: feedstockDeliveries.code })
      .from(feedstockDeliveries)
      .where(and(eq(feedstockDeliveries.feedstockTypeId, feedstockTypeId), eq(feedstockDeliveries.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "feedstock-delivery", id: row.id, code: conflictCode(row.code) }))),
    // A production process has no code of its own; point at its facility,
    // where the operator manages it.
    tx.select({ id: facilities.id, code: facilities.code })
      .from(productionProcesses)
      .innerJoin(facilities, and(eq(productionProcesses.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
      .where(and(eq(productionProcesses.feedstockTypeId, feedstockTypeId), eq(productionProcesses.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "facility", id: row.id, code: conflictCode(row.code) }))),
    tx.select({ id: creditBatches.id, code: creditBatches.code })
      .from(creditBatches)
      .where(and(eq(creditBatches.feedstockTypeId, feedstockTypeId), eq(creditBatches.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "credit-batch", id: row.id, code: conflictCode(row.code) }))),
    // A formulation ingredient has no code of its own; point at its formulation.
    tx.select({ id: formulations.id, code: formulations.code })
      .from(formulationIngredients)
      .innerJoin(formulations, and(eq(formulationIngredients.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
      .where(and(eq(formulationIngredients.feedstockTypeId, feedstockTypeId), eq(formulationIngredients.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "formulation", id: row.id, code: conflictCode(row.code) }))),
    tx.select({ id: storageLocations.id, code: storageLocations.code })
      .from(storageLocations)
      .where(and(eq(storageLocations.feedstockTypeId, feedstockTypeId), eq(storageLocations.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows.map((row): FeedstockTypeDeleteConflict => ({ entity: "storage-location", id: row.id, code: conflictCode(row.code) }))),
  ];
  const results = await Promise.all(queries);
  return results.flatMap((rows) => rows)[0] ?? null;
}

export async function deleteFeedstockType(
  ctx: OrgContext,
  feedstockTypeId: string,
  expectedVersion: number,
): Promise<{ id: string }> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  return db.transaction(async (tx) => {
    const [versioned] = await tx.select({ version: feedstockTypes.version })
      .from(feedstockTypes)
      .where(and(eq(feedstockTypes.id, feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)))
      .for("update");
    if (!versioned) throw new SafeError("Feedstock type not found");
    assertRowVersion({ entity: FEEDSTOCK_TYPE_CONFLICT_ENTITY, id: feedstockTypeId, expectedVersion, actualVersion: versioned.version });


    const conflict = await findDeleteConflict(ctx, tx, feedstockTypeId);
    const decision = getFeedstockTypeDeleteDecision(conflict ? [conflict] : []);
    if (decision.action === "conflict") {
      throw new ActionConflictError(
        "This feedstock type is in use. Archive it instead.",
        decision.conflict,
      );
    }
    const [deleted] = await tx
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

  });
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
      "Connect this Organization to Isometric before importing feedstock types.",
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
