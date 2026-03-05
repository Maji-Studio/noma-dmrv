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
export interface TestProject {
  id: string;
  name: string;
  description: string;
  ownerId: string;
}

export interface TestItem {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
}

export interface TestFacility {
  id: string;
  code: string;
  name: string;
  location: string;
}

export interface TestSupplier {
  id: string;
  code: string;
  name: string;
  location: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  chainOfCustodyRef: string | null;
}

export interface TestFormulation {
  id: string;
  code: string;
  name: string;
  biocharRatio: number | null;
  description: string | null;
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
 * Create a test project with the given owner
 */
export async function createTestProject(
  ownerId: string,
  overrides: Partial<Omit<TestProject, "id" | "ownerId">> = {}
): Promise<TestProject> {
  const { db, pool } = createDbConnection();

  try {
    const project: TestProject = {
      id: crypto.randomUUID(),
      name: overrides.name || `Test Project ${generateTestId()}`,
      description: overrides.description || "E2E test project",
      ownerId,
    };

    await db.insert(schema.projects).values({
      id: project.id,
      name: project.name,
      description: project.description,
      ownerId: project.ownerId,
    });

    // Also add owner as project member
    await db.insert(schema.projectMembers).values({
      id: crypto.randomUUID(),
      projectId: project.id,
      userId: ownerId,
      role: "owner",
    });

    return project;
  } finally {
    await pool.end();
  }
}

/**
 * Add a user to a project with a specific role
 */
export async function addProjectMember(
  projectId: string,
  userId: string,
  role: "owner" | "admin" | "member" | "viewer" = "member"
): Promise<string> {
  const { db, pool } = createDbConnection();

  try {
    const memberId = crypto.randomUUID();

    await db.insert(schema.projectMembers).values({
      id: memberId,
      projectId,
      userId,
      role,
    });

    return memberId;
  } finally {
    await pool.end();
  }
}

/**
 * Create a test item in a project
 */
export async function createTestItem(
  projectId: string,
  overrides: Partial<Omit<TestItem, "id" | "projectId">> = {}
): Promise<TestItem> {
  const { db, pool } = createDbConnection();

  try {
    const item: TestItem = {
      id: crypto.randomUUID(),
      projectId,
      title: overrides.title || `Test Item ${generateTestId()}`,
      description: overrides.description || "E2E test item",
      status: overrides.status || "active",
    };

    await db.insert(schema.items).values({
      id: item.id,
      projectId: item.projectId,
      title: item.title,
      description: item.description,
      status: item.status as "active" | "completed" | "archived",
    });

    return item;
  } finally {
    await pool.end();
  }
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
    };

    await db.insert(schema.facilities).values({
      id: facility.id,
      code: facility.code,
      name: facility.name,
      location: facility.location,
    });

    return facility;
  } finally {
    await pool.end();
  }
}

/**
 * Delete a test project and all related data
 */
export async function deleteTestProject(projectId: string): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    await db.transaction(async (tx) => {
      // Delete project members
      await tx
        .delete(schema.projectMembers)
        .where(eq(schema.projectMembers.projectId, projectId));

      // Delete items
      await tx.delete(schema.items).where(eq(schema.items.projectId, projectId));

      // Delete project
      await tx.delete(schema.projects).where(eq(schema.projects.id, projectId));
    });
  } finally {
    await pool.end();
  }
}

/**
 * Delete test items by IDs
 */
export async function deleteTestItems(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;

  const { db, pool } = createDbConnection();

  try {
    await db.delete(schema.items).where(inArray(schema.items.id, itemIds));
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
    await db.delete(schema.facilities).where(eq(schema.facilities.id, facilityId));
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
      chainOfCustodyRef: overrides.chainOfCustodyRef ?? null,
    };

    await db.insert(schema.suppliers).values({
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      location: supplier.location,
      contactName: supplier.contactName,
      contactEmail: supplier.contactEmail,
      contactPhone: supplier.contactPhone,
      chainOfCustodyRef: supplier.chainOfCustodyRef,
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
  projectIds?: string[];
  itemIds?: string[];
  facilityIds?: string[];
  supplierIds?: string[];
  formulationIds?: string[];
  biocharProductIds?: string[];
  userIds?: string[];
}): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    await db.transaction(async (tx) => {
      // Clean up in order respecting FK constraints

      // Delete project members for projects
      if (entities.projectIds && entities.projectIds.length > 0) {
        await tx
          .delete(schema.projectMembers)
          .where(inArray(schema.projectMembers.projectId, entities.projectIds));
      }

      // Delete items
      if (entities.itemIds && entities.itemIds.length > 0) {
        await tx.delete(schema.items).where(inArray(schema.items.id, entities.itemIds));
      }

      // Delete items for projects
      if (entities.projectIds && entities.projectIds.length > 0) {
        await tx
          .delete(schema.items)
          .where(inArray(schema.items.projectId, entities.projectIds));
      }

      // Delete projects
      if (entities.projectIds && entities.projectIds.length > 0) {
        await tx
          .delete(schema.projects)
          .where(inArray(schema.projects.id, entities.projectIds));
      }

      // Delete facilities
      if (entities.facilityIds && entities.facilityIds.length > 0) {
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

      // Delete biochar products (before formulations due to FK)
      if (entities.biocharProductIds && entities.biocharProductIds.length > 0) {
        await tx
          .delete(schema.biocharProducts)
          .where(inArray(schema.biocharProducts.id, entities.biocharProductIds));
      }

      // Delete formulations
      if (entities.formulationIds && entities.formulationIds.length > 0) {
        await tx
          .delete(schema.formulations)
          .where(inArray(schema.formulations.id, entities.formulationIds));
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
    projectIds: string[];
    itemIds: string[];
    facilityIds: string[];
    memberIds: string[];
  };

  constructor(ownerId: string) {
    this.ownerId = ownerId;
    this.testId = generateTestId();
    this.createdEntities = {
      projectIds: [],
      itemIds: [],
      facilityIds: [],
      memberIds: [],
    };
  }

  /**
   * Create a project owned by the builder's owner
   */
  async createProject(
    name?: string,
    description?: string
  ): Promise<TestProject> {
    const project = await createTestProject(this.ownerId, {
      name: name || `Builder Project ${this.testId}`,
      description: description || "Created by TestDataBuilder",
    });
    this.createdEntities.projectIds.push(project.id);
    return project;
  }

  /**
   * Create an item in the specified project
   */
  async createItem(
    projectId: string,
    title?: string,
    description?: string
  ): Promise<TestItem> {
    const item = await createTestItem(projectId, {
      title: title || `Builder Item ${this.testId}`,
      description: description || "Created by TestDataBuilder",
    });
    this.createdEntities.itemIds.push(item.id);
    return item;
  }

  /**
   * Add a member to a project
   */
  async addMember(
    projectId: string,
    userId: string,
    role: "owner" | "admin" | "member" | "viewer" = "member"
  ): Promise<string> {
    const memberId = await addProjectMember(projectId, userId, role);
    this.createdEntities.memberIds.push(memberId);
    return memberId;
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
   * Clean up all entities created by this builder
   */
  async cleanup(): Promise<void> {
    await bulkCleanup({
      projectIds: this.createdEntities.projectIds,
      itemIds: this.createdEntities.itemIds,
      facilityIds: this.createdEntities.facilityIds,
    });

    // Reset tracking
    this.createdEntities = {
      projectIds: [],
      itemIds: [],
      facilityIds: [],
      memberIds: [],
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

/**
 * Create a complete test scenario with project, members, and items
 */
export async function createTestScenario(config: {
  ownerUserId: string;
  members?: { userId: string; role: "admin" | "member" | "viewer" }[];
  itemCount?: number;
}): Promise<{
  project: TestProject;
  items: TestItem[];
  cleanup: () => Promise<void>;
}> {
  const { db, pool } = createDbConnection();

  try {
    const projectId = crypto.randomUUID();
    const testId = generateTestId();

    // Create project
    const project: TestProject = {
      id: projectId,
      name: `Scenario Project ${testId}`,
      description: "E2E test scenario project",
      ownerId: config.ownerUserId,
    };

    await db.insert(schema.projects).values({
      id: project.id,
      name: project.name,
      description: project.description,
      ownerId: project.ownerId,
    });

    // Add owner as project member
    await db.insert(schema.projectMembers).values({
      id: crypto.randomUUID(),
      projectId: project.id,
      userId: config.ownerUserId,
      role: "owner",
    });

    // Add additional members
    if (config.members) {
      for (const member of config.members) {
        await db.insert(schema.projectMembers).values({
          id: crypto.randomUUID(),
          projectId: project.id,
          userId: member.userId,
          role: member.role,
        });
      }
    }

    // Create items
    const items: TestItem[] = [];
    const itemCount = config.itemCount || 0;

    for (let i = 0; i < itemCount; i++) {
      const item: TestItem = {
        id: crypto.randomUUID(),
        projectId: project.id,
        title: `Scenario Item ${i + 1}`,
        description: `Test item ${i + 1} for scenario`,
        status: "active",
      };

      await db.insert(schema.items).values({
        id: item.id,
        projectId: item.projectId,
        title: item.title,
        description: item.description,
        status: item.status as "active" | "completed" | "archived",
      });

      items.push(item);
    }

    // Return scenario with cleanup function
    return {
      project,
      items,
      cleanup: async () => {
        const { db: cleanupDb, pool: cleanupPool } = createDbConnection();
        try {
          await cleanupDb.transaction(async (tx) => {
            await tx
              .delete(schema.projectMembers)
              .where(eq(schema.projectMembers.projectId, projectId));
            await tx.delete(schema.items).where(eq(schema.items.projectId, projectId));
            await tx.delete(schema.projects).where(eq(schema.projects.id, projectId));
          });
        } finally {
          await cleanupPool.end();
        }
      },
    };
  } finally {
    await pool.end();
  }
}
