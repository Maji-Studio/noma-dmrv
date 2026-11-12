import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { accounts, members, organizations, users } from "@/db/schema";
import {
  ensureAdminUser,
  ensureIsometricCredentials,
  ensureOrgFoundation,
  resolveBootstrapMode,
  type EnsureAdminDb,
} from "@/lib/cli/ensure-admin-core";

const TEAMMATE_EMAIL = "teammate@darkearthcarbon.dev";
const CREDENTIAL_PROVIDER = "credential";
const TEST_PASSWORD_HASH = "production-bootstrap-test-hash";
const LOCAL_DATABASE_URL = "postgresql://user:password@localhost:5433/test";
const IPV4_LOCAL_DATABASE_URL = "postgresql://user:password@127.0.0.1:5433/test";
const IPV6_LOCAL_DATABASE_URL = "postgresql://user:password@[::1]:5433/test";
const REMOTE_DATABASE_URL = "postgresql://user:password@db.example.invalid/test";

// Roll back the complete foundation fixture, including any existing DEC rows.
async function withEmptyFoundation(run: (tx: EnsureAdminDb) => Promise<void>) {
  const rollback = new Error("Rollback foundation fixture");
  try {
    await db.transaction(async tx => {
      await tx.delete(organizations).where(eq(organizations.id, DEC_ORG_ID));
      await run(tx as EnsureAdminDb);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function credentialPassword(userId: string): Promise<string | null> {
  const [account] = await db
    .select({ password: accounts.password })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, CREDENTIAL_PROVIDER),
      ),
    )
    .limit(1);
  return account?.password ?? null;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bootstrap environment classification", () => {
  it.each([
    LOCAL_DATABASE_URL,
    IPV4_LOCAL_DATABASE_URL,
    IPV6_LOCAL_DATABASE_URL,
  ])("allows development bootstrap for local database target %s", (databaseUrl) => {
    expect(resolveBootstrapMode({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
    })).toBe("development");
  });

  it("refuses CLI bootstrap when NODE_ENV is production", () => {
    expect(() => resolveBootstrapMode({
      NODE_ENV: "production",
      DATABASE_URL: REMOTE_DATABASE_URL,
      ALLOW_DEV_BOOTSTRAP: "1",
    })).toThrow("Open /setup");
  });

  it("refuses development semantics for a non-local target by default", () => {
    expect(() => resolveBootstrapMode({
      NODE_ENV: "development",
      DATABASE_URL: REMOTE_DATABASE_URL,
    })).toThrow("Refusing development bootstrap against a non-local database");
  });

  it("allows an explicit non-local development override", () => {
    expect(resolveBootstrapMode({
      NODE_ENV: "development",
      DATABASE_URL: REMOTE_DATABASE_URL,
      ALLOW_DEV_BOOTSTRAP: "1",
    })).toBe("development");
  });

  it("refuses before creating an admin credential on a non-local target", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", REMOTE_DATABASE_URL);
    const databaseAccessTrap = new Proxy({} as EnsureAdminDb, {
      get() {
        throw new Error("Database was accessed before bootstrap classification");
      },
    });

    await expect(
      ensureAdminUser(
        databaseAccessTrap,
        "refused-bootstrap@example.test",
        TEST_PASSWORD_HASH,
      ),
    ).rejects.toThrow("Refusing development bootstrap against a non-local database");
  });
});

describe("organization foundation bootstrap policy", () => {
  it.each([false, true])("refuses production foundation changes (another Admin: %s)", async anotherAdmin => {
    await withEmptyFoundation(async tx => {
      const adminUserId = crypto.randomUUID();
      const otherUserId = crypto.randomUUID();
      await tx.insert(users).values([adminUserId, otherUserId].map(id => ({
        id, email: `${id}@example.test`, name: "Bootstrap fixture", role: "admin",
      })));
      await tx.insert(organizations).values({ id: DEC_ORG_ID, name: "Existing operator", slug: "existing-operator" });
      await tx.insert(members).values({ id: crypto.randomUUID(), organizationId: DEC_ORG_ID, userId: adminUserId, role: "admin" });
      if (anotherAdmin) await tx.insert(members).values({
        id: crypto.randomUUID(), organizationId: DEC_ORG_ID, userId: otherUserId, role: "admin",
      });
      const before = await tx.select().from(members).where(eq(members.organizationId, DEC_ORG_ID));
      vi.stubEnv("NODE_ENV", "production");
      await expect(ensureOrgFoundation(tx, adminUserId, TEST_PASSWORD_HASH)).rejects.toThrow("Open /setup");
      expect(await tx.select().from(members).where(eq(members.organizationId, DEC_ORG_ID))).toEqual(before);
    });
  });

  it("ensures the local teammate Admin before removing the sole Platform Admin membership", async () => {
    await withEmptyFoundation(async tx => {
      const adminUserId = crypto.randomUUID();
      await tx.insert(users).values({ id: adminUserId, email: `${adminUserId}@example.test`, name: "Bootstrap fixture", role: "admin" });
      await tx.insert(organizations).values({ id: DEC_ORG_ID, name: "Existing operator", slug: "existing-operator" });
      await tx.insert(members).values({ id: crypto.randomUUID(), organizationId: DEC_ORG_ID, userId: adminUserId, role: "admin" });
      await ensureOrgFoundation(tx, adminUserId, TEST_PASSWORD_HASH);
      const remaining = await tx.select({ userId: members.userId, role: members.role, email: users.email })
        .from(members).innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.organizationId, DEC_ORG_ID));
      expect(remaining).toEqual([{ userId: expect.any(String), role: "admin", email: TEAMMATE_EMAIL }]);
      expect(remaining[0].userId).not.toBe(adminUserId);
    });
  });
});

describe("production registry credentials", () => {
  it("refuses production before inspecting registry credentials", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ISOMETRIC_ACCESS_TOKEN", undefined);
    vi.stubEnv("ISOMETRIC_CLIENT_SECRET", "   ");
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "");

    await expect(ensureIsometricCredentials(db)).rejects.toThrow(
      "Open /setup",
    );
  });

  it("remains an optional no-op outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ISOMETRIC_ACCESS_TOKEN", undefined);
    vi.stubEnv("ISOMETRIC_CLIENT_SECRET", "   ");
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "");

    await expect(ensureIsometricCredentials(db)).resolves.toBeUndefined();
  });
});

describe("admin credential password preservation", () => {
  it("refuses production without overwriting an existing credential password", async () => {
    const tag = crypto.randomUUID();
    const email = `production-admin-${tag}@example.test`;
    vi.stubEnv("NODE_ENV", "test");
    let userId: string | null = null;

    try {
      userId = await ensureAdminUser(db, email, `first-${tag}`);
      const firstHash = await credentialPassword(userId);
      vi.stubEnv("NODE_ENV", "production");
      await expect(ensureAdminUser(db, email, `second-${tag}`)).rejects.toThrow("Open /setup");

      expect(firstHash).not.toBeNull();
      expect(await credentialPassword(userId)).toBe(firstHash);
    } finally {
      if (userId) await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("updates an existing credential password outside production", async () => {
    const tag = crypto.randomUUID();
    const email = `local-admin-${tag}@example.test`;
    vi.stubEnv("NODE_ENV", "test");
    let userId: string | null = null;

    try {
      userId = await ensureAdminUser(db, email, `first-${tag}`);
      const firstHash = await credentialPassword(userId);
      await ensureAdminUser(db, email, `second-${tag}`);

      expect(firstHash).not.toBeNull();
      expect(await credentialPassword(userId)).not.toBe(firstHash);
    } finally {
      if (userId) await db.delete(users).where(eq(users.id, userId));
    }
  });
});
