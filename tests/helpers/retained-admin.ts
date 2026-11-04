import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { members, users } from "@/db/schema";

// A reusable fixture identity, like the shared test organization. Memberships
// cascade with each fixture organization; the identity stays for later suites.
const RETAINED_ADMIN_ID = "user_test_retained_admin";
export async function retainFixtureAdmin(organizationId: string) {
  await db.insert(users).values({ id: RETAINED_ADMIN_ID, name: "Fixture Admin", email: "retained-admin@example.test", emailVerified: true }).onConflictDoNothing();
  await db.insert(members).values({ id: randomUUID(), userId: RETAINED_ADMIN_ID, organizationId, role: "admin" }).onConflictDoNothing();
}
