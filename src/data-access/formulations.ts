/**
 * Formulations Data Access Layer
 * CRUD operations for formulations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import { formulations, type Formulation } from "@/db/schema";
import { biocharProducts } from "@/db/schema/products";
import type { FormulationFilterData } from "@/schemas/formulations";

// ============================================
// Types
// ============================================

export type FormulationWithRelations = Formulation;

export interface PaginatedFormulations {
  items: FormulationWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================
// Auth Guards
// ============================================

/**
 * Require user to be authenticated
 * Throws error if userId is not provided
 */
function requireAuth(userId: string): void {
  if (!userId) {
    throw new Error("Unauthorized");
  }
}

// ============================================
// Formulation Read Operations
// ============================================

/**
 * Get all formulations with pagination and filtering
 * Supports search, sorting, and pagination
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
    compostRatio: formulations.compostRatio,
    createdAt: formulations.createdAt,
    updatedAt: formulations.updatedAt,
  }[sortBy] ?? formulations.name;

  const orderFn = sortOrder === "desc" ? desc : asc;

  // Count total for pagination
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(formulations)
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get formulations
  const formulationList = await db
    .select({
      id: formulations.id,
      code: formulations.code,
      name: formulations.name,
      biocharRatio: formulations.biocharRatio,
      compostRatio: formulations.compostRatio,
      description: formulations.description,
      createdAt: formulations.createdAt,
      updatedAt: formulations.updatedAt,
    })
    .from(formulations)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Combine data (can be extended with computed fields)
  const items: FormulationWithRelations[] = formulationList.map((f) => ({
    ...f,
  }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get a single formulation by ID
 * Returns formulation data without relations
 */
export async function getFormulationById(
  userId: string,
  formulationId: string
): Promise<Formulation> {
  requireAuth(userId);

  const [formulation] = await db
    .select()
    .from(formulations)
    .where(eq(formulations.id, formulationId));

  if (!formulation) {
    throw new Error("Formulation not found");
  }

  return formulation;
}

// ============================================
// Formulation Create Operations
// ============================================

/**
 * Create a new formulation
 */
export async function createFormulation(
  userId: string,
  data: {
    code: string;
    name: string;
    biocharRatio?: number | null;
    compostRatio?: number | null;
    description?: string | null;
  }
): Promise<Formulation> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: formulations.id })
    .from(formulations)
    .where(eq(formulations.code, data.code));

  if (existing) {
    throw new Error("A formulation with this code already exists");
  }

  const [formulation] = await db
    .insert(formulations)
    .values({
      code: data.code,
      name: data.name,
      biocharRatio: data.biocharRatio ?? null,
      compostRatio: data.compostRatio ?? null,
      description: data.description ?? null,
    })
    .returning();

  return formulation;
}

// ============================================
// Formulation Update Operations
// ============================================

/**
 * Update an existing formulation
 */
export async function updateFormulation(
  userId: string,
  formulationId: string,
  data: {
    code?: string;
    name?: string;
    biocharRatio?: number | null;
    compostRatio?: number | null;
    description?: string | null;
  }
): Promise<Formulation> {
  requireAuth(userId);

  // Verify formulation exists
  const [existing] = await db
    .select()
    .from(formulations)
    .where(eq(formulations.id, formulationId));

  if (!existing) {
    throw new Error("Formulation not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: formulations.id })
      .from(formulations)
      .where(eq(formulations.code, data.code));

    if (duplicate) {
      throw new Error("A formulation with this code already exists");
    }
  }

  const [updated] = await db
    .update(formulations)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(formulations.id, formulationId))
    .returning();

  return updated;
}

// ============================================
// Formulation Delete Operations
// ============================================

/**
 * Delete a formulation
 * Will fail if formulation has associated biochar products
 */
export async function deleteFormulation(
  userId: string,
  formulationId: string
): Promise<void> {
  requireAuth(userId);

  // Verify formulation exists
  const [existing] = await db
    .select({ id: formulations.id })
    .from(formulations)
    .where(eq(formulations.id, formulationId));

  if (!existing) {
    throw new Error("Formulation not found");
  }

  const [productCount] = await db
    .select({ count: count() })
    .from(biocharProducts)
    .where(eq(biocharProducts.formulationId, formulationId));

  if (Number(productCount.count) > 0) {
    throw new Error(
      "Cannot delete formulation with associated biochar products. Remove products first."
    );
  }

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
 * Returns minimal data needed for select inputs
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
