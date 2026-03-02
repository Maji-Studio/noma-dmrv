/**
 * Playwright E2E Test Fixtures
 *
 * Export all fixtures and helpers for authenticated E2E tests.
 *
 * Usage:
 * ```typescript
 * import { test, expect, TestDataBuilder } from './fixtures';
 *
 * test('admin can access dashboard', async ({ adminPage }) => {
 *   await adminPage.goto('/dashboard');
 *   await expect(adminPage).toHaveURL('/dashboard');
 * });
 * ```
 */

// Main test fixture with auth helpers
export {
  test,
  expect,
  type UserRole,
  type ProjectRole,
  type TestUser,
  type AuthFixtures,
  type SeededChainData,
  seedTestUsers,
  cleanupTestData,
  authenticatePage,
  createAuthenticatedContext,
  createDirectSession,
  setAuthCookies,
} from "./auth-fixtures";

export {
  seedChainData,
  cleanupChainData,
} from "./seed-chain-data";

// Test data seeding helpers
export {
  type TestProject,
  type TestItem,
  type TestFacility,
  type TestSupplier,
  type TestFormulation,
  type TestBiocharProduct,
  type TestApplication,
  generateTestId,
  createTestProject,
  addProjectMember,
  createTestItem,
  createTestFacility,
  createTestSupplier,
  createTestFormulation,
  createTestBiocharProduct,
  createTestApplication,
  deleteTestProject,
  deleteTestItems,
  deleteTestFacility,
  deleteTestSupplier,
  deleteTestFormulation,
  deleteTestBiocharProduct,
  deleteTestApplication,
  bulkCleanup,
  TestDataBuilder,
  createTestScenario,
} from "./test-data-helpers";
