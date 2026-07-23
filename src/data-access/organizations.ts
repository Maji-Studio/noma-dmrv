/**
 * Data-access for Organizations, members, and invitations (multi-tenancy).
 *
 * Read helpers are scoped to `ctx.organizationId` so one org can never read
 * another's membership. Cross-org directory and lifecycle helpers enforce the
 * Platform-Admin gate in this layer as well as in their `fn/` callers.
 */
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { isPgUniqueViolation } from "@/db/errors";
import { seedOrgDefaults } from "@/db/org-defaults";
import { invitations, members, organizations, users } from "@/db/schema";
import { requireOrgScope } from "@/data-access/utils";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";
import {
  requirePlatformAdmin,
  type OrgContext,
  type OrgRole,
} from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";

// Mirrors Better Auth's organization plugin configuration in better-auth.ts.
const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const MILLISECONDS_PER_SECOND = 1_000;
const ORGANIZATION_SLUG_CONSTRAINT = "organizations_slug_unique";
const ORGANIZATION_SLUG_CONFLICT_MESSAGE =
  "An organization with this slug already exists.";

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

function requirePlatformAdminOverride(ctx: OrgContext): void {
  requireOrgScope(ctx);
  if (!ctx.isPlatformAdmin) {
    throw new SafeError("Platform Admin access is required for this action.");
  }
}

/** Members of the active org, joined to their user identity. */
export async function listOrgMembers(ctx: OrgContext): Promise<OrgMemberRow[]> {
  requireOrgScope(ctx);
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
  requireOrgScope(ctx);
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

/** Create an invitation without the plugin's org-membership requirement. */
export async function createInvitationAsPlatformAdmin(
  ctx: OrgContext,
  input: { email: string; role: OrgRole }
): Promise<{ id: string }> {
  requirePlatformAdminOverride(ctx);
  const email = input.email.toLowerCase().trim();
  const invitationId = randomUUID();

  await db.transaction(async (tx) => {
    const [existingUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (existingUser) {
      const [existingMember] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.organizationId, ctx.organizationId),
            eq(members.userId, existingUser.id)
          )
        )
        .limit(1);
      if (existingMember) {
        throw new SafeError("User is already a member of this organization.");
      }
    }

    await tx
      .update(invitations)
      .set({ status: "canceled" })
      .where(
        and(
          eq(invitations.organizationId, ctx.organizationId),
          eq(invitations.email, email),
          eq(invitations.status, "pending")
        )
      );
    await tx.insert(invitations).values({
      id: invitationId,
      organizationId: ctx.organizationId,
      email,
      role: input.role,
      status: "pending",
      expiresAt: new Date(
        Date.now() +
          INVITATION_EXPIRES_IN_SECONDS * MILLISECONDS_PER_SECOND
      ),
      inviterId: ctx.userId,
    });
  });

  // This override does not send email; the settings UI exposes a copyable URL.
  return { id: invitationId };
}

/** Cancel a pending invitation in the active organization. */
export async function cancelInvitationAsPlatformAdmin(
  ctx: OrgContext,
  invitationId: string
): Promise<void> {
  requirePlatformAdminOverride(ctx);
  const canceled = await db
    .update(invitations)
    .set({ status: "canceled" })
    .where(
      and(
        eq(invitations.id, invitationId),
        eq(invitations.organizationId, ctx.organizationId),
        eq(invitations.status, "pending")
      )
    )
    .returning({ id: invitations.id });
  if (canceled.length === 0) {
    throw new SafeError("Invitation not found or is no longer pending.");
  }
}

/** Update an organization member without plugin membership authorization. */
export async function updateMemberRoleAsPlatformAdmin(
  ctx: OrgContext,
  memberId: string,
  role: OrgRole
): Promise<void> {
  requirePlatformAdminOverride(ctx);
  await db.transaction(async (tx) => {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId))
      .for("update");
    const [member] = await tx
      .select({ id: members.id, role: members.role })
      .from(members)
      .where(
        and(
          eq(members.id, memberId),
          eq(members.organizationId, ctx.organizationId)
        )
      )
      .limit(1);
    if (!member) {
      throw new SafeError("Member not found.");
    }
    if (member.role === "owner" && role !== "owner") {
      const [owners] = await tx
        .select({ value: count() })
        .from(members)
        .where(
          and(
            eq(members.organizationId, ctx.organizationId),
            eq(members.role, "owner")
          )
        );
      if (Number(owners?.value ?? 0) <= 1) {
        throw new SafeError("An organization must keep at least one Owner.");
      }
    }
    const updated = await tx
      .update(members)
      .set({ role })
      .where(
        and(
          eq(members.id, memberId),
          eq(members.organizationId, ctx.organizationId)
        )
      )
      .returning({ id: members.id });
    if (updated.length === 0) {
      throw new SafeError("Member not found.");
    }
  });
}

/** Remove an organization member without plugin membership authorization. */
export async function removeMemberAsPlatformAdmin(
  ctx: OrgContext,
  memberId: string
): Promise<void> {
  requirePlatformAdminOverride(ctx);
  await db.transaction(async (tx) => {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId))
      .for("update");
    const [member] = await tx
      .select({ id: members.id, role: members.role })
      .from(members)
      .where(
        and(
          eq(members.id, memberId),
          eq(members.organizationId, ctx.organizationId)
        )
      )
      .limit(1);
    if (!member) {
      throw new SafeError("Member not found.");
    }
    if (member.role === "owner") {
      const [owners] = await tx
        .select({ value: count() })
        .from(members)
        .where(
          and(
            eq(members.organizationId, ctx.organizationId),
            eq(members.role, "owner")
          )
        );
      if (Number(owners?.value ?? 0) <= 1) {
        throw new SafeError("An organization must keep at least one Owner.");
      }
    }
    const removed = await tx
      .delete(members)
      .where(
        and(
          eq(members.id, memberId),
          eq(members.organizationId, ctx.organizationId)
        )
      )
      .returning({ id: members.id });
    if (removed.length === 0) {
      throw new SafeError("Member not found.");
    }
  });
}

/** The active org's profile (name, slug, logo). */
export async function getActiveOrganization(ctx: OrgContext) {
  requireOrgScope(ctx);
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, ctx.organizationId))
    .limit(1);
  return org ?? null;
}

/** All organizations with member counts — Platform Admin directory. */
export async function listAllOrganizations(): Promise<OrganizationSummary[]> {
  await requirePlatformAdmin();
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

/** Create an organization and its selected Owner as one atomic unit. */
export async function createOrganizationWithOwner(input: {
  name: string;
  slug: string;
  ownerUserId: string;
}): Promise<{ id: string }> {
  await requirePlatformAdmin();
  const organizationId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      const [ownerUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.ownerUserId))
        .limit(1);
      if (!ownerUser) {
        throw new SafeError("The selected owner account no longer exists.");
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
  } catch (error) {
    if (isPgUniqueViolation(error, ORGANIZATION_SLUG_CONSTRAINT)) {
      throw new SafeError(ORGANIZATION_SLUG_CONFLICT_MESSAGE);
    }
    throw error;
  }

  try {
    await seedOrgDefaults(db, organizationId);
  } catch (error) {
    logger.error(
      { error, organizationId },
      "failed to seed organization defaults",
    );
  }
  return { id: organizationId };
}

/** Look up a user id by email (for the create-org owner picker). */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  await requirePlatformAdmin();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase().trim()}`)
    .limit(1);
  return row?.id ?? null;
}

/** The signed-in user's role in a target organization, if they are a member. */
export async function findMembershipRole(
  organizationId: string
): Promise<string | null> {
  const session = await getBetterAuthSession();
  const userId = session?.user?.id ?? "";
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const [membership] = await db
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        eq(members.userId, userId),
        eq(members.organizationId, organizationId)
      )
    )
    .limit(1);
  return membership?.role ?? null;
}

/**
 * Persist an explicit organization choice after revalidating current access.
 * This preference is not an authorization grant; session creation validates it
 * again before restoring it.
 */
export async function persistLastActiveOrganization(
  userId: string,
  organizationId: string
): Promise<void> {
  if (!userId) {
    throw new SafeError("You must be signed in.");
  }

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new SafeError("You must be signed in.");
  }

  const [accessibleOrganization] =
    user.role === "admin"
      ? await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1)
      : await db
          .select({ id: members.organizationId })
          .from(members)
          .where(
            and(
              eq(members.userId, userId),
              eq(members.organizationId, organizationId)
            )
          )
          .limit(1);
  if (!accessibleOrganization) {
    throw new SafeError("You do not have access to this organization.");
  }

  await db
    .update(users)
    .set({ lastActiveOrganizationId: organizationId })
    .where(eq(users.id, userId));
}
