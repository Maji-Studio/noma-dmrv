/**
 * Formulations Data Access Layer
 * Read operations for formulations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, or, SQL, count, isNull, isNotNull } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import {
  formulations,
  formulationIngredients,
  type Formulation,
  type FeedstockType,
  type FormulationIngredient,
} from "@/db/schema";
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

// ============================================
// Auth Guards
// ============================================

import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";

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
    archived = false,
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [
    eq(formulations.organizationId, ctx.organizationId),
    archived ? isNotNull(formulations.archivedAt) : isNull(formulations.archivedAt),
  ];

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
