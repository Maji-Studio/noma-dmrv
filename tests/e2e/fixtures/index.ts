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

// Shared page interaction helpers
export {
  waitForSideSheet,
  waitForSideSheetClose,
  selectEntity,
  selectFirstEntity,
} from "./page-helpers";

// Test data seeding helpers
export {
  type TestFacility,
  type TestSupplier,
  type TestFormulation,
  type TestStorageLocation,
  type TestBiocharProduct,
  type TestApplication,
  generateTestId,
  createTestFacility,
  createTestSupplier,
  createTestFormulation,
  createTestStorageLocation,
  createTestBiocharProduct,
  createTestApplication,
  deleteTestFacility,
  deleteTestSupplier,
  deleteTestFormulation,
  deleteTestStorageLocation,
  deleteTestBiocharProduct,
  deleteTestApplication,
  bulkCleanup,
  TestDataBuilder,
} from "./test-data-helpers";
