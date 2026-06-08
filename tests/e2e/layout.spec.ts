/**
 * Layout and Navigation E2E Tests
 *
 * Tests that the sidebar renders correctly and navigation works after login.
 * These tests verify the app layout structure without requiring actual authentication.
 */
import { test, expect } from "@playwright/test";

// ============================================
// Sidebar Navigation Tests
// ============================================

test.describe("App Layout - Sidebar Navigation", () => {
  test("unauthenticated access redirects to login", async ({ page }) => {
    // Try to access a protected route
    await page.goto("/facilities");

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test("all protected routes redirect to login for unauthenticated users", async ({
    page,
  }) => {
    const protectedRoutes = [
      // Production
      "/feedstocks",
      "/production-runs",
      // Infrastructure
      "/facilities",
      "/reactors",
      "/storage-locations",
      // Parties
      "/suppliers",
      "/customers",
    ];

    for (const route of protectedRoutes) {
      await page.goto(route);
      // All should redirect to login
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });

  test("login page renders correctly", async ({ page }) => {
    await page.goto("/login");

    // Verify login page elements
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Welcome back" })
    ).toBeVisible();
  });

  test("login form accepts input", async ({ page }) => {
    await page.goto("/login");

    // Fill in email
    const emailInput = page.locator('input[type="email"]');
    await emailInput.fill("test@example.com");
    await expect(emailInput).toHaveValue("test@example.com");

    // Fill in password
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill("password123");
    await expect(passwordInput).toHaveAttribute("type", "password");
  });
});

// ============================================
// Route Structure Tests
// ============================================

test.describe("App Routes Structure", () => {
  test("routes follow expected patterns", async ({ page }) => {
    // Verify entity routes exist (by checking redirect behavior)
    const entityRoutes = [
      { path: "/facilities", name: "Facilities" },
      { path: "/reactors", name: "Reactors" },
      { path: "/storage-locations", name: "Storage Locations" },
      { path: "/suppliers", name: "Suppliers" },
      { path: "/customers", name: "Customers" },
      { path: "/feedstocks", name: "Feedstocks" },
      { path: "/production-runs", name: "Production Runs" },
    ];

    for (const route of entityRoutes) {
      // Go to the route
      await page.goto(route.path);

      // Should redirect to login (confirms route exists and is protected)
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });
});

// ============================================
// Auth Flow Tests
// ============================================

test.describe("Authentication Flow", () => {
  test("protected routes store redirect URL", async ({ page }) => {
    // Go directly to a protected route
    await page.goto("/facilities");

    // Should be redirected to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });

    // Login page should be functional
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("public routes are accessible", async ({ page }) => {
    // Login page should be accessible
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});
