/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture "use", not a React hook */
/**
 * Sign-in fixture for the form capture. Unlike the E2E `adminPage`, it seeds
 * and deletes no users: it signs in once through Better Auth's HTTP API as the
 * existing local admin (ADMIN_EMAIL / ADMIN_PASSWORD from .env.local, which
 * `pnpm db:reset` creates), enters the default organization, and signs out at
 * the end. The only rows it touches are that one session (created at sign-in,
 * its active organization set on entry, deleted at sign-out).
 */
import { readFileSync } from "node:fs";
import { test as base, type Locator, type Page } from "@playwright/test";
import { parse } from "dotenv";
import { createDirectAuthContext } from "../e2e/fixtures/auth-fixtures";
import { enterDefaultOrganization } from "../e2e/fixtures/organization-helpers";

const LOCAL_ENV_FILE = ".env.local";

export interface CaptureSession {
  page: Page;
  /** Locators for the signed-in account's name and email, masked in page captures. */
  accountMask: () => Locator[];
}

function adminCredentials(): { email: string; password: string } {
  const local = (() => {
    try {
      return parse(readFileSync(LOCAL_ENV_FILE));
    } catch {
      return {} as Record<string, string>;
    }
  })();
  const email = process.env.FORM_CAPTURE_EMAIL ?? local.ADMIN_EMAIL;
  const password = process.env.FORM_CAPTURE_PASSWORD ?? local.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("Form capture needs ADMIN_EMAIL and ADMIN_PASSWORD in .env.local (or FORM_CAPTURE_EMAIL / FORM_CAPTURE_PASSWORD).");
  }
  return { email, password };
}

export const test = base.extend<{ capture: CaptureSession }>({
  capture: async ({ browser, baseURL }, use) => {
    if (!baseURL) throw new Error("Form capture needs a baseURL (NEXT_PUBLIC_APP_URL).");
    const { email, password } = adminCredentials();
    const context = await createDirectAuthContext(browser, { id: "form-capture-admin", email, password, name: "", role: "admin" }, baseURL);
    const page = await context.newPage();
    const session = (await (await page.request.get("/api/auth/get-session")).json()) as { user?: { name?: string } } | null;
    const name = session?.user?.name;
    try {
      await enterDefaultOrganization(page);
      await use({
        page,
        accountMask: () => {
          // The name is matched only in the sidebar account row: it can equal ordinary copy ("Admin").
          const accountRow = page.locator("aside div").filter({ has: page.getByRole("button", { name: "Sign out", exact: true }) }).last();
          return [page.getByText(email, { exact: true }), ...(name ? [accountRow.getByText(name, { exact: true })] : [])];
        },
      });
    } finally {
      // Better Auth only ends the session for a JSON body; without one it answers 200 and keeps the row.
      const signOut = await page.request.post("/api/auth/sign-out", { headers: { Origin: baseURL }, data: {} }).catch(() => null);
      if (!signOut?.ok()) console.warn(`[form-capture] sign-out failed (${signOut?.status() ?? "no response"}); the capture session row remains.`);
      await context.close();
    }
  },
});

export { expect } from "@playwright/test";
