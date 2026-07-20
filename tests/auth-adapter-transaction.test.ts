import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth/better-auth";

let triggerName: string | null = null;
let functionName: string | null = null;
let testEmail: string | null = null;

afterEach(async () => {
  if (triggerName) {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${triggerName}" ON account`));
  }
  if (functionName) {
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${functionName}"()`));
  }
  if (testEmail) {
    await db.delete(users).where(eq(users.email, testEmail));
  }
  triggerName = null;
  functionName = null;
  testEmail = null;
});

describe("Better Auth Drizzle adapter transactions", () => {
  it("rolls back the user when credential-account creation fails", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    triggerName = `test_fail_account_${suffix}`;
    functionName = `test_fail_account_fn_${suffix}`;
    testEmail = `rollback-${suffix}@example.test`;

    await db.execute(sql.raw(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM users
          WHERE id = NEW.user_id AND email = '${testEmail}'
        ) THEN
          RAISE EXCEPTION 'injected credential-account failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON account
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `));

    const { internalAdapter } = await auth.$context;
    await expect(
      internalAdapter.createOAuthUser(
        { email: testEmail, name: "Rollback Fixture", emailVerified: true },
        {
          accountId: testEmail,
          providerId: "credential",
          password: "already-hashed-test-password",
        },
      ),
    ).rejects.toThrow();

    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, testEmail));
    expect(rows).toEqual([]);
  });
});
