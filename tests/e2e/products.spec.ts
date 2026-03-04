/**
 * Products E2E Tests
 *
 * Comprehensive Playwright tests covering:
 * - Formulations CRUD operations
 * - Biochar Products CRUD operations
 * - Role-based access control (authentication redirects)
 * - Database integration tests via test helpers
 *
 * Note: These tests focus on database operations and authentication redirects.
 * UI tests would require authenticated sessions.
 */
import { test, expect } from "@playwright/test";
import {
  generateTestId,
  createTestFacility,
  createTestFormulation,
  createTestBiocharProduct,
  deleteTestFacility,
  deleteTestFormulation,
  deleteTestBiocharProduct,
  type TestFacility,
  type TestFormulation,
  type TestBiocharProduct,
} from "./fixtures";

// ============================================
// Test Constants
// ============================================

const FORMULATIONS_URL = "/formulations";
const BIOCHAR_PRODUCTS_URL = "/biochar-products";

// ============================================
// Formulations Role-Based Access Control Tests
// ============================================

test.describe("Formulations Role-Based Access Control", () => {
  test("unauthenticated user cannot access formulations page - redirects to login", async ({ page }) => {
    await page.goto(FORMULATIONS_URL);
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test("unauthenticated user sees login form when accessing formulations", async ({ page }) => {
    await page.goto(FORMULATIONS_URL);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});

// ============================================
// Biochar Products Role-Based Access Control Tests
// ============================================

test.describe("Biochar Products Role-Based Access Control", () => {
  test("unauthenticated user cannot access biochar products page - redirects to login", async ({ page }) => {
    await page.goto(BIOCHAR_PRODUCTS_URL);
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test("unauthenticated user sees login form when accessing biochar products", async ({ page }) => {
    await page.goto(BIOCHAR_PRODUCTS_URL);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});

// ============================================
// Formulations Database Operations Tests
// ============================================

test.describe("Formulations Database Operations", () => {
  test("can create formulation via test helper", async () => {
    const testId = generateTestId("form-create");
    const formulation = await createTestFormulation({
      code: `E2E-FORM-${testId.toUpperCase()}`,
      name: `Test Formulation ${testId}`,
      biocharRatio: 0.7,
    });

    expect(formulation).toBeDefined();
    expect(formulation.id).toBeDefined();
    expect(formulation.code).toContain("E2E-FORM-");
    expect(formulation.name).toContain("Test Formulation");
    expect(formulation.biocharRatio).toBe(0.7);

    // Clean up
    await deleteTestFormulation(formulation.id);
  });

  test("can delete formulation via test helper", async () => {
    const testId = generateTestId("form-delete");
    const formulation = await createTestFormulation({
      code: `E2E-DEL-${testId.toUpperCase()}`,
      name: `Delete Test Formulation ${testId}`,
    });

    expect(formulation.id).toBeDefined();

    // Delete should not throw
    await expect(deleteTestFormulation(formulation.id)).resolves.not.toThrow();
  });

  test("can create multiple formulations with unique codes", async () => {
    const formulations: TestFormulation[] = [];

    try {
      // Create multiple formulations
      for (let i = 0; i < 3; i++) {
        const testId = generateTestId(`multi-form-${i}`);
        const formulation = await createTestFormulation({
          code: `E2E-MULTI-${i}-${testId.toUpperCase()}`,
          name: `Multi Formulation ${i} ${testId}`,
          biocharRatio: 0.5 + i * 0.1,
            });
        formulations.push(formulation);
      }

      // Verify all created
      expect(formulations).toHaveLength(3);
      const codes = formulations.map((f) => f.code);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(3); // All codes should be unique
    } finally {
      // Clean up all
      for (const formulation of formulations) {
        await deleteTestFormulation(formulation.id);
      }
    }
  });

  test("formulation has required fields", async () => {
    const testId = generateTestId("form-fields");
    const formulation = await createTestFormulation({
      code: `E2E-FIELDS-${testId.toUpperCase()}`,
      name: `Fields Test ${testId}`,
      biocharRatio: 0.8,
      description: "Test description",
    });

    try {
      expect(formulation.id).toBeDefined();
      expect(typeof formulation.id).toBe("string");
      expect(formulation.code).toBeDefined();
      expect(formulation.name).toBeDefined();
      expect(formulation.biocharRatio).toBe(0.8);
    } finally {
      await deleteTestFormulation(formulation.id);
    }
  });
});

// ============================================
// Biochar Products Database Operations Tests
// ============================================

test.describe("Biochar Products Database Operations", () => {
  let testFacility: TestFacility;
  let testFormulation: TestFormulation;

  test.beforeAll(async () => {
    // Create prerequisite data with unique codes to avoid collisions
    const uniqueId = generateTestId("bp");
    testFacility = await createTestFacility({
      code: `E2E-BP-FAC-${uniqueId.toUpperCase()}`,
      name: `E2E Biochar Products Test Facility ${uniqueId}`,
      location: "Test Location",
    });

    testFormulation = await createTestFormulation({
      code: `E2E-BP-FORM-${uniqueId.toUpperCase()}`,
      name: `E2E Biochar Products Test Formulation ${uniqueId}`,
      biocharRatio: 0.7,
    });
  });

  test.afterAll(async () => {
    // Clean up prerequisite data
    if (testFormulation?.id) {
      await deleteTestFormulation(testFormulation.id);
    }
    if (testFacility?.id) {
      await deleteTestFacility(testFacility.id);
    }
  });

  test("can create biochar product via test helper", async () => {
    const testId = generateTestId("bp-create");
    const product = await createTestBiocharProduct(
      testFacility.id,
      testFormulation.id,
      {
        code: `E2E-BP-${testId.toUpperCase()}`,
        status: "testing",
        massKg: 500,
      }
    );

    expect(product).toBeDefined();
    expect(product.id).toBeDefined();
    expect(product.code).toContain("E2E-BP-");
    expect(product.facilityId).toBe(testFacility.id);
    expect(product.formulationId).toBe(testFormulation.id);
    expect(product.status).toBe("testing");
    expect(product.massKg).toBe(500);

    // Clean up
    await deleteTestBiocharProduct(product.id);
  });

  test("can delete biochar product via test helper", async () => {
    const testId = generateTestId("bp-delete");
    const product = await createTestBiocharProduct(
      testFacility.id,
      testFormulation.id,
      {
        code: `E2E-DEL-BP-${testId.toUpperCase()}`,
      }
    );

    expect(product.id).toBeDefined();

    // Delete should not throw
    await expect(deleteTestBiocharProduct(product.id)).resolves.not.toThrow();
  });

  test("can create biochar products with different statuses", async () => {
    const statuses: Array<"draft" | "testing" | "ready" | "sold"> = [
      "draft",
      "testing",
      "ready",
      "sold",
    ];
    const products: TestBiocharProduct[] = [];

    try {
      for (const status of statuses) {
        const testId = generateTestId(`bp-${status}`);
        const product = await createTestBiocharProduct(
          testFacility.id,
          testFormulation.id,
          {
            code: `E2E-${status.toUpperCase()}-${testId.toUpperCase()}`,
            status,
          }
        );
        products.push(product);
      }

      // Verify all created with correct statuses
      expect(products).toHaveLength(4);
      expect(products[0].status).toBe("draft");
      expect(products[1].status).toBe("testing");
      expect(products[2].status).toBe("ready");
      expect(products[3].status).toBe("sold");
    } finally {
      // Clean up all
      for (const product of products) {
        await deleteTestBiocharProduct(product.id);
      }
    }
  });

  test("biochar product has required fields and relations", async () => {
    const testId = generateTestId("bp-fields");
    const product = await createTestBiocharProduct(
      testFacility.id,
      testFormulation.id,
      {
        code: `E2E-FIELDS-${testId.toUpperCase()}`,
        status: "ready",
        massKg: 1000,
      }
    );

    try {
      expect(product.id).toBeDefined();
      expect(typeof product.id).toBe("string");
      expect(product.code).toBeDefined();
      expect(product.facilityId).toBe(testFacility.id);
      expect(product.formulationId).toBe(testFormulation.id);
      expect(product.productionDate).toBeDefined();
      expect(product.status).toBe("ready");
      expect(product.massKg).toBe(1000);
    } finally {
      await deleteTestBiocharProduct(product.id);
    }
  });
});

// ============================================
// URL Protection Tests
// ============================================

test.describe("Products URL Protection", () => {
  test("direct URL access to formulations is protected", async ({ page }) => {
    const protectedUrls = [
      FORMULATIONS_URL,
      `${FORMULATIONS_URL}/new`,
      `${FORMULATIONS_URL}/some-id`,
    ];

    for (const url of protectedUrls) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });

  test("direct URL access to biochar products is protected", async ({ page }) => {
    const protectedUrls = [
      BIOCHAR_PRODUCTS_URL,
      `${BIOCHAR_PRODUCTS_URL}/new`,
      `${BIOCHAR_PRODUCTS_URL}/some-id`,
    ];

    for (const url of protectedUrls) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });
});

// ============================================
// Test ID Generation Tests
// ============================================

test.describe("Products Test Utilities", () => {
  test("generateTestId produces unique IDs for formulations", () => {
    const ids = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const id = generateTestId("formulation");
      ids.add(id);
    }

    // All IDs should be unique
    expect(ids.size).toBe(10);
  });

  test("generateTestId produces unique IDs for biochar products", () => {
    const ids = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const id = generateTestId("biochar-product");
      ids.add(id);
    }

    // All IDs should be unique
    expect(ids.size).toBe(10);
  });
});
