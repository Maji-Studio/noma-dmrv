/**
 * Reactors Data Access Layer
 * CRUD operations for reactors with auth guards, pagination, and filtering
 * Includes Method B eligibility calculation
 */

import { and, asc, desc, eq, ilike, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import {
  reactors,
  facilities,
  type Reactor,
} from "@/db/schema";
import {
  getMethodBEligibilityByReactor,
  METHOD_B_MINIMUM_METHOD_A_SAMPLES,
  type MethodBEligibilitySummary,
} from "@/data-access/isometric";
import type { ReactorFilterData } from "@/schemas/reactors";

// ============================================
// Types
// ============================================

export interface ReactorWithRelations extends Reactor {
  facilityCode: string;
  facilityName: string;
  methodBEligibility: MethodBEligibilitySummary;
}

export interface PaginatedReactors {
  items: ReactorWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================
// Auth Guards
// ============================================

import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";

// ============================================
// Read Operations
// ============================================

/**
 * Get all reactors with pagination and filtering
 * Supports search, facility filter, sampling method filter, sorting, and pagination
 */
export async function getReactors(
  userId: string,
  filters?: Partial<ReactorFilterData>
): Promise<PaginatedReactors> {
  requireAuth(userId);

  const {
    search,
    facilityId,
    samplingMethod,
    reactorType,
    page = 1,
    pageSize = 20,
    sortBy = "code",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(reactors.code, searchPattern),
        ilike(reactors.identifier, searchPattern),
        ilike(reactors.reactorType, searchPattern)
      )!
    );
  }

  if (facilityId) {
    conditions.push(eq(reactors.facilityId, facilityId));
  }

  if (samplingMethod) {
    conditions.push(eq(reactors.samplingMethod, samplingMethod));
  }

  if (reactorType) {
    conditions.push(eq(reactors.reactorType, reactorType));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build sort clause
  const sortColumn = {
    code: reactors.code,
    identifier: reactors.identifier,
    reactorType: reactors.reactorType,
    createdAt: reactors.createdAt,
    updatedAt: reactors.updatedAt,
  }[sortBy] ?? reactors.code;

  const orderFn = sortOrder === "desc" ? desc : asc;

  // Count total for pagination
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(reactors)
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get reactors with facility info
  const reactorList = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      facilityId: reactors.facilityId,
      reactorType: reactors.reactorType,
      samplingMethod: reactors.samplingMethod,
      nominalThroughputTph: reactors.nominalThroughputTph,
      specifications: reactors.specifications,
      createdAt: reactors.createdAt,
      updatedAt: reactors.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
    })
    .from(reactors)
    .leftJoin(facilities, eq(reactors.facilityId, facilities.id))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Get Method B eligibility for each reactor
  const items: ReactorWithRelations[] = await Promise.all(
    reactorList.map(async (reactor) => {
      const methodBEligibility = await getMethodBEligibilityByReactor(userId, {
        reactorId: reactor.id,
        asOfDate: new Date().toISOString(),
      });

      return {
        id: reactor.id,
        code: reactor.code,
        identifier: reactor.identifier,
        facilityId: reactor.facilityId,
        reactorType: reactor.reactorType,
        samplingMethod: reactor.samplingMethod,
        nominalThroughputTph: reactor.nominalThroughputTph,
        specifications: reactor.specifications,
        createdAt: reactor.createdAt,
        updatedAt: reactor.updatedAt,
        facilityCode: reactor.facilityCode ?? "",
        facilityName: reactor.facilityName ?? "",
        methodBEligibility,
      };
    })
  );

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get a single reactor by ID
 * Returns reactor data with facility info and Method B eligibility
 */
export async function getReactorById(
  userId: string,
  reactorId: string
): Promise<ReactorWithRelations> {
  requireAuth(userId);

  const [reactor] = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      facilityId: reactors.facilityId,
      reactorType: reactors.reactorType,
      samplingMethod: reactors.samplingMethod,
      nominalThroughputTph: reactors.nominalThroughputTph,
      specifications: reactors.specifications,
      createdAt: reactors.createdAt,
      updatedAt: reactors.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
    })
    .from(reactors)
    .leftJoin(facilities, eq(reactors.facilityId, facilities.id))
    .where(eq(reactors.id, reactorId));

  if (!reactor) {
    throw new SafeError("Reactor not found");
  }

  const methodBEligibility = await getMethodBEligibilityByReactor(userId, {
    reactorId: reactor.id,
    asOfDate: new Date().toISOString(),
  });

  return {
    id: reactor.id,
    code: reactor.code,
    identifier: reactor.identifier,
    facilityId: reactor.facilityId,
    reactorType: reactor.reactorType,
    samplingMethod: reactor.samplingMethod,
    nominalThroughputTph: reactor.nominalThroughputTph,
    specifications: reactor.specifications,
    createdAt: reactor.createdAt,
    updatedAt: reactor.updatedAt,
    facilityCode: reactor.facilityCode ?? "",
    facilityName: reactor.facilityName ?? "",
    methodBEligibility,
  };
}

/**
 * Get reactors by facility ID
 * Returns reactors for a specific facility
 */
export async function getReactorsByFacility(
  userId: string,
  facilityId: string
): Promise<Reactor[]> {
  requireAuth(userId);

  // Verify facility exists
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.id, facilityId));

  if (!facility) {
    throw new SafeError("Facility not found");
  }

  return db
    .select()
    .from(reactors)
    .where(eq(reactors.facilityId, facilityId))
    .orderBy(asc(reactors.code));
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new reactor
 */
export async function createReactor(
  userId: string,
  data: {
    code: string;
    identifier: string;
    facilityId: string;
    reactorType: string;
    samplingMethod?: "method_a" | "method_b";
    nominalThroughputTph?: number | null;
    specifications?: Record<string, unknown> | null;
  }
): Promise<Reactor> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: reactors.id })
    .from(reactors)
    .where(eq(reactors.code, data.code));

  if (existing) {
    throw new SafeError("A reactor with this code already exists");
  }

  // Verify facility exists
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.id, data.facilityId));

  if (!facility) {
    throw new SafeError("Facility not found");
  }

  // A brand-new reactor has zero prior samples, so it can never satisfy the
  // Method B prerequisite — reject it up front rather than persisting an
  // ineligible configuration.
  if (data.samplingMethod === "method_b") {
    throw new SafeError(
      `Method B requires at least ${METHOD_B_MINIMUM_METHOD_A_SAMPLES} prior Method A samples. A new reactor has none — start with Method A.`
    );
  }

  const [reactor] = await db
    .insert(reactors)
    .values({
      code: data.code,
      identifier: data.identifier,
      facilityId: data.facilityId,
      reactorType: data.reactorType,
      samplingMethod: data.samplingMethod ?? "method_a",
      nominalThroughputTph: data.nominalThroughputTph ?? null,
      specifications: data.specifications ?? null,
    })
    .returning();

  return reactor;
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing reactor
 */
export async function updateReactor(
  userId: string,
  reactorId: string,
  data: {
    code?: string;
    identifier?: string;
    facilityId?: string;
    reactorType?: string;
    samplingMethod?: "method_a" | "method_b";
    nominalThroughputTph?: number | null;
    specifications?: Record<string, unknown> | null;
  }
): Promise<Reactor> {
  requireAuth(userId);

  // Verify reactor exists
  const [existing] = await db
    .select()
    .from(reactors)
    .where(eq(reactors.id, reactorId));

  if (!existing) {
    throw new SafeError("Reactor not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: reactors.id })
      .from(reactors)
      .where(eq(reactors.code, data.code));

    if (duplicate) {
      throw new SafeError("A reactor with this code already exists");
    }
  }

  // If facilityId is being changed, verify new facility exists
  if (data.facilityId && data.facilityId !== existing.facilityId) {
    const [facility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(eq(facilities.id, data.facilityId));

    if (!facility) {
      throw new SafeError("Facility not found");
    }
  }

  // Switching to Method B requires the reactor to have enough prior Method A
  // samples. Only check when actually moving to Method B (re-saving an already
  // eligible Method B reactor stays valid since sample counts only grow).
  if (data.samplingMethod === "method_b" && existing.samplingMethod !== "method_b") {
    const eligibility = await getMethodBEligibilityByReactor(userId, {
      reactorId,
      asOfDate: new Date().toISOString(),
    });
    if (!eligibility.meetsMinimumMethodASamples) {
      throw new SafeError(
        `Method B requires at least ${eligibility.minimumMethodASampleCount} prior Method A samples; this reactor has ${eligibility.priorMethodASampleCount}.`
      );
    }
  }

  const [updated] = await db
    .update(reactors)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(reactors.id, reactorId))
    .returning();

  return updated;
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a reactor
 * Will fail if reactor has associated production runs
 */
export async function deleteReactor(
  userId: string,
  reactorId: string
): Promise<void> {
  requireAuth(userId);

  // Verify reactor exists
  const [existing] = await db
    .select({ id: reactors.id })
    .from(reactors)
    .where(eq(reactors.id, reactorId));

  if (!existing) {
    throw new SafeError("Reactor not found");
  }

  // Note: Foreign key constraints will prevent deletion if there are
  // dependent production runs. The error will be caught by the server action.

  await db.delete(reactors).where(eq(reactors.id, reactorId));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a reactor code is available
 */
export async function isReactorCodeAvailable(
  userId: string,
  code: string,
  excludeReactorId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(reactors.code, code)];

  if (excludeReactorId) {
    conditions.push(sql`${reactors.id} != ${excludeReactorId}`);
  }

  const [existing] = await db
    .select({ id: reactors.id })
    .from(reactors)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get unique reactor types from all reactors
 * Useful for filter dropdowns
 */
export async function getReactorTypes(userId: string): Promise<string[]> {
  requireAuth(userId);

  const results = await db
    .selectDistinct({ reactorType: reactors.reactorType })
    .from(reactors)
    .orderBy(asc(reactors.reactorType));

  return results.map((r) => r.reactorType);
}

/**
 * Get Method B eligibility for a specific reactor
 */
export async function getReactorMethodBEligibility(
  userId: string,
  reactorId: string
): Promise<MethodBEligibilitySummary> {
  requireAuth(userId);

  // Verify reactor exists
  const [reactor] = await db
    .select({ id: reactors.id })
    .from(reactors)
    .where(eq(reactors.id, reactorId));

  if (!reactor) {
    throw new SafeError("Reactor not found");
  }

  return getMethodBEligibilityByReactor(userId, {
    reactorId,
    asOfDate: new Date().toISOString(),
  });
}
