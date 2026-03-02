/* eslint-disable react-hooks/rules-of-hooks */
/**
 * Playwright Authentication Fixtures
 *
 * Provides reusable fixtures for authenticated test contexts with different user roles:
 * - admin: System administrator with full access
 * - operator: Regular user with member-level project access
 * - lab_technician: Regular user with member-level project access (for lab/QA workflows)
 * - viewer: Regular user with viewer-level project access (read-only)
 *
 * Includes helper functions for seeding test data and cleanup.
 */
import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import * as crypto from "crypto";
import {
  seedChainData,
  cleanupChainData,
  type SeededChainData,
} from "./seed-chain-data";
import { hashPassword } from "./hash-password";

// Types for user roles
export type UserRole = "admin" | "operator" | "lab_technician" | "viewer";
export type ProjectRole = "owner" | "admin" | "member" | "viewer";

// Test user configuration
export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user"; // App-level role
  password: string;
  projectRole?: ProjectRole; // Project-level role
}

// Fixture types
export interface AuthFixtures {
  adminPage: Page;
  operatorPage: Page;
  labTechnicianPage: Page;
  viewerPage: Page;
  adminContext: BrowserContext;
  operatorContext: BrowserContext;
  labTechnicianContext: BrowserContext;
  viewerContext: BrowserContext;
  testUsers: Record<UserRole, TestUser>;
  testProjectId: string;
  seededData: SeededChainData;
  seedTestData: () => Promise<void>;
  cleanupTestData: () => Promise<void>;
}

export type { SeededChainData };

// Generate unique test IDs to avoid collisions
const testRunId = crypto.randomUUID().slice(0, 8);

// Default test users configuration
const defaultTestUsers: Record<UserRole, Omit<TestUser, "id">> = {
  admin: {
    email: `test-admin-${testRunId}@e2e.local`,
    name: "E2E Admin User",
    role: "admin",
    password: "TestPassword123!",
    projectRole: "owner",
  },
  operator: {
    email: `test-operator-${testRunId}@e2e.local`,
    name: "E2E Operator User",
    role: "user",
    password: "TestPassword123!",
    projectRole: "member",
  },
  lab_technician: {
    email: `test-labtech-${testRunId}@e2e.local`,
    name: "E2E Lab Technician",
    role: "user",
    password: "TestPassword123!",
    projectRole: "member",
  },
  viewer: {
    email: `test-viewer-${testRunId}@e2e.local`,
    name: "E2E Viewer User",
    role: "user",
    password: "TestPassword123!",
    projectRole: "viewer",
  },
};

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
 * Seed test users into the database
 */
export async function seedTestUsers(
  users: Record<UserRole, Omit<TestUser, "id">>
): Promise<{ users: Record<UserRole, TestUser>; projectId: string }> {
  const { db, pool } = createDbConnection();

  try {
    const projectId = crypto.randomUUID();
    const seededUsers: Record<UserRole, TestUser> = {} as Record<UserRole, TestUser>;

    // Hash passwords using Better Auth's scrypt format
    const passwordHash = await hashPassword("TestPassword123!");

    await db.transaction(async (tx) => {
      // Create users
      for (const [role, userData] of Object.entries(users) as [UserRole, Omit<TestUser, "id">][]) {
        const userId = `e2e-${role}-${testRunId}`;

        await tx
          .insert(schema.users)
          .values({
            id: userId,
            email: userData.email,
            name: userData.name,
            role: userData.role,
            emailVerified: true, // Pre-verified for testing
          })
          .onConflictDoNothing();

        // Create account for credential login
        await tx
          .insert(schema.accounts)
          .values({
            id: `e2e-account-${role}-${testRunId}`,
            userId: userId,
            accountId: `e2e-${role}-account-${testRunId}`,
            providerId: "credential",
            password: passwordHash,
          })
          .onConflictDoNothing();

        seededUsers[role] = {
          ...userData,
          id: userId,
        };
      }

      // Create test project
      await tx.insert(schema.projects).values({
        id: projectId,
        name: `E2E Test Project ${testRunId}`,
        description: "Automated E2E test project",
        ownerId: seededUsers.admin.id,
      });

      // Create project memberships
      for (const [, userData] of Object.entries(seededUsers) as [UserRole, TestUser][]) {
        if (userData.projectRole) {
          await tx.insert(schema.projectMembers).values({
            id: crypto.randomUUID(),
            projectId: projectId,
            userId: userData.id,
            role: userData.projectRole,
          });
        }
      }
    });

    return { users: seededUsers, projectId };
  } finally {
    await pool.end();
  }
}

/**
 * Clean up test data from the database
 */
export async function cleanupTestData(
  users: Record<UserRole, TestUser>,
  projectId: string
): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    const userIds = Object.values(users).map((u) => u.id);

    await db.transaction(async (tx) => {
      // Delete project members first (FK constraint)
      await tx
        .delete(schema.projectMembers)
        .where(eq(schema.projectMembers.projectId, projectId));

      // Also delete project members for any projects owned by test users
      await tx
        .delete(schema.projectMembers)
        .where(inArray(schema.projectMembers.userId, userIds));

      // Delete items associated with the project
      await tx.delete(schema.items).where(eq(schema.items.projectId, projectId));

      // Delete the project BEFORE deleting users (owner FK constraint)
      await tx.delete(schema.projects).where(eq(schema.projects.id, projectId));

      // Also delete any other projects owned by test users
      await tx
        .delete(schema.projects)
        .where(inArray(schema.projects.ownerId, userIds));

      // Delete sessions for test users
      await tx
        .delete(schema.sessions)
        .where(inArray(schema.sessions.userId, userIds));

      // Delete accounts for test users
      await tx
        .delete(schema.accounts)
        .where(inArray(schema.accounts.userId, userIds));

      // Delete test users (now safe since all referencing records are deleted)
      await tx.delete(schema.users).where(inArray(schema.users.id, userIds));
    });
  } finally {
    await pool.end();
  }
}

/**
 * Authenticate a page context by logging in through the UI
 */
export async function authenticatePage(
  page: Page,
  user: TestUser,
  baseURL: string
): Promise<void> {
  await page.goto(`${baseURL}/login`);

  // Fill in credentials
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);

  // Submit the form
  await page.click('button[type="submit"]');

  // Wait for successful redirect (should go to /projects or similar)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
}

/**
 * Create an authenticated browser context with stored state
 */
export async function createAuthenticatedContext(
  browser: { newContext: () => Promise<BrowserContext> },
  user: TestUser,
  baseURL: string
): Promise<BrowserContext> {
  // Create a new context
  const context = await browser.newContext();
  const page = await context.newPage();

  // Authenticate
  await authenticatePage(page, user, baseURL);

  // Get cookies and local storage
  await page.close();

  return context;
}

/**
 * Create a session directly in the database for faster auth
 * This bypasses UI login for performance
 */
export async function createDirectSession(
  userId: string
): Promise<{ token: string; sessionId: string }> {
  const { db, pool } = createDbConnection();

  try {
    const sessionId = `e2e-session-${crypto.randomUUID()}`;
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(schema.sessions).values({
      id: sessionId,
      userId: userId,
      token: token,
      expiresAt: expiresAt,
      ipAddress: "127.0.0.1",
      userAgent: "Playwright E2E Tests",
    });

    return { token, sessionId };
  } finally {
    await pool.end();
  }
}

/**
 * Set auth cookies on a browser context for direct session authentication
 */
export async function setAuthCookies(
  context: BrowserContext,
  token: string,
  baseURL: string
): Promise<void> {
  const url = new URL(baseURL);

  // Better Auth uses specific cookie naming conventions
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: token,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

/**
 * Create an authenticated browser context via HTTP API sign-in (fast, no UI interaction)
 */
async function createDirectAuthContext(
  browser: { newContext: () => Promise<BrowserContext> },
  user: TestUser,
  baseURL: string
): Promise<BrowserContext> {
  // Sign in via HTTP API to get valid signed cookies
  const response = await fetch(`${baseURL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": baseURL },
    body: JSON.stringify({ email: user.email, password: user.password }),
    redirect: "manual",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API sign-in failed for ${user.email}: ${response.status} ${body}`);
  }

  // Extract Set-Cookie headers
  const setCookieHeaders = response.headers.getSetCookie();
  const url = new URL(baseURL);
  const cookies = setCookieHeaders
    .map((header) => {
      const [nameValue, ...attrs] = header.split(";");
      const [name, ...valueParts] = nameValue!.split("=");
      const value = valueParts.join("=");
      const attrMap: Record<string, string> = {};
      for (const attr of attrs) {
        const [key, val] = attr.trim().split("=");
        attrMap[key!.toLowerCase()] = val || "";
      }
      return {
        name: name!.trim(),
        value,
        domain: url.hostname,
        path: attrMap["path"] || "/",
        httpOnly: "httponly" in attrMap,
        secure: "secure" in attrMap,
        sameSite: (attrMap["samesite"] as "Lax" | "Strict" | "None") || "Lax",
      };
    })
    .filter((c) => c.name && c.value);

  const context = await browser.newContext();
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }
  return context;
}

// Extended test fixture with auth helpers
export const test = base.extend<AuthFixtures>({
  testUsers: async ({}, use) => {
    const { users } = await seedTestUsers(defaultTestUsers);
    await use(users);
    // Cleanup happens in cleanupTestData fixture
  },

  testProjectId: async ({ testUsers }, use) => {
    // The project was created with the users
    const { db, pool } = createDbConnection();
    try {
      const [project] = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.ownerId, testUsers.admin.id))
        .limit(1);
      await use(project?.id || "");
    } finally {
      await pool.end();
    }
  },

  seededData: async ({}, use) => {
    // Seed all prerequisite lookup entities for UI tests
    const data = await seedChainData(testRunId);
    await use(data);
    // Cleanup happens in cleanupTestData fixture
  },

  seedTestData: async ({ testUsers, testProjectId, seededData }, use) => {
    const seedFn = async () => {
      console.log(
        `Test data ready: ${Object.keys(testUsers).length} users, project: ${testProjectId}, facility: ${seededData.facility.code}`
      );
    };
    await use(seedFn);
  },

  cleanupTestData: async ({ testUsers, testProjectId, seededData }, use) => {
    // Provide cleanup function
    const cleanupFn = async () => {
      await cleanupTestData(testUsers, testProjectId);
      await cleanupChainData(seededData);
    };

    // Use the fixture
    await use(cleanupFn);

    // Auto-cleanup after tests
    try {
      await cleanupFn();
    } catch (error) {
      console.warn("Cleanup warning:", error);
    }
  },

  adminContext: async ({ browser, testUsers }, use) => {
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
    const context = await createDirectAuthContext(browser, testUsers.admin, baseURL);

    await use(context);
    await context.close();
  },

  operatorContext: async ({ browser, testUsers }, use) => {
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
    const context = await createDirectAuthContext(browser, testUsers.operator, baseURL);

    await use(context);
    await context.close();
  },

  labTechnicianContext: async ({ browser, testUsers }, use) => {
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
    const context = await createDirectAuthContext(browser, testUsers.lab_technician, baseURL);

    await use(context);
    await context.close();
  },

  viewerContext: async ({ browser, testUsers }, use) => {
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
    const context = await createDirectAuthContext(browser, testUsers.viewer, baseURL);

    await use(context);
    await context.close();
  },

  adminPage: async ({ adminContext }, use) => {
    const page = await adminContext.newPage();
    await use(page);
    await page.close();
  },

  operatorPage: async ({ operatorContext }, use) => {
    const page = await operatorContext.newPage();
    await use(page);
    await page.close();
  },

  labTechnicianPage: async ({ labTechnicianContext }, use) => {
    const page = await labTechnicianContext.newPage();
    await use(page);
    await page.close();
  },

  viewerPage: async ({ viewerContext }, use) => {
    const page = await viewerContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect };
