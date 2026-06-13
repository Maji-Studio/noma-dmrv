/**
 * Formulations Data Access Layer
 * CRUD operations for formulations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, inArray, or, sql, SQL, count } from "drizzle-orm";
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
import type { FormulationFilterData } from "@/schemas/formulations";

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

import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";

async function assertBlendFeedstockTypes(ingredients?: IngredientInput[]) {
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
    .where(inArray(feedstockTypes.id, feedstockTypeIds));

  if (rows.length !== feedstockTypeIds.length) {
    throw new SafeError("Blend material not found");
  }

  if (rows.some((row) => row.usage !== "blend")) {
    throw new SafeError("Formulation lines must use blend-usage feedstock types");
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
  userId: string,
  filters?: Partial<FormulationFilterData>
): Promise<PaginatedFormulations> {
  requireAuth(userId);

  const {
    search,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [];

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
  userId: string,
  formulationId: string
): Promise<FormulationWithIngredients> {
  requireAuth(userId);

  const formulation = await db.query.formulations.findFirst({
    where: eq(formulations.id, formulationId),
    with: {
      ingredients: {
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
  userId: string,
  data: {
    code: string;
    name: string;
    biocharRatio?: number | null;
    description?: string | null;
    ingredients?: IngredientInput[];
  }
): Promise<FormulationWithIngredients> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: formulations.id })
    .from(formulations)
    .where(eq(formulations.code, data.code));

  if (existing) {
    throw new SafeError("A formulation with this code already exists");
  }

  await assertBlendFeedstockTypes(data.ingredients);

  return db.transaction(async (tx) => {
    const [formulation] = await tx
      .insert(formulations)
      .values({
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
            formulationId: formulation.id,
            feedstockTypeId: ing.feedstockTypeId,
            ratio: ing.ratio ?? null,
            sortOrder: index,
          }))
        );

      ingredients = await tx.query.formulationIngredients.findMany({
        where: eq(formulationIngredients.formulationId, formulation.id),
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
  userId: string,
  formulationId: string,
  data: {
    code?: string;
    name?: string;
    biocharRatio?: number | null;
    description?: string | null;
    ingredients?: IngredientInput[];
  }
): Promise<FormulationWithIngredients> {
  requireAuth(userId);

  // Verify formulation exists
  const [existing] = await db
    .select()
    .from(formulations)
    .where(eq(formulations.id, formulationId));

  if (!existing) {
    throw new SafeError("Formulation not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: formulations.id })
      .from(formulations)
      .where(eq(formulations.code, data.code));

    if (duplicate) {
      throw new SafeError("A formulation with this code already exists");
    }
  }

  await assertBlendFeedstockTypes(data.ingredients);

  // Separate ingredients from formulation fields
  const { ingredients: ingredientData, ...formulationFields } = data;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(formulations)
      .set({
        ...formulationFields,
        updatedAt: new Date(),
      })
      .where(eq(formulations.id, formulationId))
      .returning();

    let ingredients: FormulationIngredientWithFeedstockType[] = [];

    // If ingredients are provided, delete-and-reinsert
    if (ingredientData !== undefined) {
      await tx
        .delete(formulationIngredients)
        .where(eq(formulationIngredients.formulationId, formulationId));

      if (ingredientData.length > 0) {
        await tx
          .insert(formulationIngredients)
          .values(
            ingredientData.map((ing, index) => ({
              formulationId: formulationId,
              feedstockTypeId: ing.feedstockTypeId,
              ratio: ing.ratio ?? null,
              sortOrder: index,
            }))
          );
      }

      ingredients = await tx.query.formulationIngredients.findMany({
        where: eq(formulationIngredients.formulationId, formulationId),
        orderBy: [asc(formulationIngredients.sortOrder)],
        with: {
          feedstockType: true,
        },
      });
    } else {
      // If ingredients not provided, fetch existing ones
      ingredients = await tx.query.formulationIngredients.findMany({
        where: eq(formulationIngredients.formulationId, formulationId),
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
  userId: string,
  formulationId: string
): Promise<void> {
  requireAuth(userId);

  const [existingResult, productCountResult, binCountResult] = await Promise.all([
    db
      .select({ id: formulations.id })
      .from(formulations)
      .where(eq(formulations.id, formulationId)),
    db
      .select({ count: count() })
      .from(biocharProducts)
      .where(eq(biocharProducts.formulationId, formulationId)),
    db
      .select({ count: count() })
      .from(storageLocations)
      .where(eq(storageLocations.formulationId, formulationId)),
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
  await db.delete(formulations).where(eq(formulations.id, formulationId));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a formulation code is available
 */
export async function isFormulationCodeAvailable(
  userId: string,
  code: string,
  excludeFormulationId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(formulations.code, code)];

  if (excludeFormulationId) {
    conditions.push(sql`${formulations.id} != ${excludeFormulationId}`);
  }

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
  userId: string
): Promise<Array<{ id: string; code: string; name: string }>> {
  requireAuth(userId);

  return db
    .select({
      id: formulations.id,
      code: formulations.code,
      name: formulations.name,
    })
    .from(formulations)
    .orderBy(asc(formulations.name));
}
