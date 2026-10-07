import { beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, users } from "@/db/schema";
import { ensureAdminUser, ensureOrgFoundation, type EnsureAdminDb } from "./ensure-admin-core";

vi.mock("better-auth/crypto", () => ({ hashPassword: vi.fn(async () => "test-hash") }));
vi.mock("@/db", () => ({ db: {} }));

const EXISTING_USER_ID = "existing-user-id";
const TEST_PASSWORD = "test-password";
const TEST_HASH = "test-hash";

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
    const userId = await ensureAdminUser(db, "admin@example.invalid", TEST_PASSWORD, "development");
    expect(writes.find((write) => write.table === users)?.data.id).toBe(userId);
    expect(writes.find((write) => write.table === accounts)?.data).toMatchObject({
      accountId: userId, userId, providerId: "credential",
    });
  });

  it("uses an existing user's ID when creating their missing credential", async () => {
    const { db, writes } = mockDatabase([[{ id: EXISTING_USER_ID }], []]);
    await ensureAdminUser(db, "admin@example.invalid", TEST_PASSWORD, "development");
    expect(writes.find((write) => write.table === accounts)?.data).toMatchObject({
      accountId: EXISTING_USER_ID, userId: EXISTING_USER_ID,
    });
  });

  it("keeps development password updates usable with the credential lookup", async () => {
    const { db, writes } = mockDatabase([[{ id: EXISTING_USER_ID }], [{ id: "account-id" }]]);
    await ensureAdminUser(db, "admin@example.invalid", TEST_PASSWORD, "development");
    expect(writes.find((write) => write.table === accounts)?.data).toEqual({
      accountId: EXISTING_USER_ID, password: TEST_HASH,
    });
  });

  it("uses the generated teammate user ID for credentials", async () => {
    const { db, writes } = mockDatabase();
    await ensureOrgFoundation(db, EXISTING_USER_ID, TEST_HASH, "development");
    const userId = writes.find((write) => write.table === users)?.data.id;
    expect(userId).toEqual(expect.any(String));
    expect(writes.find((write) => write.table === accounts)?.data).toMatchObject({
      accountId: userId, userId, providerId: "credential",
    });
  });
});
