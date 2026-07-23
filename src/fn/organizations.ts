"use server";

/**
 * Server actions for the Organization foundation (multi-tenancy PR 1):
 * org switching, member management, invitations, and Platform-Admin org
 * lifecycle. Member/invitation mutations use the Better Auth organization
 * plugin for real org members and scoped data-access overrides for Platform
 * Admins, who deliberately have no membership rows.
 */
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { organizations, sessions } from "@/db/schema";
import { auth } from "@/lib/auth/better-auth";
import {
  getOrgContext,
  requireOrgContext,
  requireOrgRole,
  requirePlatformAdmin,
} from "@/lib/auth/server";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";
import { SafeError, toActionError } from "@/lib/errors";
import { logActionError } from "@/fn/action-errors";
import { env } from "@/config/env";
import {
  cancelInvitationAsPlatformAdmin,
  createInvitationAsPlatformAdmin,
  createOrganizationWithOwner,
  findMembershipRole,
  findUserIdByEmail,
  getActiveOrganization,
  listAllOrganizations,
  listOrgInvitations,
  listOrgMembers,
  persistLastActiveOrganization,
  removeMemberAsPlatformAdmin,
  updateMemberRoleAsPlatformAdmin,
  type OrganizationSummary,
  type OrgInvitationRow,
  type OrgMemberRow,
} from "@/data-access/organizations";
import type { ActionResult } from "@/types/actions";
import {
  createOrganizationSchema,
  inviteMemberSchema,
  orgRoleSchema,
} from "@/schemas/organizations";

/**
 * Run a body producing an ActionResult, mapping thrown errors. SafeError and
 * Better Auth APIError messages are surfaced; everything else falls back to a
 * generic message (and is logged).
 */
async function toResult<T>(
  fn: () => Promise<T>,
  fallback: string
): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((issue) => issue.message).join(", "),
      };
    }
    if (error instanceof SafeError) {
      return { success: false, error: error.message };
    }
    // Better Auth throws APIError with a user-facing `.body.message`.
    const apiMessage = extractApiErrorMessage(error);
    if (apiMessage) {
      return { success: false, error: apiMessage };
    }
    logActionError(error, { message: "organization action failed" });
    return { success: false, error: toActionError(error, fallback) };
  }
}

function extractApiErrorMessage(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "body" in error &&
    error.body &&
    typeof error.body === "object" &&
    "message" in error.body &&
    typeof (error.body as { message?: unknown }).message === "string"
  ) {
    return (error.body as { message: string }).message;
  }
  return null;
}

function buildAcceptUrl(invitationId: string): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/accept-invitation/${invitationId}`;
}

// --- Reads ----------------------------------------------------------------

export async function listMembersFn(): Promise<ActionResult<OrgMemberRow[]>> {
  return toResult(async () => {
    const ctx = await requireOrgContext();
    return listOrgMembers(ctx);
  }, "Failed to load members.");
}

export async function listInvitationsFn(): Promise<
  ActionResult<OrgInvitationRow[]>
> {
  return toResult(async () => {
    const ctx = await requireOrgContext();
    requireOrgRole(ctx, "admin");
    return listOrgInvitations(ctx);
  }, "Failed to load invitations.");
}

export async function listOrganizationsFn(): Promise<
  ActionResult<OrganizationSummary[]>
> {
  return toResult(async () => {
    await requirePlatformAdmin();
    return listAllOrganizations();
  }, "Failed to load organizations.");
}

// --- Member management ----------------------------------------------------

export async function inviteMemberAction(
  input: unknown
): Promise<ActionResult<{ invitationId: string; acceptUrl: string }>> {
  return toResult(async () => {
    const { email, role } = inviteMemberSchema.parse(input);
    const ctx = await requireOrgContext();
    requireOrgRole(ctx, "admin");
    const result =
      ctx.orgRole !== null
        ? await auth.api.createInvitation({
            body: { email, role, organizationId: ctx.organizationId },
            headers: await headers(),
          })
        : await createInvitationAsPlatformAdmin(ctx, { email, role });
    return {
      invitationId: result.id,
      acceptUrl: buildAcceptUrl(result.id),
    };
  }, "Failed to send invitation.");
}

export async function revokeInvitationAction(
  input: unknown
): Promise<ActionResult<{ invitationId: string }>> {
  return toResult(async () => {
    const { invitationId } = z
      .object({ invitationId: z.string().min(1) })
      .parse(input);
    const ctx = await requireOrgContext();
    requireOrgRole(ctx, "admin");
    if (ctx.orgRole !== null) {
      await auth.api.cancelInvitation({
        body: { invitationId },
        headers: await headers(),
      });
    } else {
      await cancelInvitationAsPlatformAdmin(ctx, invitationId);
    }
    return { invitationId };
  }, "Failed to revoke invitation.");
}

export async function changeMemberRoleAction(
  input: unknown
): Promise<ActionResult<{ memberId: string }>> {
  return toResult(async () => {
    const { memberId, role } = z
      .object({ memberId: z.string().min(1), role: orgRoleSchema })
      .parse(input);
    const ctx = await requireOrgContext();
    requireOrgRole(ctx, "admin");
    if (ctx.orgRole !== null) {
      await auth.api.updateMemberRole({
        body: { memberId, role, organizationId: ctx.organizationId },
        headers: await headers(),
      });
    } else {
      await updateMemberRoleAsPlatformAdmin(ctx, memberId, role);
    }
    return { memberId };
  }, "Failed to change member role.");
}

export async function removeMemberAction(
  input: unknown
): Promise<ActionResult<{ memberIdOrEmail: string }>> {
  return toResult(async () => {
    const { memberIdOrEmail } = z
      .object({ memberIdOrEmail: z.string().min(1) })
      .parse(input);
    const ctx = await requireOrgContext();
    requireOrgRole(ctx, "admin");
    if (ctx.orgRole !== null) {
      await auth.api.removeMember({
        body: { memberIdOrEmail, organizationId: ctx.organizationId },
        headers: await headers(),
      });
    } else {
      await removeMemberAsPlatformAdmin(ctx, memberIdOrEmail);
    }
    return { memberIdOrEmail };
  }, "Failed to remove member.");
}

// --- Org switching --------------------------------------------------------

/**
 * Switch the session's active organization. Members go through the plugin
 * (which refreshes the cookie-cached session). A Platform Admin entering an org
 * they are not a member of writes `activeOrganizationId` directly and clears
 * the cached session snapshot so the next read reflects the switch.
 */
// Callers must pair a successful switch with resetAfterOrgSwitch() from useResetAfterOrgSwitch.
export async function setActiveOrganizationAction(
  input: unknown
): Promise<ActionResult<{ organizationId: string }>> {
  return toResult(async () => {
    const { organizationId } = z
      .object({ organizationId: z.string().min(1) })
      .parse(input);
    const session = await getBetterAuthSession();
    const sessionId = session?.session?.id;
    if (!session?.user?.id || !sessionId) {
      throw new SafeError("You must be signed in.");
    }

    const membershipRole = await findMembershipRole(organizationId);
    if (membershipRole) {
      // Target-org member: let the plugin verify membership and refresh cookie.
      await auth.api.setActiveOrganization({
        body: { organizationId },
        headers: await headers(),
      });
      await persistLastActiveOrganization(session.user.id, organizationId);
      return { organizationId };
    }

    await requirePlatformAdmin();
    await setActiveOrgForPlatformAdmin(sessionId, organizationId);
    await persistLastActiveOrganization(session.user.id, organizationId);
    return { organizationId };
  }, "Failed to switch organization.");
}

async function setActiveOrgForPlatformAdmin(
  sessionId: string,
  organizationId: string
): Promise<void> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) {
    throw new SafeError("Organization not found.");
  }
  await db
    .update(sessions)
    .set({ activeOrganizationId: organizationId })
    .where(eq(sessions.id, sessionId));
  // Drop the cookie-cached session snapshot so the next getSession reads the
  // new active org from the database instead of the 5-minute cache.
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.includes("session_data")) {
      cookieStore.delete(cookie.name);
    }
  }
}

// --- Platform-Admin org lifecycle -----------------------------------------

export async function createOrganizationAction(
  input: unknown
): Promise<ActionResult<{ organizationId: string }>> {
  return toResult(async () => {
    const { name, slug, ownerEmail } = createOrganizationSchema.parse(input);
    await requirePlatformAdmin();

    const ownerUserId = await findUserIdByEmail(ownerEmail);
    if (!ownerUserId) {
      throw new SafeError(
        "No user account found for the owner email. The owner must have an account first."
      );
    }
    const organization = await createOrganizationWithOwner({
      name,
      slug,
      ownerUserId,
    });
    return { organizationId: organization.id };
  }, "Failed to create organization.");
}

// --- Invitation accept ----------------------------------------------------

/**
 * Accept a pending invitation for the currently signed-in user (whose email
 * must match the invite — enforced by the plugin), then switch into the org.
 */
// Callers must pair a successful switch with resetAfterOrgSwitch() from useResetAfterOrgSwitch.
export async function acceptInvitationAction(
  input: unknown
): Promise<ActionResult<{ organizationId: string }>> {
  return toResult(async () => {
    const { invitationId } = z
      .object({ invitationId: z.string().min(1) })
      .parse(input);
    const session = await getBetterAuthSession();
    if (!session?.user?.id) {
      throw new SafeError("Sign in with the invited email to accept.");
    }
    const result = await auth.api.acceptInvitation({
      body: { invitationId },
      headers: await headers(),
    });
    const organizationId = result?.invitation?.organizationId;
    if (!organizationId) {
      throw new SafeError("Invitation could not be accepted.");
    }
    await auth.api.setActiveOrganization({
      body: { organizationId },
      headers: await headers(),
    });
    await persistLastActiveOrganization(session.user.id, organizationId);
    return { organizationId };
  }, "Failed to accept invitation.");
}

/** Server-component helper: the active org profile for identity chrome. */
export async function getActiveOrganizationProfile() {
  const ctx = await getOrgContext();
  if (!ctx) return null;
  return getActiveOrganization(ctx);
}
