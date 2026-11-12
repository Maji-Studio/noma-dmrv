import { beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, users } from "@/db/schema";
import { AUTH_PASSWORD_MIN_LENGTH, AUTH_PASSWORD_MAX_LENGTH } from "@/config/auth";
import { hashPassword } from "better-auth/crypto";
import { ensureAdminUser, ensureOrgFoundation, assertDevelopmentBootstrapAllowed, type EnsureAdminDb } from "./ensure-admin-core";

vi.mock("better-auth/crypto", () => ({ hashPassword: vi.fn(async () => "test-hash") }));
vi.mock("@/db", () => ({ db: {} }));

const EXISTING_USER_ID = "existing-user-id";
const TEST_PASSWORD = "test-password";
const TEST_HASH = "test-hash";

describe("bootstrap database locality", () => {
  it("refuses a remote host override on a localhost URL", () => {
    expect(() => assertDevelopmentBootstrapAllowed({
      DATABASE_URL: "postgresql://localhost/app?host=db.example.com",
    })).toThrow("Refusing development bootstrap against a non-local database");
  });

  it("allows an explicit development override for a remote host override", () => {
    expect(assertDevelopmentBootstrapAllowed({
      DATABASE_URL: "postgresql://localhost/app?host=db.example.com",
      ALLOW_DEV_BOOTSTRAP: "1",
    })).toBeUndefined();
  });

  it("allows IPv6 loopback development bootstrap", () => {
    expect(assertDevelopmentBootstrapAllowed({
      DATABASE_URL: "postgresql://postgres@[::1]/app",
    })).toBeUndefined();
  });

  it.each([undefined, "", "   "])("preserves the missing or blank URL error for %s", (databaseUrl) => {
    expect(() => assertDevelopmentBootstrapAllowed({
      DATABASE_URL: databaseUrl,
      ALLOW_DEV_BOOTSTRAP: "1",
    })).toThrow("DATABASE_URL environment variable is not set or is blank");
  });

  it("preserves the invalid URL error even with a development override", () => {
    expect(() => assertDevelopmentBootstrapAllowed({
      DATABASE_URL: "not-a-url",
      ALLOW_DEV_BOOTSTRAP: "1",
    })).toThrow("DATABASE_URL environment variable is not a valid URL");
  });

  it.each([undefined, "not-a-url"])("refuses production before checking URL validity for %s", (databaseUrl) => {
    expect(() => assertDevelopmentBootstrapAllowed({
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      ALLOW_DEV_BOOTSTRAP: "1",
    })).toThrow("Open /setup");
  });
});

function mockDatabase(results: unknown[][] = []) {
  const writes: Array<{ table: unknown; data: Record<string, unknown> }> = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({
      limit: async () => results.shift() ?? [],
    }) }) }),
    insert: (table: unknown) => ({ values: (data: Record<string, unknown>) => {
      writes.push({ table, data });
      return { onConflictDoNothing: async () => undefined };
    } }),
    update: (table: unknown) => ({ set: (data: Record<string, unknown>) => {
      writes.push({ table, data });
      return { where: async () => undefined };
    } }),
    delete: () => ({ where: async () => undefined }),
    transaction: async (work: (tx: unknown) => Promise<void>) => work(db),
  };
  return { db: db as unknown as EnsureAdminDb, writes };
}

describe("bootstrap credential identity", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("uses the generated admin user ID as the credential account ID", async () => {
    const { db, writes } = mockDatabase();
    const userId = await ensureAdminUser(db, "admin@example.invalid", TEST_PASSWORD);
    expect(writes.find((write) => write.table === users)?.data.id).toBe(userId);
    expect(writes.find((write) => write.table === accounts)?.data).toMatchObject({
      accountId: userId, userId, providerId: "credential",
    });
  });

  it("uses an existing user's ID when creating their missing credential", async () => {
    const { db, writes } = mockDatabase([[{ id: EXISTING_USER_ID }], []]);
    await ensureAdminUser(db, "admin@example.invalid", TEST_PASSWORD);
    expect(writes.find((write) => write.table === accounts)?.data).toMatchObject({
      accountId: EXISTING_USER_ID, userId: EXISTING_USER_ID,
    });
  });

  it("updates the existing development credential password", async () => {
    const { db, writes } = mockDatabase([[{ id: EXISTING_USER_ID }], [{ id: "account-id" }]]);
    await ensureAdminUser(db, "admin@example.invalid", TEST_PASSWORD);
    expect(writes.find((write) => write.table === accounts)?.data).toEqual({
      password: TEST_HASH,
    });
  });

  it("uses the generated teammate user ID for credentials", async () => {
    const { db, writes } = mockDatabase();
    await ensureOrgFoundation(db, EXISTING_USER_ID, TEST_HASH);
    const userId = writes.find((write) => write.table === users)?.data.id;
    expect(userId).toEqual(expect.any(String));
    expect(writes.find((write) => write.table === accounts)?.data).toMatchObject({
      accountId: userId, userId, providerId: "credential",
    });
  });

  it("rejects an over-limit admin password before hashing or updating credentials", async () => {
    const { db, writes } = mockDatabase([[{ id: EXISTING_USER_ID }], [{ id: "account-id" }]]);
    vi.mocked(hashPassword).mockClear();

    await expect(ensureAdminUser(
      db, "admin@example.invalid", "x".repeat(AUTH_PASSWORD_MAX_LENGTH + 1),
    )).rejects.toThrow(
      `ADMIN_PASSWORD must be between ${AUTH_PASSWORD_MIN_LENGTH} and ${AUTH_PASSWORD_MAX_LENGTH} characters`,
    );
    expect(hashPassword).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});
