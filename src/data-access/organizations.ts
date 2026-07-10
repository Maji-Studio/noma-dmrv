/**
 * Data-access for Organizations, members, and invitations (multi-tenancy).
 *
 * Read helpers are scoped to `ctx.organizationId` so one org can never read
 * another's membership. Org lifecycle helpers (create) are Platform-Admin-only
 * and enforce that gate in the `fn/` layer via `requirePlatformAdmin()`.
 */
import { randomUUID } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invitations, members, organizations, users } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";

export type OrgMemberRow = {
  memberId: string;
  userId: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: Date;
};

export type OrgInvitationRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: Date;
  memberCount: number;
};

/** Members of the active org, joined to their user identity. */
export async function listOrgMembers(ctx: OrgContext): Promise<OrgMemberRow[]> {
  return db
    .select({
      memberId: members.id,
      userId: members.userId,
      name: users.name,
      email: users.email,
      role: members.role,
      createdAt: members.createdAt,
    })
    .from(members)
    .innerJoin(users, eq(members.userId, users.id))
    .where(eq(members.organizationId, ctx.organizationId))
    .orderBy(desc(members.createdAt));
}

/** Pending invitations of the active org. */
export async function listOrgInvitations(
  ctx: OrgContext
): Promise<OrgInvitationRow[]> {
  return db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, ctx.organizationId),
        eq(invitations.status, "pending")
      )
    )
    .orderBy(desc(invitations.createdAt));
}

/** The active org's profile (name, slug, logo). */
export async function getActiveOrganization(ctx: OrgContext) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, ctx.organizationId))
    .limit(1);
  return org ?? null;
}

/** All organizations with member counts — Platform Admin directory. */
export async function listAllOrganizations(): Promise<OrganizationSummary[]> {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      logo: organizations.logo,
      createdAt: organizations.createdAt,
      memberCount: count(members.id),
    })
    .from(organizations)
    .leftJoin(members, eq(members.organizationId, organizations.id))
    .groupBy(organizations.id)
    .orderBy(desc(organizations.createdAt));
  return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
}

/** Total number of organizations (drives the PR-1 single-org isolation gate). */
export async function countOrganizations(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(organizations);
  return Number(row?.value ?? 0);
}

/**
 * Create an organization and stamp the given user as its Owner, in one
 * transaction. The Owner is a real member (not the Platform Admin who ran the
 * action). Callers must gate this with `requirePlatformAdmin()` and the
 * single-org isolation check.
 */
export async function createOrganizationWithOwner(input: {
  name: string;
  slug: string;
  ownerUserId: string;
}): Promise<{ id: string }> {
  const organizationId = randomUUID();
  await db.transaction(async (tx) => {
    const [ownerUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.ownerUserId))
      .limit(1);
    if (!ownerUser) {
      throw new SafeError("The selected owner account no longer exists.");
    }
    const [existingSlug] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, input.slug))
      .limit(1);
    if (existingSlug) {
      throw new SafeError("An organization with this slug already exists.");
    }
    await tx.insert(organizations).values({
      id: organizationId,
      name: input.name,
      slug: input.slug,
    });
    await tx.insert(members).values({
      id: randomUUID(),
      organizationId,
      userId: input.ownerUserId,
      role: "owner",
    });
  });
  return { id: organizationId };
}

/** Look up a user id by email (for the create-org owner picker). */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);
  return row?.id ?? null;
}
