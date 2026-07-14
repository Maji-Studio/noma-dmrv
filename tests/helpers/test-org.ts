import { db, type DbTransaction } from "@/db";
import { organizations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";

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
  dbOrTx: typeof db | DbTransaction = db,
): Promise<void> {
  await dbOrTx
    .insert(organizations)
    .values({ id: TEST_ORG_ID, name: TEST_ORG_NAME, slug: TEST_ORG_SLUG })
    .onConflictDoNothing({ target: organizations.id });
}
