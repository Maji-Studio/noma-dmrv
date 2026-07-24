import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  getRegistrySourceVisibility,
  upsertRegistrySourceVisibility,
} from "@/data-access/certifier-organization-settings";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { certifierOrganizationSettings } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";

const ORGANIZATION_ID = "org_test_registry_source_visibility";
const PROVIDER = "isometric" as const;
const ORG_CONTEXT: OrgContext = {
  userId: "test-registry-source-visibility",
  organizationId: ORGANIZATION_ID,
  orgRole: "admin",
  isPlatformAdmin: false,
};

async function clearSettings() {
  await db
    .delete(certifierOrganizationSettings)
    .where(
      and(
        eq(certifierOrganizationSettings.organizationId, ORGANIZATION_ID),
        eq(certifierOrganizationSettings.provider, PROVIDER),
      ),
    );
}

beforeAll(async () => {
  await db
    .insert(organizations)
    .values({
      id: ORGANIZATION_ID,
      name: "Registry Source Visibility Test",
      slug: "registry-source-visibility-test",
    })
    .onConflictDoNothing({ target: organizations.id });
});

beforeEach(clearSettings);

afterAll(async () => {
  await clearSettings();
  await db.delete(organizations).where(eq(organizations.id, ORGANIZATION_ID));
});

describe.sequential("certifier organization settings data access", () => {
  it("defaults registry Sources to private when no policy row exists", async () => {
    await expect(
      getRegistrySourceVisibility(ORG_CONTEXT, PROVIDER),
    ).resolves.toBe("private");
  });

  it("upserts one organization/provider policy row", async () => {
    await expect(
      upsertRegistrySourceVisibility(ORG_CONTEXT, {
        provider: PROVIDER,
        sourceVisibility: "public",
      }),
    ).resolves.toBe("public");
    await expect(
      upsertRegistrySourceVisibility(ORG_CONTEXT, {
        provider: PROVIDER,
        sourceVisibility: "private",
      }),
    ).resolves.toBe("private");
    await expect(
      getRegistrySourceVisibility(ORG_CONTEXT, PROVIDER),
    ).resolves.toBe("private");

    const rows = await db
      .select()
      .from(certifierOrganizationSettings)
      .where(
        and(
          eq(certifierOrganizationSettings.organizationId, ORGANIZATION_ID),
          eq(certifierOrganizationSettings.provider, PROVIDER),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
