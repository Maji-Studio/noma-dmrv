/**
 * Test Data Helpers
 *
 * Provides utilities for seeding and managing test data in Playwright E2E tests.
 * Use these helpers to create isolated test data that can be cleaned up after tests.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import * as crypto from "crypto";

// Types
export interface TestFacility {
  id: string;
  code: string;
  name: string;
  location: string;
  timezone: string;
}

export interface TestSupplier {
  id: string;
  code: string;
  name: string;
  location: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface TestFormulation {
  id: string;
  code: string;
  name: string;
  biocharRatio: number | null;
  description: string | null;
}

export interface TestStorageLocation {
  id: string;
  code: string;
  name: string;
  type: "feedstock_bin" | "biochar_bin" | "product_bin";
  facilityId: string;
  formulationId: string | null;
}

export interface TestBiocharProduct {
  id: string;
  code: string;
  facilityId: string;
  formulationId: string;
  productionDate: Date;
  status: "draft" | "testing" | "ready" | "sold";
  massKg: number | null;
}

export interface TestApplication {
  id: string;
  code: string;
  deliveryId: string;
  applicationDate: Date;
  biocharAppliedTons: number;
  biocharAppliedDryTons: number;
  status: "delivered" | "applied";
}

// Database connection helper
function createDbConnection() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/app_template_test";

  const pool = new Pool({
    connectionString: databaseUrl,
  });

  return { db: drizzle(pool, { schema }), pool };
}

/**
 * Generate a unique test ID with a prefix
 */
export function generateTestId(prefix: string = "e2e"): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Create a test facility
 */
export async function createTestFacility(
  overrides: Partial<Omit<TestFacility, "id">> = {}
): Promise<TestFacility> {
  const { db, pool } = createDbConnection();

  try {
    const testId = generateTestId();
    const facility: TestFacility = {
      id: crypto.randomUUID(),
      code: overrides.code || `E2E-FAC-${testId}`,
      name: overrides.name || `E2E Test Facility ${testId}`,
      location: overrides.location || "Test Location",
      timezone: overrides.timezone || "UTC",
    };

    await db.insert(schema.facilities).values({
      id: facility.id,
      code: facility.code,
      name: facility.name,
      location: facility.location,
      timezone: facility.timezone,
    });

    return facility;
  } finally {
    await pool.end();
  }
}

/**
 * Delete a test facility
 */
export async function deleteTestFacility(facilityId: string): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    // Reverse FK order: certifier rows FK the facility. Removals must go before
    // ghg_statements (removal.ghg_statement_id FKs it), and certifier_projects
    // also FKs the facility — all must clear before the facility. See
    // certification-helpers.ts for the canonical ordering.
    await db
      .delete(schema.certifierRemovals)
      .where(eq(schema.certifierRemovals.facilityId, facilityId));
    await db
      .delete(schema.certifierGhgStatements)
      .where(eq(schema.certifierGhgStatements.facilityId, facilityId));
    await db
      .delete(schema.certifierProjects)
      .where(eq(schema.certifierProjects.facilityId, facilityId));
    await db.delete(schema.facilities).where(eq(schema.facilities.id, facilityId));
  } finally {
    await pool.end();
  }
}

/**
 * Create a test storage location (bin). For product bins, pass `formulationId`
 * to reserve the bin for a formulation (null = unassigned / pure-biochar bin).
 */
export async function createTestStorageLocation(
  facilityId: string,
  overrides: Partial<Omit<TestStorageLocation, "id" | "facilityId">> = {}
): Promise<TestStorageLocation> {
  const { db, pool } = createDbConnection();

  try {
    const testId = generateTestId();
    const location: TestStorageLocation = {
      id: crypto.randomUUID(),
      code: overrides.code || `E2E-BIN-${testId.toUpperCase()}`,
      name: overrides.name || `E2E Test Bin ${testId}`,
      type: overrides.type ?? "product_bin",
      facilityId,
      formulationId: overrides.formulationId ?? null,
    };

    await db.insert(schema.storageLocations).values({
      id: location.id,
      code: location.code,
      name: location.name,
      type: location.type,
      facilityId: location.facilityId,
      formulationId: location.formulationId,
    });

    return location;
  } finally {
    await pool.end();
  }
}

/**
 * Delete a test storage location
 */
export async function deleteTestStorageLocation(storageLocationId: string): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    await db
      .delete(schema.storageLocations)
      .where(eq(schema.storageLocations.id, storageLocationId));
  } finally {
    await pool.end();
  }
}

/**
 * Create a test supplier
 */
export async function createTestSupplier(
  overrides: Partial<Omit<TestSupplier, "id">> = {}
): Promise<TestSupplier> {
  const { db, pool } = createDbConnection();

  try {
    const testId = generateTestId();
    const supplier: TestSupplier = {
      id: crypto.randomUUID(),
      code: overrides.code || `E2E-SUP-${testId.toUpperCase()}`,
      name: overrides.name || `E2E Test Supplier ${testId}`,
      location: overrides.location ?? "Test Location",
      contactName: overrides.contactName ?? null,
      contactEmail: overrides.contactEmail ?? null,
      contactPhone: overrides.contactPhone ?? null,
    };

    await db.insert(schema.suppliers).values({
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      location: supplier.location,
      contactName: supplier.contactName,
      contactEmail: supplier.contactEmail,
      contactPhone: supplier.contactPhone,
    });

    return supplier;
  } finally {
    await pool.end();
  }
}

/**
 * Delete a test supplier
 */
export async function deleteTestSupplier(supplierId: string): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    await db.delete(schema.suppliers).where(eq(schema.suppliers.id, supplierId));
  } finally {
    await pool.end();
  }
}

/**
 * Create a test formulation
 */
export async function createTestFormulation(
  overrides: Partial<Omit<TestFormulation, "id">> = {}
): Promise<TestFormulation> {
  const { db, pool } = createDbConnection();

  try {
    const testId = generateTestId();
    const formulation: TestFormulation = {
      id: crypto.randomUUID(),
      code: overrides.code || `E2E-FORM-${testId.toUpperCase()}`,
      name: overrides.name || `E2E Test Formulation ${testId}`,
      biocharRatio: overrides.biocharRatio ?? 0.7,
      description: overrides.description ?? null,
    };

    await db.insert(schema.formulations).values({
      id: formulation.id,
      code: formulation.code,
      name: formulation.name,
      biocharRatio: formulation.biocharRatio,
      description: formulation.description,
    });

    return formulation;
  } finally {
    await pool.end();
  }
}

/**
 * Delete a test formulation
 */
export async function deleteTestFormulation(formulationId: string): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    await db.delete(schema.formulations).where(eq(schema.formulations.id, formulationId));
  } finally {
    await pool.end();
  }
}

/**
 * Create a test biochar product
 */
export async function createTestBiocharProduct(
  facilityId: string,
  formulationId: string,
  overrides: Partial<Omit<TestBiocharProduct, "id" | "facilityId" | "formulationId">> = {}
): Promise<TestBiocharProduct> {
  const { db, pool } = createDbConnection();

  try {
    const testId = generateTestId();
    const product: TestBiocharProduct = {
      id: crypto.randomUUID(),
      code: overrides.code || `E2E-BP-${testId.toUpperCase()}`,
      facilityId,
      formulationId,
      productionDate: overrides.productionDate ?? new Date(),
      status: overrides.status ?? "testing",
      massKg: overrides.massKg ?? 500,
    };

    await db.insert(schema.biocharProducts).values({
      id: product.id,
      code: product.code,
      facilityId: product.facilityId,
      formulationId: product.formulationId,
      productionDate: product.productionDate,
      status: product.status,
      massKg: product.massKg,
    });

    return product;
  } finally {
    await pool.end();
  }
}

/**
 * Delete a test biochar product
 */
export async function deleteTestBiocharProduct(productId: string): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    await db.delete(schema.biocharProducts).where(eq(schema.biocharProducts.id, productId));
  } finally {
    await pool.end();
  }
}

/**
 * Create a test application
 */
export async function createTestApplication(
  deliveryId: string,
  overrides: Partial<Omit<TestApplication, "id" | "deliveryId">> = {}
): Promise<TestApplication> {
  const { db, pool } = createDbConnection();

  try {
    const testId = generateTestId();
    const application: TestApplication = {
      id: crypto.randomUUID(),
      code: overrides.code || `E2E-AP-${testId.toUpperCase()}`,
      deliveryId,
      applicationDate: overrides.applicationDate ?? new Date(),
      biocharAppliedTons: overrides.biocharAppliedTons ?? 10.5,
      biocharAppliedDryTons: overrides.biocharAppliedDryTons ?? 8.5,
      status: overrides.status ?? "delivered",
    };

    await db.insert(schema.applications).values({
      id: application.id,
      code: application.code,
      deliveryId: application.deliveryId,
      applicationDate: application.applicationDate,
      biocharAppliedTons: application.biocharAppliedTons,
      biocharAppliedDryTons: application.biocharAppliedDryTons,
      status: application.status,
    });

    return application;
  } finally {
    await pool.end();
  }
}

/**
 * Delete a test application
 */
export async function deleteTestApplication(applicationId: string): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    await db.delete(schema.applications).where(eq(schema.applications.id, applicationId));
  } finally {
    await pool.end();
  }
}

/**
 * Bulk cleanup helper - cleans up multiple entity types
 */
export async function bulkCleanup(entities: {
  facilityIds?: string[];
  storageLocationIds?: string[];
  supplierIds?: string[];
  formulationIds?: string[];
  biocharProductIds?: string[];
  userIds?: string[];
}): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    await db.transaction(async (tx) => {
      // Clean up in order respecting FK constraints

      // Delete biochar products (before formulations due to FK)
      if (entities.biocharProductIds && entities.biocharProductIds.length > 0) {
        await tx
          .delete(schema.biocharProducts)
          .where(inArray(schema.biocharProducts.id, entities.biocharProductIds));
      }

      // Delete storage locations before facilities.
      if (entities.storageLocationIds && entities.storageLocationIds.length > 0) {
        await tx
          .delete(schema.storageLocations)
          .where(inArray(schema.storageLocations.id, entities.storageLocationIds));
      }

      // Delete formulations
      if (entities.formulationIds && entities.formulationIds.length > 0) {
        await tx
          .delete(schema.formulations)
          .where(inArray(schema.formulations.id, entities.formulationIds));
      }

      // Delete facilities after dependent storage locations and products.
      if (entities.facilityIds && entities.facilityIds.length > 0) {
        // Reverse FK order: certifier rows FK the facility. Removals must go
        // before ghg_statements (removal.ghg_statement_id FKs it), and
        // certifier_projects also FKs the facility — all must clear before
        // the facility itself.
        await tx
          .delete(schema.certifierRemovals)
          .where(inArray(schema.certifierRemovals.facilityId, entities.facilityIds));
        await tx
          .delete(schema.certifierGhgStatements)
          .where(
            inArray(schema.certifierGhgStatements.facilityId, entities.facilityIds)
          );
        await tx
          .delete(schema.certifierProjects)
          .where(inArray(schema.certifierProjects.facilityId, entities.facilityIds));
        await tx
          .delete(schema.facilities)
          .where(inArray(schema.facilities.id, entities.facilityIds));
      }

      // Delete suppliers
      if (entities.supplierIds && entities.supplierIds.length > 0) {
        await tx
          .delete(schema.suppliers)
          .where(inArray(schema.suppliers.id, entities.supplierIds));
      }

      // Delete users (and cascade to sessions, accounts)
      if (entities.userIds && entities.userIds.length > 0) {
        // Delete sessions first
        await tx
          .delete(schema.sessions)
          .where(inArray(schema.sessions.userId, entities.userIds));

        // Delete accounts
        await tx
          .delete(schema.accounts)
          .where(inArray(schema.accounts.userId, entities.userIds));

        // Delete users
        await tx
          .delete(schema.users)
          .where(inArray(schema.users.id, entities.userIds));
      }
    });
  } finally {
    await pool.end();
  }
}

/**
 * Test data builder - creates a complete set of related test entities
 */
export class TestDataBuilder {
  private ownerId: string;
  private testId: string;
  private createdEntities: {
    facilityIds: string[];
    storageLocationIds: string[];
  };

  constructor(ownerId: string) {
    this.ownerId = ownerId;
    this.testId = generateTestId();
    this.createdEntities = {
      facilityIds: [],
      storageLocationIds: [],
    };
  }

  /**
   * Create a facility
   */
  async createFacility(name?: string): Promise<TestFacility> {
    const facility = await createTestFacility({
      name: name || `Builder Facility ${this.testId}`,
    });
    this.createdEntities.facilityIds.push(facility.id);
    return facility;
  }

  /**
   * Create a storage location
   */
  async createStorageLocation(
    facilityId: string,
    overrides: Partial<Omit<TestStorageLocation, "id" | "facilityId">> = {}
  ): Promise<TestStorageLocation> {
    const storageLocation = await createTestStorageLocation(facilityId, overrides);
    this.createdEntities.storageLocationIds.push(storageLocation.id);
    return storageLocation;
  }

  /**
   * Clean up all entities created by this builder
   */
  async cleanup(): Promise<void> {
    await bulkCleanup({
      facilityIds: this.createdEntities.facilityIds,
      storageLocationIds: this.createdEntities.storageLocationIds,
    });

    // Reset tracking
    this.createdEntities = {
      facilityIds: [],
      storageLocationIds: [],
    };
  }

  /**
   * Get the test ID for this builder instance
   */
  getTestId(): string {
    return this.testId;
  }

  /**
   * Get all created entity IDs
   */
  getCreatedEntities() {
    return { ...this.createdEntities };
  }
}
