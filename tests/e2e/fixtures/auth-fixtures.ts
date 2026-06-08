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
import {
  test as base,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { inArray } from "drizzle-orm";
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
  seededData: SeededChainData;
  seedTestData: () => Promise<void>;
  cleanupTestData: () => Promise<void>;
}

export type { SeededChainData };

interface WorkerAuthData {
  users: Record<UserRole, TestUser>;
  authStates: Record<UserRole, AuthStorageState>;
  cleanupTestData: () => Promise<void>;
}

interface AuthStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax" | "Strict" | "None";
    expires: number;
  }>;
  origins: [];
}

// Generate unique test IDs to avoid collisions
const testRunId = crypto.randomUUID().slice(0, 8);
const SESSION_COOKIE_NAME = "better-auth.session_token";

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
): Promise<{ users: Record<UserRole, TestUser> }> {
  const { db, pool } = createDbConnection();

  try {
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
    });

    return { users: seededUsers };
  } finally {
    await pool.end();
  }
}

/**
 * Clean up test data from the database
 */
async function cleanupAuthUsers(
  users: Record<UserRole, TestUser>
): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    const userIds = Object.values(users).map((u) => u.id);

    await db.transaction(async (tx) => {
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

export async function cleanupTestData(
  users: Record<UserRole, TestUser>
): Promise<void> {
  await cleanupAuthUsers(users);
}

function buildAuthStorageState(
  cookies: AuthStorageState["cookies"]
): AuthStorageState {
  return {
    cookies,
    origins: [],
  };
}

async function createSignedAuthStorageState(
  user: TestUser,
  baseURL: string
): Promise<AuthStorageState> {
  const signInUrl = `${baseURL}/api/auth/sign-in/email`;
  const userIdForError = user.id ?? "unknown-user-id";
  const url = new URL(baseURL);
  let response: Response | null = null;
  let lastError: unknown;

  // The dev server can accept page requests before the auth route is ready.
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      response = await fetch(signInUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseURL },
        body: JSON.stringify({ email: user.email, password: user.password }),
        redirect: "manual",
      });
      if (response.ok || (response.status !== 404 && response.status < 500)) {
        break;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt === 10) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }

  if (!response) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`API sign-in failed for ${userIdForError}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API sign-in failed for ${userIdForError}: ${response.status} ${body}`);
  }

  const cookies = response.headers
    .getSetCookie()
    .map((header) => {
      const [nameValue, ...attrs] = header.split(";");
      const [name, ...valueParts] = nameValue!.split("=");
      const value = valueParts.join("=");
      const attrMap: Record<string, string> = {};

      for (const attr of attrs) {
        const [key, val] = attr.trim().split("=");
        attrMap[key!.toLowerCase()] = val || "";
      }

      const maxAge = Number(attrMap["max-age"]);
      const expires = Number.isFinite(maxAge)
        ? Math.floor(Date.now() / 1000) + maxAge
        : -1;
      const rawSameSite = attrMap.samesite?.toLowerCase();
      let sameSite: "Lax" | "Strict" | "None" | undefined;

      if (rawSameSite === "lax") {
        sameSite = "Lax";
      } else if (rawSameSite === "strict") {
        sameSite = "Strict";
      } else if (rawSameSite === "none") {
        sameSite = "None";
      }

      return {
        name: name!.trim(),
        value,
        domain: attrMap.domain || url.hostname,
        path: attrMap.path || "/",
        httpOnly: "httponly" in attrMap,
        secure: "secure" in attrMap,
        sameSite,
        expires,
      };
    })
    .filter((cookie) => cookie.name && cookie.value);

  const normalizedCookies = cookies.map((cookie) => ({
    ...cookie,
    domain: cookie.domain || url.hostname,
    sameSite: cookie.sameSite || "Lax",
    secure: cookie.secure || url.protocol === "https:",
  }));

  const hasSessionCookie = normalizedCookies.some(
    (cookie) => cookie.name === SESSION_COOKIE_NAME
  );

  if (!hasSessionCookie) {
    const cookieNames = normalizedCookies.map((cookie) => cookie.name).join(", ") || "<none>";
    throw new Error(
      `API sign-in did not return a session cookie for ${userIdForError}: ` +
        `${response.status} ${response.url} cookies=${cookieNames}`
    );
  }

  return buildAuthStorageState(normalizedCookies);
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

// Extended test fixture with auth helpers
export const test = base.extend<AuthFixtures, { workerAuthData: WorkerAuthData }>({
  workerAuthData: [
    async ({}, use) => {
      const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
      let users: Record<UserRole, TestUser> | null = null;
      let cleanedUp = false;

      const cleanupBoundTestData = async () => {
        if (cleanedUp || !users) {
          return;
        }
        cleanedUp = true;
        await cleanupTestData(users);
      };

      try {
        const seeded = await seedTestUsers(defaultTestUsers);
        users = seeded.users;

        const authStates: Record<UserRole, AuthStorageState> = {
          admin: await createSignedAuthStorageState(users.admin, baseURL),
          operator: await createSignedAuthStorageState(users.operator, baseURL),
          lab_technician: await createSignedAuthStorageState(
            users.lab_technician,
            baseURL
          ),
          viewer: await createSignedAuthStorageState(users.viewer, baseURL),
        };

        await use({
          users,
          authStates,
          cleanupTestData: cleanupBoundTestData,
        });
      } finally {
        await cleanupBoundTestData();
      }
    },
    { scope: "worker" },
  ],

  testUsers: async ({ workerAuthData }, use) => {
    await use(workerAuthData.users);
  },

  seededData: async ({}, use) => {
    // Generate a unique seed ID per test to avoid collisions between
    // parallel tests in the same worker that share the module-level testRunId
    const seedId = crypto.randomUUID().slice(0, 8);
    const data = await seedChainData(seedId);
    try {
      await use(data);
    } finally {
      await cleanupChainData(data);
    }
  },

  seedTestData: async ({ testUsers, seededData }, use) => {
    const seedFn = async () => {
      console.log(
        `Test data ready: ${Object.keys(testUsers).length} users, facility: ${seededData.facility.code}`
      );
    };
    await use(seedFn);
  },

  cleanupTestData: async ({ workerAuthData }, use) => {
    await use(workerAuthData.cleanupTestData);
  },

  adminContext: async ({ browser, workerAuthData }, use) => {
    const context = await browser.newContext({
      storageState: workerAuthData.authStates.admin,
    });

    await use(context);
    await context.close();
  },

  operatorContext: async ({ browser, workerAuthData }, use) => {
    const context = await browser.newContext({
      storageState: workerAuthData.authStates.operator,
    });

    await use(context);
    await context.close();
  },

  labTechnicianContext: async ({ browser, workerAuthData }, use) => {
    const context = await browser.newContext({
      storageState: workerAuthData.authStates.lab_technician,
    });

    await use(context);
    await context.close();
  },

  viewerContext: async ({ browser, workerAuthData }, use) => {
    const context = await browser.newContext({
      storageState: workerAuthData.authStates.viewer,
    });

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
