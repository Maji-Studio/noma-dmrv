import type { db, DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";

export const TEST_SITE_POSITION = { country: "Tanzania", gpsLatitude: -8.3, gpsLongitude: 35.3 } as const;

export const TEST_ORG_ID = "org_test_fixtures";
const TEST_ORG_NAME = "Unit Test Fixtures";
const TEST_ORG_SLUG = "unit-test-fixtures";
const DEFAULT_TEST_USER_ID = "user_test_fixtures";

export function makeTestOrgContext(
  userId = DEFAULT_TEST_USER_ID,
): OrgContext {
  return {
    userId,
    organizationId: TEST_ORG_ID,
    orgRole: "owner",
    isPlatformAdmin: false,
  };
}

export async function ensureTestOrg(
  dbOrTx?: typeof db | DbTransaction,
): Promise<void> {
  const database = dbOrTx ?? (await import("@/db")).db;
  const { organizations } = await import("@/db/schema/auth");
  await database
    .insert(organizations)
    .values({ id: TEST_ORG_ID, name: TEST_ORG_NAME, slug: TEST_ORG_SLUG })
    .onConflictDoNothing();
}
