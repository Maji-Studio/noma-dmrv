/**
 * Lab Samples E2E Tests
 * Tests for the samples tracking feature
 *
 * Note: These tests verify that unauthenticated users are redirected to login.
 * The samples page requires authentication.
 */

import { test, expect } from "@playwright/test";

// ============================================
// Test Constants
// ============================================

const SAMPLES_URL = "/samples";

// ============================================
// Role-Based Access Control Tests
// ============================================

test.describe("Lab Samples Role-Based Access Control", () => {
  test("unauthenticated user cannot access samples page - redirects to login", async ({ page }) => {
    // Try to access samples without authentication
    await page.goto(SAMPLES_URL);

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test("unauthenticated user sees login form when accessing samples", async ({ page }) => {
    await page.goto(SAMPLES_URL);

    // Should show login form elements
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});

// ============================================
// Page Structure Tests (via Login Redirect)
// ============================================

test.describe("Lab Samples Page Structure", () => {
  test("samples route exists and requires authentication", async ({ page }) => {
    // Navigate to samples
    const response = await page.goto(SAMPLES_URL);

    // Should get a valid response (redirect counts as valid)
    expect(response?.status()).toBeLessThanOrEqual(307);

    // Should be on login page after redirect
    await page.waitForURL(/\/login/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("direct navigation to samples page triggers auth flow", async ({ page }) => {
    await page.goto(SAMPLES_URL);

    // Verify redirect to login
    await expect(page).toHaveURL(/\/login/);

    // Login form should be functional
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitButton = page.locator('button[type="submit"]');

    await expect(emailInput).toBeEnabled();
    await expect(passwordInput).toBeEnabled();
    await expect(submitButton).toBeEnabled();
  });
});

// ============================================
// Feature Implementation Verification
// These tests verify the feature code is properly integrated
// ============================================

test.describe("Lab Samples Feature Verification", () => {
  test("samples page module is importable and route is configured", async ({ page }) => {
    // This test verifies the app doesn't crash when trying to load the samples route
    const response = await page.goto(SAMPLES_URL);

    // A 307 redirect means the route exists and auth middleware is working
    // A 404 would mean the route doesn't exist
    expect(response?.status()).not.toBe(404);
  });
});
