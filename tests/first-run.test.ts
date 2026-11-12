import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "better-auth/crypto";

// Exercise real Postgres with independent connections and no shared user-table
// mutations. The normal Vitest throwaway-database guard still applies.
const isolated = vi.hoisted(() => ({
  schema: `first_run_${crypto.randomUUID().replaceAll("-", "")}`,
  pool: undefined as import("pg").Pool | undefined,
}));
vi.mock("@/db", async () => {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  const { getPgPoolConfig } = await import("@/lib/pg-pool-config");
  isolated.pool = new Pool({
    ...getPgPoolConfig(process.env.DATABASE_URL!),
    options: `-c search_path=${isolated.schema}`,
  });
  return { db: drizzle(isolated.pool, { schema }) };
});

import { db } from "@/db";
import { accounts, organizations, users } from "@/db/schema";
import { createFirstPlatformAdmin, hasAnyUser } from "@/data-access/first-run";
import { SafeError } from "@/lib/errors";

const PASSWORD = "first-run-test-password";
const INPUT = { email: "  FIRST@Example.Test  ", password: PASSWORD };

beforeAll(async () => {
  await isolated.pool!.query(`CREATE SCHEMA "${isolated.schema}"`);
  // Clone the migrated table shapes and indexes, then restore the account FK
  // (LIKE does not copy foreign keys). No rows come from the public schema.
  for (const table of ["users", "account", "organizations"]) {
    await isolated.pool!.query(`CREATE TABLE "${isolated.schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
  }
  await isolated.pool!.query(`ALTER TABLE "${isolated.schema}".account ADD FOREIGN KEY (user_id) REFERENCES "${isolated.schema}".users(id) ON DELETE CASCADE`);
});

beforeEach(async () => {
  await isolated.pool!.query(`TRUNCATE "${isolated.schema}".account, "${isolated.schema}".users, "${isolated.schema}".organizations`);
});

afterAll(async () => {
  try {
    await isolated.pool!.query(`DROP SCHEMA IF EXISTS "${isolated.schema}" CASCADE`);
  } finally {
    await isolated.pool!.end();
  }
});

describe("first-run bootstrap (real database)", () => {
  it("creates exactly one verified Platform Admin and a usable credential, with no organization", async () => {
    expect(await hasAnyUser()).toBe(false);
    const created = await createFirstPlatformAdmin(INPUT);
    expect(await hasAnyUser()).toBe(true);
    expect(await db.select().from(users)).toEqual([expect.objectContaining({
      id: created.userId, email: "first@example.test", name: "Admin", role: "admin", emailVerified: true,
    })]);
    const credentials = await db.select().from(accounts);
    expect(credentials).toEqual([expect.objectContaining({
      userId: created.userId, accountId: created.userId, providerId: "credential",
    })]);
    expect(credentials[0].password).not.toBe(PASSWORD);
    expect(await verifyPassword({ password: PASSWORD, hash: credentials[0].password! })).toBe(true);
    expect(await db.select().from(organizations)).toEqual([]);
  });

  it.each(["user", "admin"])("refuses once any %s exists, without creating a credential", async (role) => {
    await db.insert(users).values({ id: "existing", email: "existing@example.test", role });
    await expect(createFirstPlatformAdmin(INPUT)).rejects.toThrow("This dMRV is already set up. Sign in instead.");
    expect(await db.select({ id: users.id, role: users.role }).from(users)).toEqual([{ id: "existing", role }]);
    expect(await db.select().from(accounts)).toEqual([]);
  });

  it("serializes concurrent requests with different mailboxes so only one admin commits", async () => {
    const results = await Promise.allSettled([
      createFirstPlatformAdmin(INPUT),
      createFirstPlatformAdmin({ email: "second@example.test", password: PASSWORD }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(SafeError);
    expect(rejected?.reason.message).toBe("This dMRV is already set up. Sign in instead.");
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(accounts)).toHaveLength(1);
  });

  it("rolls back the user if the credential insert fails and permits a fresh attempt", async () => {
    await isolated.pool!.query(`ALTER TABLE "${isolated.schema}".account ADD CONSTRAINT reject_test_credential CHECK (provider_id <> 'credential')`);
    try {
      await expect(createFirstPlatformAdmin(INPUT)).rejects.toThrow();
      expect(await hasAnyUser()).toBe(false);
      expect(await db.select().from(accounts)).toEqual([]);
    } finally {
      await isolated.pool!.query(`ALTER TABLE "${isolated.schema}".account DROP CONSTRAINT reject_test_credential`);
    }
    await expect(createFirstPlatformAdmin(INPUT)).resolves.toMatchObject({ email: "first@example.test" });
  });
});
