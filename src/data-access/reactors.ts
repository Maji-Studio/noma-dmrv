/**
 * Reactors Data Access Layer
 * CRUD operations for reactors with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  reactors,
  facilities,
  type Reactor,
} from "@/db/schema";
import type { ReactorFilterData } from "@/schemas/reactors";

// ============================================
// Types
// ============================================

export interface ReactorWithRelations extends Reactor {
  facilityCode: string;
  facilityName: string;
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

import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import { guardReactorIdentifier } from "./unique-name-guards";

// ADR 0016 removed the reactor-level sampling method. Reactor surfaces still
// need a stable Method-A value while Method B is process-scoped.
const LEGACY_REACTOR_SAMPLING_METHOD = "method_a" as const;

// ============================================
// Read Operations
// ============================================

/**
 * Get all reactors with pagination and filtering
 * Supports search, facility/type filters, sorting, and pagination
 */
export async function getReactors(
  ctx: OrgContext,
  filters?: Partial<ReactorFilterData>
): Promise<PaginatedReactors> {
  requireOrgScope(ctx);

  const {
    search,
    facilityId,
    reactorType,
    page = 1,
    pageSize = 20,
    sortBy = "code",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions — archived reactors (facility archive cascade) are hidden
  const conditions: SQL[] = [eq(reactors.organizationId, ctx.organizationId), isNull(reactors.archivedAt)];

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

  if (reactorType) {
    conditions.push(eq(reactors.reactorType, reactorType));
  }

  const whereClause = and(...conditions);

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
  // org-scope-ok: whereClause includes the active organization predicate.
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
      organizationId: reactors.organizationId,
      code: reactors.code,
      identifier: reactors.identifier,
      facilityId: reactors.facilityId,
      reactorType: reactors.reactorType,
      nominalThroughputTph: reactors.nominalThroughputTph,
      specifications: reactors.specifications,
      archivedAt: reactors.archivedAt,
      createdAt: reactors.createdAt,
      updatedAt: reactors.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
    })
    .from(reactors)
    .leftJoin(
      facilities,
      and(
        eq(reactors.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  const items: ReactorWithRelations[] = reactorList.map((reactor) => ({
    id: reactor.id,
    organizationId: reactor.organizationId,
    code: reactor.code,
    identifier: reactor.identifier,
    facilityId: reactor.facilityId,
    reactorType: reactor.reactorType,
    nominalThroughputTph: reactor.nominalThroughputTph,
    specifications: reactor.specifications,
    archivedAt: reactor.archivedAt,
    createdAt: reactor.createdAt,
    updatedAt: reactor.updatedAt,
    facilityCode: reactor.facilityCode ?? "",
    facilityName: reactor.facilityName ?? "",
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
 * Get a single reactor by ID
 * Returns reactor data with facility info
 */
export async function getReactorById(
  ctx: OrgContext,
  reactorId: string
): Promise<ReactorWithRelations> {
  requireOrgScope(ctx);

  const [reactor] = await db
    .select({
      id: reactors.id,
      organizationId: reactors.organizationId,
      code: reactors.code,
      identifier: reactors.identifier,
      facilityId: reactors.facilityId,
      reactorType: reactors.reactorType,
      nominalThroughputTph: reactors.nominalThroughputTph,
      specifications: reactors.specifications,
      archivedAt: reactors.archivedAt,
      createdAt: reactors.createdAt,
      updatedAt: reactors.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
    })
    .from(reactors)
    .leftJoin(
      facilities,
      and(
        eq(reactors.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(reactors.id, reactorId), eq(reactors.organizationId, ctx.organizationId)));

  if (!reactor) {
    throw new SafeError("Reactor not found");
  }

  return {
    id: reactor.id,
    organizationId: reactor.organizationId,
    code: reactor.code,
    identifier: reactor.identifier,
    facilityId: reactor.facilityId,
    reactorType: reactor.reactorType,
    nominalThroughputTph: reactor.nominalThroughputTph,
    specifications: reactor.specifications,
    archivedAt: reactor.archivedAt,
    createdAt: reactor.createdAt,
    updatedAt: reactor.updatedAt,
    facilityCode: reactor.facilityCode ?? "",
    facilityName: reactor.facilityName ?? "",
  };
}

/**
 * Map each reactor id to its CURRENT sampling method. Used by the durability
 * submission gates (D6) to decide, per production run, whether a Method A run
 * must be sampled. Reactor ids absent from the table are simply omitted; the
 * caller defaults a missing run conservatively to Method A.
 *
 * ADR 0016 (Phase 1): the sampling method is no longer a reactor column — it
 * lives on the production process — and DEC runs Method A everywhere. This
 * therefore returns Method A for every existing reactor. Phase 2 re-keys the
 * gates to source the method from the production process directly.
 */
export async function getSamplingMethodsByReactorIds(
  ctx: OrgContext,
  reactorIds: string[]
): Promise<Map<string, "method_a" | "method_b">> {
  requireOrgScope(ctx);

  if (reactorIds.length === 0) return new Map();

  const rows = await db
    .select({ id: reactors.id })
    .from(reactors)
    .where(and(inArray(reactors.id, reactorIds), eq(reactors.organizationId, ctx.organizationId)));

  return new Map(rows.map((r) => [r.id, LEGACY_REACTOR_SAMPLING_METHOD]));
}

/**
 * Get reactors by facility ID
 * Returns reactors for a specific facility
 */
export async function getReactorsByFacility(
  ctx: OrgContext,
  facilityId: string
): Promise<Reactor[]> {
  requireOrgScope(ctx);

  // Verify facility exists
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)));

  if (!facility) {
    throw new SafeError("Facility not found");
  }

  return db
    .select()
    .from(reactors)
    .where(and(eq(reactors.facilityId, facilityId), eq(reactors.organizationId, ctx.organizationId), isNull(reactors.archivedAt)))
    .orderBy(asc(reactors.code));
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new reactor
 */
export async function createReactor(
  ctx: OrgContext,
  data: {
    code: string;
    identifier: string;
    facilityId: string;
    reactorType: string;
    nominalThroughputTph?: number | null;
    specifications?: Record<string, unknown> | null;
  }
): Promise<Reactor> {
  requireOrgScope(ctx);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: reactors.id })
    .from(reactors)
    .where(and(eq(reactors.code, data.code), eq(reactors.organizationId, ctx.organizationId)));

  if (existing) {
    throw new SafeError("A reactor with this code already exists");
  }

  // Verify facility exists and is active (no new children under an archived parent)
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)));

  if (!facility) {
    throw new SafeError("Facility not found or archived");
  }

  // ADR 0016: a reactor no longer declares a sampling method (it lives on the
  // production process). Nothing Method-B to validate at reactor creation.

  const [reactor] = await guardReactorIdentifier(ctx, data.identifier, () =>
    db
      .insert(reactors)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        identifier: data.identifier,
        facilityId: data.facilityId,
        reactorType: data.reactorType,
        nominalThroughputTph: data.nominalThroughputTph ?? null,
        specifications: data.specifications ?? null,
      })
      .returning()
  );

  return reactor;
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing reactor
 */
export async function updateReactor(
  ctx: OrgContext,
  reactorId: string,
  data: {
    code?: string;
    identifier?: string;
    facilityId?: string;
    reactorType?: string;
    nominalThroughputTph?: number | null;
    specifications?: Record<string, unknown> | null;
  }
): Promise<Reactor> {
  requireOrgScope(ctx);

  // Verify reactor exists
  const [existing] = await db
    .select()
    .from(reactors)
    .where(and(eq(reactors.id, reactorId), eq(reactors.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Reactor not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: reactors.id })
      .from(reactors)
      .where(and(eq(reactors.code, data.code), eq(reactors.organizationId, ctx.organizationId)));

    if (duplicate) {
      throw new SafeError("A reactor with this code already exists");
    }
  }

  // If facilityId is being changed, verify new facility exists and is active
  if (data.facilityId && data.facilityId !== existing.facilityId) {
    const [facility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)));

    if (!facility) {
      throw new SafeError("Facility not found or archived");
    }
  }

  // ADR 0016: a reactor no longer declares a sampling method (it lives on the
  // production process), so there is no Method-B eligibility to re-validate on
  // a reactor update.

  // A rename OR a facility move can collide with the per-facility identifier
  // index, so guard the update too.
  const [updated] = await guardReactorIdentifier(
    ctx,
    data.identifier ?? existing.identifier,
    () =>
      db
        .update(reactors)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(and(eq(reactors.id, reactorId), eq(reactors.organizationId, ctx.organizationId)))
        .returning()
  );

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
  ctx: OrgContext,
  reactorId: string
): Promise<void> {
  requireOrgScope(ctx);

  // Verify reactor exists
  const [existing] = await db
    .select({ id: reactors.id })
    .from(reactors)
    .where(and(eq(reactors.id, reactorId), eq(reactors.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Reactor not found");
  }

  // Note: Foreign key constraints will prevent deletion if there are
  // dependent production runs. The error will be caught by the server action.

  await db.delete(reactors).where(and(eq(reactors.id, reactorId), eq(reactors.organizationId, ctx.organizationId)));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a reactor code is available
 */
export async function isReactorCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeReactorId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(reactors.code, code), eq(reactors.organizationId, ctx.organizationId)];

  if (excludeReactorId) {
    conditions.push(sql`${reactors.id} != ${excludeReactorId}`);
  }

  // org-scope-ok: organization predicate is composed in conditions above.
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
export async function getReactorTypes(ctx: OrgContext): Promise<string[]> {
  requireOrgScope(ctx);

  const results = await db
    .selectDistinct({ reactorType: reactors.reactorType })
    .from(reactors)
    .where(and(eq(reactors.organizationId, ctx.organizationId), isNull(reactors.archivedAt)))
    .orderBy(asc(reactors.reactorType));

  return results.map((r) => r.reactorType);
}
