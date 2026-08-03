/**
 * DB-backed tests for the organization operating defaults. Requires the real
 * Postgres configured by the test environment.
 *
 * The behaviour worth pinning is the one every consumer relies on: the read
 * never returns null, so no form has to decide what "no settings row" means.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

import { db } from "@/db";
import { DEFAULT_ORGANIZATION_SETTINGS } from "@/config/organization-settings";
import {
  getOrganizationDefaults,
  upsertOrganizationDefaults,
} from "@/data-access/organization-settings";
import { organizationSettings } from "@/db/schema/settings";

async function clearSettings(): Promise<void> {
  await db
    .delete(organizationSettings)
    .where(eq(organizationSettings.organizationId, TEST_ORG_ID));
}

beforeAll(() => ensureTestOrg());
beforeEach(clearSettings);
afterAll(clearSettings);

describe.sequential("organization operating defaults", () => {
  it("falls back to the system defaults for an organization with no row", async () => {
    await expect(
      getOrganizationDefaults(makeTestOrgContext()),
    ).resolves.toEqual(DEFAULT_ORGANIZATION_SETTINGS);
  });

  it("round-trips a saved set of defaults", async () => {
    const ctx = makeTestOrgContext();
    const values = {
      defaultCurrency: "KES" as const,
      defaultCountry: "Kenya",
      defaultTimezone: "Africa/Nairobi",
      defaultTripType: "one_way" as const,
      defaultEvidenceMethod: "boundary" as const,
      defaultPackaging: "bagged" as const,
    };

    await expect(upsertOrganizationDefaults(ctx, values)).resolves.toEqual(
      values,
    );
    await expect(getOrganizationDefaults(ctx)).resolves.toEqual(values);
  });

  it("updates the existing row rather than inserting a second one", async () => {
    const ctx = makeTestOrgContext();
    await upsertOrganizationDefaults(ctx, {
      ...DEFAULT_ORGANIZATION_SETTINGS,
      defaultCurrency: "USD",
    });
    await upsertOrganizationDefaults(ctx, {
      ...DEFAULT_ORGANIZATION_SETTINGS,
      defaultCurrency: "EUR",
    });

    const rows = await db
      .select({ id: organizationSettings.id })
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, TEST_ORG_ID));

    expect(rows).toHaveLength(1);
    await expect(getOrganizationDefaults(ctx)).resolves.toMatchObject({
      defaultCurrency: "EUR",
    });
  });

  it("keeps an unset country null rather than storing a placeholder", async () => {
    // Facility and party rows persist `'UNKNOWN'` today. A default nobody chose
    // should not look chosen, so the organization-level field stays null.
    const ctx = makeTestOrgContext();
    await upsertOrganizationDefaults(ctx, {
      ...DEFAULT_ORGANIZATION_SETTINGS,
      defaultCountry: null,
    });

    await expect(getOrganizationDefaults(ctx)).resolves.toMatchObject({
      defaultCountry: null,
    });
  });

  it("refuses a write from a member", async () => {
    const ctx = { ...makeTestOrgContext(), orgRole: "member" as const };
    await expect(
      upsertOrganizationDefaults(ctx, DEFAULT_ORGANIZATION_SETTINGS),
    ).rejects.toThrow();
  });

  it("lets any member read them — every member's forms are seeded from these", async () => {
    const ctx = { ...makeTestOrgContext(), orgRole: "member" as const };
    await expect(getOrganizationDefaults(ctx)).resolves.toEqual(
      DEFAULT_ORGANIZATION_SETTINGS,
    );
  });
});
