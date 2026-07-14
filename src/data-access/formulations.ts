/**
 * Formulations Data Access Layer
 * CRUD operations for formulations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, inArray, or, sql, SQL, count } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import {
  feedstockTypes,
  formulations,
  formulationIngredients,
  storageLocations,
  type Formulation,
  type FeedstockType,
  type FormulationIngredient,
} from "@/db/schema";
import { biocharProducts } from "@/db/schema/products";
import {
  RATIO_SUM_EXCEEDED_MESSAGE,
  exceedsFormulationRatioSum,
  type FormulationFilterData,
} from "@/schemas/formulations";

// ============================================
// Types
// ============================================

export type FormulationIngredientWithFeedstockType = FormulationIngredient & {
  feedstockType: FeedstockType;
};

export type FormulationWithIngredients = Formulation & {
  ingredients: FormulationIngredientWithFeedstockType[];
};

export interface PaginatedFormulations {
  items: FormulationWithIngredients[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type IngredientInput = {
  feedstockTypeId: string;
  ratio?: number | null;
};

// ============================================
// Auth Guards
// ============================================

import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import {
  assertFormulationRatioWithinStock,
  lockFormulationRatioRows,
  lockFormulationRatioStock,
} from "./formulation-stock-locks";

async function assertBlendFeedstockTypes(ctx: OrgContext, ingredients?: IngredientInput[]) {
  const feedstockTypeIds = [
    ...new Set((ingredients ?? []).map((ingredient) => ingredient.feedstockTypeId)),
  ];
  if (feedstockTypeIds.length === 0) return;

  const rows = await db
    .select({
      id: feedstockTypes.id,
      usage: feedstockTypes.usage,
    })
    .from(feedstockTypes)
    .where(and(
      inArray(feedstockTypes.id, feedstockTypeIds),
      eq(feedstockTypes.organizationId, ctx.organizationId),
    ));

  if (rows.length !== feedstockTypeIds.length) {
    const returnedIds = new Set(rows.map((row) => row.id));
    const missingIds = feedstockTypeIds.filter((id) => !returnedIds.has(id));
    throw new SafeError(`Blend material(s) not found: ${missingIds.join(", ")}`);
  }

  if (rows.some((row) => row.usage !== "blend")) {
    throw new SafeError("Formulation lines must use blend-usage feedstock types");
  }
}

/**
 * Hard-block a formulation whose biochar + ingredient ratios over-allocate the
 * solid blend (> 100%). Enforced here in addition to the Zod refine because
 * ingredients are child rows the update layer can reconcile against existing
 * state (issue #282).
 */
function assertRatioSumWithinBounds(
  biocharRatio: number | null | undefined,
  ingredients: ReadonlyArray<{ ratio?: number | null }> | null | undefined,
) {
  if (exceedsFormulationRatioSum(biocharRatio, ingredients)) {
    throw new SafeError(RATIO_SUM_EXCEEDED_MESSAGE);
  }
}

// ============================================
// Formulation Read Operations
// ============================================

/**
 * Get all formulations with pagination and filtering
 * Includes ingredient data for each formulation
 */
export async function getFormulations(
  ctx: OrgContext,
  filters?: Partial<FormulationFilterData>
): Promise<PaginatedFormulations> {
  requireOrgScope(ctx);

  const {
    search,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [eq(formulations.organizationId, ctx.organizationId)];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(formulations.code, searchPattern),
        ilike(formulations.name, searchPattern),
        ilike(formulations.description, searchPattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build sort clause
  const sortColumn = {
    code: formulations.code,
    name: formulations.name,
    biocharRatio: formulations.biocharRatio,
    createdAt: formulations.createdAt,
    updatedAt: formulations.updatedAt,
  }[sortBy] ?? formulations.name;

  const orderFn = sortOrder === "desc" ? desc : asc;

  const offset = (page - 1) * pageSize;

  // Run count and list queries in parallel
  const [countResult, formulationList] = await Promise.all([
    db
      .select({ totalCount: count() })
      .from(formulations)
      .where(whereClause),
    db.query.formulations.findMany({
      where: whereClause,
      orderBy: [orderFn(sortColumn)],
      limit: pageSize,
      offset,
      with: {
        ingredients: {
          where: eq(formulationIngredients.organizationId, ctx.organizationId),
          orderBy: [asc(formulationIngredients.sortOrder)],
          with: {
            feedstockType: true,
          },
        },
      },
    }),
  ]);

  const total = Number(countResult[0].totalCount);
  const totalPages = Math.ceil(total / pageSize);

  return {
    items: formulationList,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get a single formulation by ID with ingredients
 */
export async function getFormulationById(
  ctx: OrgContext,
  formulationId: string
): Promise<FormulationWithIngredients> {
  requireOrgScope(ctx);

  const formulation = await db.query.formulations.findFirst({
    where: and(
      eq(formulations.id, formulationId),
      eq(formulations.organizationId, ctx.organizationId),
    ),
    with: {
      ingredients: {
        where: eq(formulationIngredients.organizationId, ctx.organizationId),
        orderBy: [asc(formulationIngredients.sortOrder)],
        with: {
          feedstockType: true,
        },
      },
    },
  });

  if (!formulation) {
    throw new SafeError("Formulation not found");
  }

  return formulation;
}

// ============================================
// Formulation Create Operations
// ============================================

/**
 * Create a new formulation with optional ingredients (transactional)
 */
export async function createFormulation(
  ctx: OrgContext,
  data: {
    code: string;
    name: string;
    biocharRatio?: number | null;
    description?: string | null;
    ingredients?: IngredientInput[];
  }
): Promise<FormulationWithIngredients> {
  requireOrgScope(ctx);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: formulations.id })
    .from(formulations)
    .where(and(
      eq(formulations.code, data.code),
      eq(formulations.organizationId, ctx.organizationId),
    ));

  if (existing) {
    throw new SafeError("A formulation with this code already exists");
  }

  await assertBlendFeedstockTypes(ctx, data.ingredients);
  assertRatioSumWithinBounds(data.biocharRatio, data.ingredients);

  return db.transaction(async (tx) => {
    const [formulation] = await tx
      .insert(formulations)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        name: data.name,
        biocharRatio: data.biocharRatio ?? null,
        description: data.description ?? null,
      })
      .returning();

    let ingredients: FormulationIngredientWithFeedstockType[] = [];

    if (data.ingredients && data.ingredients.length > 0) {
      await tx
        .insert(formulationIngredients)
        .values(
          data.ingredients.map((ing, index) => ({
            organizationId: ctx.organizationId,
            formulationId: formulation.id,
            feedstockTypeId: ing.feedstockTypeId,
            ratio: ing.ratio ?? null,
            sortOrder: index,
          }))
        );

      ingredients = await tx.query.formulationIngredients.findMany({
        where: and(
          eq(formulationIngredients.formulationId, formulation.id),
          eq(formulationIngredients.organizationId, ctx.organizationId),
        ),
        orderBy: [asc(formulationIngredients.sortOrder)],
        with: {
          feedstockType: true,
        },
      });
    }

    return { ...formulation, ingredients };
  });
}

// ============================================
// Formulation Update Operations
// ============================================

/**
 * Update an existing formulation with ingredients (transactional delete-and-reinsert)
 */
export async function updateFormulation(
  ctx: OrgContext,
  formulationId: string,
  data: {
    code?: string;
    name?: string;
    biocharRatio?: number | null;
    description?: string | null;
    ingredients?: IngredientInput[];
  }
): Promise<FormulationWithIngredients> {
  requireOrgScope(ctx);

  // Verify formulation exists
  const [existing] = await db
    .select()
    .from(formulations)
    .where(and(
      eq(formulations.id, formulationId),
      eq(formulations.organizationId, ctx.organizationId),
    ));

  if (!existing) {
    throw new SafeError("Formulation not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: formulations.id })
      .from(formulations)
      .where(and(
        eq(formulations.code, data.code),
        eq(formulations.organizationId, ctx.organizationId),
      ));

    if (duplicate) {
      throw new SafeError("A formulation with this code already exists");
    }
  }

  await assertBlendFeedstockTypes(ctx, data.ingredients);

  // Separate ingredients from formulation fields
  const { ingredients: ingredientData, ...formulationFields } = data;

  return db.transaction(async (tx) => {
    const ratioLockPreparation = data.biocharRatio !== undefined
      ? await lockFormulationRatioStock(ctx, tx, formulationId)
      : null;

    // Lock the parent row so concurrent updates serialize and the ratio guard
    // below always reconciles against the latest committed state — validating
    // outside the transaction lets two partial updates (one changing the
    // biochar ratio, one changing ingredients) jointly commit > 100%.
    const [locked] = await tx
      .select()
      .from(formulations)
      .where(and(
        eq(formulations.id, formulationId),
        eq(formulations.organizationId, ctx.organizationId),
      ))
      .for("update");

    if (!locked) {
      throw new SafeError("Formulation not found");
    }

    // Guard the effective post-update blend: a partial payload may change only
    // the biochar ratio or only the ingredients, so reconcile each side against
    // what is already stored before checking the sum.
    const effectiveBiocharRatio =
      data.biocharRatio !== undefined ? data.biocharRatio : locked.biocharRatio;
    const effectiveIngredients =
      ingredientData !== undefined
        ? ingredientData
        : await tx
            .select({ ratio: formulationIngredients.ratio })
            .from(formulationIngredients)
            .where(and(
              eq(formulationIngredients.formulationId, formulationId),
              eq(formulationIngredients.organizationId, ctx.organizationId),
            ));
    assertRatioSumWithinBounds(effectiveBiocharRatio, effectiveIngredients);

    const biocharRatioChanged =
      data.biocharRatio !== undefined &&
      data.biocharRatio !== locked.biocharRatio;
    const ratioStockState = biocharRatioChanged && ratioLockPreparation
      ? await lockFormulationRatioRows(
          ctx,
          tx,
          formulationId,
          ratioLockPreparation,
        )
      : [];

    const [updated] = await tx
      .update(formulations)
      .set({
        ...formulationFields,
        updatedAt: new Date(),
      })
      .where(and(
        eq(formulations.id, formulationId),
        eq(formulations.organizationId, ctx.organizationId),
      ))
      .returning();

    await assertFormulationRatioWithinStock(ctx, tx, ratioStockState);

    let ingredients: FormulationIngredientWithFeedstockType[] = [];

    // If ingredients are provided, delete-and-reinsert
    if (ingredientData !== undefined) {
      await tx
        .delete(formulationIngredients)
        .where(and(
          eq(formulationIngredients.formulationId, formulationId),
          eq(formulationIngredients.organizationId, ctx.organizationId),
        ));

      if (ingredientData.length > 0) {
        await tx
          .insert(formulationIngredients)
          .values(
            ingredientData.map((ing, index) => ({
              organizationId: ctx.organizationId,
              formulationId: formulationId,
              feedstockTypeId: ing.feedstockTypeId,
              ratio: ing.ratio ?? null,
              sortOrder: index,
            }))
          );
      }

      ingredients = await tx.query.formulationIngredients.findMany({
        where: and(
          eq(formulationIngredients.formulationId, formulationId),
          eq(formulationIngredients.organizationId, ctx.organizationId),
        ),
        orderBy: [asc(formulationIngredients.sortOrder)],
        with: {
          feedstockType: true,
        },
      });
    } else {
      // If ingredients not provided, fetch existing ones
      ingredients = await tx.query.formulationIngredients.findMany({
        where: and(
          eq(formulationIngredients.formulationId, formulationId),
          eq(formulationIngredients.organizationId, ctx.organizationId),
        ),
        orderBy: [asc(formulationIngredients.sortOrder)],
        with: {
          feedstockType: true,
        },
      });
    }

    return { ...updated, ingredients };
  });
}

// ============================================
// Formulation Delete Operations
// ============================================

/**
 * Delete a formulation (ingredients cascade via FK)
 * Will fail if formulation has associated biochar products
 */
export async function deleteFormulation(
  ctx: OrgContext,
  formulationId: string
): Promise<void> {
  requireOrgScope(ctx);

  const [existingResult, productCountResult, binCountResult] = await Promise.all([
    db
      .select({ id: formulations.id })
      .from(formulations)
      .where(and(eq(formulations.id, formulationId), eq(formulations.organizationId, ctx.organizationId))),
    db
      .select({ count: count() })
      .from(biocharProducts)
      .where(and(eq(biocharProducts.formulationId, formulationId), eq(biocharProducts.organizationId, ctx.organizationId))),
    db
      .select({ count: count() })
      .from(storageLocations)
      .where(and(eq(storageLocations.formulationId, formulationId), eq(storageLocations.organizationId, ctx.organizationId))),
  ]);

  if (existingResult.length === 0) {
    throw new SafeError("Formulation not found");
  }

  if (Number(productCountResult[0].count) > 0) {
    throw new SafeError(
      "Cannot delete formulation with associated biochar products. Remove products first."
    );
  }

  if (Number(binCountResult[0].count) > 0) {
    throw new SafeError(
      "Cannot delete formulation used by product bins. Clear those bins first."
    );
  }

  // Ingredients cascade-delete via FK onDelete: 'cascade'
  await db.delete(formulations).where(and(
    eq(formulations.id, formulationId),
    eq(formulations.organizationId, ctx.organizationId),
  ));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a formulation code is available
 */
export async function isFormulationCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeFormulationId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [
    eq(formulations.organizationId, ctx.organizationId),
    eq(formulations.code, code),
  ];

  if (excludeFormulationId) {
    conditions.push(sql`${formulations.id} != ${excludeFormulationId}`);
  }

  // org-scope-ok: organization predicate is composed in conditions above.
  const [existing] = await db
    .select({ id: formulations.id })
    .from(formulations)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get formulation options for dropdowns
 */
export async function getFormulationOptions(
  ctx: OrgContext
): Promise<Array<{ id: string; code: string; name: string }>> {
  requireOrgScope(ctx);

  return db
    .select({
      id: formulations.id,
      code: formulations.code,
      name: formulations.name,
    })
    .from(formulations)
    .where(eq(formulations.organizationId, ctx.organizationId))
    .orderBy(asc(formulations.name));
}
