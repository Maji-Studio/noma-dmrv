import { expect, test as base, type Page } from "@playwright/test";
import {
  authorizeUrl, createE2EOAuthClient, createE2EOAuthPerson, E2E_OAUTH_CALLBACK_PATH, readE2EOAuthConsentScopes, removeE2EOAuthClient, removeE2EOAuthPerson, seedE2EOAuthStepUp,
  type E2EOAuthClient, type E2EOAuthPerson,
} from "./fixtures/oauth-helpers";

const UI_TIMEOUT_MS = 30_000;
const READ_SCOPES = "feedstocks:read orders:read offline_access";
const STEP_UP_SCOPES = "feedstocks:read feedstocks:write orders:read offline_access";
const ALL_SCOPES = STEP_UP_SCOPES;
const CLIENT_SCOPES = ["feedstocks:read", "feedstocks:write", "orders:read", "offline_access"];

const test = base.extend<{ client: E2EOAuthClient; person: E2EOAuthPerson }>({
  client: async ({}, provide) => {
    const client = await createE2EOAuthClient(CLIENT_SCOPES);
    try { await provide(client); } finally { await removeE2EOAuthClient(client); }
  },
  person: async ({}, provide) => {
    const person = await createE2EOAuthPerson(2);
    try { await provide(person); } finally { await removeE2EOAuthPerson(person); }
  },
});

async function signIn(page: Page, person: E2EOAuthPerson) {
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await page.getByLabel("Email address").fill(person.email);
  await page.getByLabel("Password").fill(person.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function expectCallback(page: Page, expected: { code?: boolean; error?: string; state: string }) {
  await page.waitForURL(url => url.pathname === E2E_OAUTH_CALLBACK_PATH, { timeout: UI_TIMEOUT_MS });
  const url = new URL(page.url());
  expect(url.searchParams.get("state")).toBe(expected.state);
  if (expected.error) {
    expect(url.searchParams.get("error")).toBe(expected.error);
    expect(url.searchParams.has("code")).toBe(false);
  } else {
    expect(url.searchParams.has("code")).toBe(true);
    expect(url.searchParams.get("iss")).toBe(`${url.origin}/api/auth`);
  }
}

test("a signed-out start goes through sign-in, the picker and a read-only consent to a code", async ({ page, client, person }) => {
  await page.goto(authorizeUrl(client, ALL_SCOPES, "e2e-state-1"));
  await signIn(page, person);

  await expect(page.getByRole("heading", { name: "Choose an organization", level: 1 })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(page.getByText("E2E OAuth client will act for you in one organization. To use another, connect again.")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(2);
  await page.getByRole("radio", { name: /E2E OAuth Organization B/ }).check({ force: true });
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Allow E2E OAuth client to use noma?", level: 1 })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(page.getByText(/wants to act for you in E2E OAuth Organization B\./)).toBeVisible();
  // Writes are offered, but Read only is the default and the board stays closed.
  await expect(page.getByRole("radio", { name: /^Read only/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /^Read and write/ })).not.toBeChecked();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("Stay connected: E2E OAuth client can keep working without asking you to sign in again")).toBeVisible();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expectCallback(page, { state: "e2e-state-1" });
  expect((await readE2EOAuthConsentScopes(client.clientId, person.userId)).sort()).toEqual(READ_SCOPES.split(" ").sort());
});

test("Choose per area: a write switched on brings its read, and only the picked scopes are stored", async ({ page, client, person }) => {
  await page.goto(authorizeUrl(client, ALL_SCOPES, "e2e-state-7"));
  await signIn(page, person);
  await page.getByRole("radio", { name: /E2E OAuth Organization A/ }).check({ force: true });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Allow E2E OAuth client to use noma?", level: 1 })).toBeVisible({ timeout: UI_TIMEOUT_MS });

  await page.getByRole("radio", { name: /^Choose per area/ }).check({ force: true });
  await expect(page.getByRole("checkbox", { name: "Orders, write", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Orders, read", exact: true }).uncheck({ force: true });
  await page.getByRole("checkbox", { name: "Feedstocks, read", exact: true }).uncheck({ force: true });
  await page.getByRole("checkbox", { name: "Feedstocks, write", exact: true }).check({ force: true });
  await expect(page.getByRole("checkbox", { name: "Feedstocks, read", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expectCallback(page, { state: "e2e-state-7" });
  expect((await readE2EOAuthConsentScopes(client.clientId, person.userId)).sort()).toEqual(["feedstocks:read", "feedstocks:write", "offline_access"]);
});

test("the same scopes re-offer the three choices, and a step-up lists the refused write first with New, ticked", async ({ page, client, person }) => {
  await page.goto(authorizeUrl(client, ALL_SCOPES, "e2e-state-2"));
  await signIn(page, person);
  await page.getByRole("radio", { name: /E2E OAuth Organization A/ }).check({ force: true });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("radio", { name: /^Read and write/ }).check({ force: true });
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expectCallback(page, { state: "e2e-state-2" });

  // Same scopes: the picker preselects the connected organization and consent is offered again.
  await page.goto(authorizeUrl(client, ALL_SCOPES, "e2e-state-3"));
  await expect(page.getByRole("radio", { name: /E2E OAuth Organization A/ })).toBeChecked({ timeout: UI_TIMEOUT_MS });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Allow E2E OAuth client to use noma?", level: 1 })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(page.getByRole("radio", { name: /^Read only/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Read and write/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Choose per area/ })).toBeVisible();
  await page.getByRole("radio", { name: /^Read only/ }).check({ force: true });
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expectCallback(page, { state: "e2e-state-3" });

  // Step-up: the write the app was refused is ticked and marked New, because the 403 left a hint.
  const clearHint = await seedE2EOAuthStepUp({ client, organizationId: person.organizations[0].id, userId: person.userId, scopes: ["feedstocks:write"] });
  try {
    await page.goto(authorizeUrl(client, STEP_UP_SCOPES, "e2e-state-4"));
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Allow E2E OAuth client to use noma?", level: 1 })).toBeVisible({ timeout: UI_TIMEOUT_MS });
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Feedstocks, write", exact: true })).toBeChecked();
    await expect(page.getByRole("row", { name: /Feedstocks.*New/ })).toBeVisible();
    await expect(page.getByText("Orders, read, already allowed")).toBeVisible();
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await expectCallback(page, { state: "e2e-state-4" });
  } finally { await clearHint(); }
  // Accepting replaces the stored consent, so it must keep what was already allowed and offline_access.
  expect((await readE2EOAuthConsentScopes(client.clientId, person.userId)).sort()).toEqual(STEP_UP_SCOPES.split(" ").sort());
});

test("a reconnect with a stored consent shows the three choices, and Read only narrows the stored consent", async ({ page, client, person }) => {
  await page.goto(authorizeUrl(client, ALL_SCOPES, "e2e-state-8"));
  await signIn(page, person);
  await page.getByRole("radio", { name: /E2E OAuth Organization A/ }).check({ force: true });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("radio", { name: /^Read and write/ }).check({ force: true });
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expectCallback(page, { state: "e2e-state-8" });
  expect((await readE2EOAuthConsentScopes(client.clientId, person.userId)).sort()).toEqual(ALL_SCOPES.split(" ").sort());

  // claude.ai Disconnect sends no revoke, so the next connect finds the stored consent and still offers the choices.
  await page.goto(authorizeUrl(client, ALL_SCOPES, "e2e-state-9"));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Allow E2E OAuth client to use noma?", level: 1 })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(page.getByRole("radio", { name: /^Read only/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Read and write/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Choose per area/ })).toBeVisible();
  await page.getByRole("radio", { name: /^Read only/ }).check({ force: true });
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expectCallback(page, { state: "e2e-state-9" });
  expect((await readE2EOAuthConsentScopes(client.clientId, person.userId)).sort()).toEqual(READ_SCOPES.split(" ").sort());
});

test("Deny returns access_denied", async ({ page, client, person }) => {
  await page.goto(authorizeUrl(client, READ_SCOPES, "e2e-state-5"));
  await signIn(page, person);
  await page.getByRole("radio", { name: /E2E OAuth Organization A/ }).check({ force: true });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expectCallback(page, { error: "access_denied", state: "e2e-state-5" });
});

test("the picker lists an organization with API access off as disabled, with the reason", async ({ page, client }) => {
  const person = await createE2EOAuthPerson(3, { apiDisabledIndex: 2 });
  try {
    await page.goto(authorizeUrl(client, READ_SCOPES, "e2e-state-6"));
    await signIn(page, person);
    await expect(page.getByRole("heading", { name: "Choose an organization", level: 1 })).toBeVisible({ timeout: UI_TIMEOUT_MS });
    await expect(page.getByRole("radio", { name: /E2E OAuth Organization C/ })).toBeDisabled();
    await expect(page.getByText("API access is disabled for this organization.")).toBeVisible();
  } finally { await removeE2EOAuthPerson(person); }
});
