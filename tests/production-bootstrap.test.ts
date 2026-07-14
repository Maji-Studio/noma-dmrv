import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { DEC_ORG_ID, DEC_ORG_NAME, DEC_ORG_SLUG } from "@/db/org-defaults";
import { accounts, members, organizations, users } from "@/db/schema";
import {
  ensureAdminUser,
  ensureIsometricCredentials,
  ensureOrgFoundation,
} from "@/lib/cli/ensure-admin-core";

const TEAMMATE_EMAIL = "teammate@darkearthcarbon.dev";
const CREDENTIAL_PROVIDER = "credential";
const TEST_PASSWORD_HASH = "production-bootstrap-test-hash";

interface FoundationSnapshot {
  organizationExisted: boolean;
  teammateId: string | null;
  teammateMembership: typeof members.$inferSelect | null;
}

async function prepareFoundation(): Promise<FoundationSnapshot> {
  const [existingOrganization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, DEC_ORG_ID))
    .limit(1);
  await db
    .insert(organizations)
    .values({ id: DEC_ORG_ID, name: DEC_ORG_NAME, slug: DEC_ORG_SLUG })
    .onConflictDoNothing({ target: organizations.id });

  const [teammate] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TEAMMATE_EMAIL))
    .limit(1);
  const [teammateMembership] = teammate
    ? await db
        .select()
        .from(members)
        .where(
          and(
            eq(members.organizationId, DEC_ORG_ID),
            eq(members.userId, teammate.id),
          ),
        )
        .limit(1)
    : [];

  if (teammateMembership) {
    await db.delete(members).where(eq(members.id, teammateMembership.id));
  }

  return {
    organizationExisted: Boolean(existingOrganization),
    teammateId: teammate?.id ?? null,
    teammateMembership: teammateMembership ?? null,
  };
}

async function restoreFoundation(snapshot: FoundationSnapshot): Promise<void> {
  const [currentTeammate] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TEAMMATE_EMAIL))
    .limit(1);

  if (currentTeammate) {
    await db
      .delete(members)
      .where(
        and(
          eq(members.organizationId, DEC_ORG_ID),
          eq(members.userId, currentTeammate.id),
        ),
      );
  }

  if (snapshot.teammateId === null && currentTeammate) {
    await db.delete(users).where(eq(users.id, currentTeammate.id));
  } else if (snapshot.teammateMembership) {
    await db.insert(members).values(snapshot.teammateMembership);
  }

  if (!snapshot.organizationExisted) {
    await db.delete(organizations).where(eq(organizations.id, DEC_ORG_ID));
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

describe("production organization foundation", () => {
  it("creates the organization, removes the admin membership, and skips the dev teammate", async () => {
    const snapshot = await prepareFoundation();
    const adminUserId = `production-bootstrap-admin-${crypto.randomUUID()}`;

    try {
      await db.insert(users).values({
        id: adminUserId,
        email: `${adminUserId}@example.test`,
        name: "Production Bootstrap Test Admin",
        role: "admin",
        emailVerified: true,
      });
      await db.insert(members).values({
        id: crypto.randomUUID(),
        organizationId: DEC_ORG_ID,
        userId: adminUserId,
        role: "owner",
      });
      vi.stubEnv("NODE_ENV", "production");
      await ensureOrgFoundation(db, adminUserId, TEST_PASSWORD_HASH);

      const [organization] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, DEC_ORG_ID));
      const [adminMembership] = await db
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.organizationId, DEC_ORG_ID),
            eq(members.userId, adminUserId),
          ),
        );
      const [teammate] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, TEAMMATE_EMAIL));
      const [teammateMembership] = teammate
        ? await db
            .select({ id: members.id })
            .from(members)
            .where(
              and(
                eq(members.organizationId, DEC_ORG_ID),
                eq(members.userId, teammate.id),
              ),
            )
        : [];

      expect(organization?.id).toBe(DEC_ORG_ID);
      expect(adminMembership).toBeUndefined();
      expect(teammateMembership).toBeUndefined();
      if (snapshot.teammateId === null) {
        expect(teammate).toBeUndefined();
      }
    } finally {
      await db.delete(users).where(eq(users.id, adminUserId));
      await restoreFoundation(snapshot);
    }
  });

  it("creates the dev teammate owner outside production", async () => {
    const snapshot = await prepareFoundation();
    const adminUserId = `local-bootstrap-admin-${crypto.randomUUID()}`;

    try {
      await db.insert(users).values({
        id: adminUserId,
        email: `${adminUserId}@example.test`,
        name: "Local Bootstrap Test Admin",
        role: "admin",
        emailVerified: true,
      });
      vi.stubEnv("NODE_ENV", "test");
      await ensureOrgFoundation(db, adminUserId, TEST_PASSWORD_HASH);

      const [teammate] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, TEAMMATE_EMAIL));
      const [membership] = teammate
        ? await db
            .select({ role: members.role })
            .from(members)
            .where(
              and(
                eq(members.organizationId, DEC_ORG_ID),
                eq(members.userId, teammate.id),
              ),
            )
        : [];

      expect(teammate).toBeDefined();
      expect(membership?.role).toBe("owner");
    } finally {
      await db.delete(users).where(eq(users.id, adminUserId));
      await restoreFoundation(snapshot);
    }
  });
});

describe("production registry credentials", () => {
  it("fails loudly with every missing or blank environment-variable name", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ISOMETRIC_ACCESS_TOKEN", undefined);
    vi.stubEnv("ISOMETRIC_CLIENT_SECRET", "   ");
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "");

    await expect(ensureIsometricCredentials(db)).rejects.toThrow(
      "ISOMETRIC_ACCESS_TOKEN, ISOMETRIC_CLIENT_SECRET, CREDENTIALS_ENCRYPTION_KEY",
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
  it("does not overwrite an existing credential password in production", async () => {
    const tag = crypto.randomUUID();
    const email = `production-admin-${tag}@example.test`;
    vi.stubEnv("NODE_ENV", "production");
    let userId: string | null = null;

    try {
      userId = await ensureAdminUser(db, email, `first-${tag}`);
      const firstHash = await credentialPassword(userId);
      await ensureAdminUser(db, email, `second-${tag}`);

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
