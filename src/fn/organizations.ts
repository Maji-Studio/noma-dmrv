"use server";

/**
 * Server actions for the Organization foundation (multi-tenancy PR 1):
 * org switching, member management, invitations, and Platform-Admin org
 * lifecycle. Member/invitation mutations delegate to the Better Auth
 * organization plugin (which enforces org-role authorization server-side); we
 * add a coarse `requireOrgRole` pre-gate and the Platform-Admin / single-org
 * gates the plugin does not own.
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
  countOrganizations,
  createOrganizationWithOwner,
  findUserIdByEmail,
  getActiveOrganization,
  listAllOrganizations,
  listOrgInvitations,
  listOrgMembers,
  type OrganizationSummary,
  type OrgInvitationRow,
  type OrgMemberRow,
} from "@/data-access/organizations";
import type { ActionResult } from "@/types/actions";

const orgRoleSchema = z.enum(["owner", "admin", "member"]);

const inviteMemberSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase().trim()),
  role: orgRoleSchema,
});

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9-]+$/,
      "Slug may only contain lowercase letters, numbers, and hyphens."
    ),
  ownerEmail: z.email().transform((value) => value.toLowerCase().trim()),
});

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

// --- Member management (delegates to the org plugin) ----------------------

export async function inviteMemberAction(
  input: unknown
): Promise<ActionResult<{ invitationId: string; acceptUrl: string }>> {
  return toResult(async () => {
    const { email, role } = inviteMemberSchema.parse(input);
    const ctx = await requireOrgContext();
    requireOrgRole(ctx, "admin");
    const result = await auth.api.createInvitation({
      body: { email, role, organizationId: ctx.organizationId },
      headers: await headers(),
    });
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
    await auth.api.cancelInvitation({
      body: { invitationId },
      headers: await headers(),
    });
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
    await auth.api.updateMemberRole({
      body: { memberId, role, organizationId: ctx.organizationId },
      headers: await headers(),
    });
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
    await auth.api.removeMember({
      body: { memberIdOrEmail, organizationId: ctx.organizationId },
      headers: await headers(),
    });
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
export async function setActiveOrganizationAction(
  input: unknown
): Promise<ActionResult<{ organizationId: string }>> {
  return toResult(async () => {
    const { organizationId } = z
      .object({ organizationId: z.string().min(1) })
      .parse(input);
    const ctx = await getOrgContextOrThrowSignedIn();

    if (ctx.membershipRole) {
      // Real member: let the plugin handle it (verifies membership + cookie).
      await auth.api.setActiveOrganization({
        body: { organizationId },
        headers: await headers(),
      });
      return { organizationId };
    }

    if (!ctx.isPlatformAdmin) {
      throw new SafeError("You are not a member of this organization.");
    }
    await setActiveOrgForPlatformAdmin(ctx.sessionId, organizationId);
    return { organizationId };
  }, "Failed to switch organization.");
}

async function getOrgContextOrThrowSignedIn(): Promise<{
  userId: string;
  sessionId: string;
  isPlatformAdmin: boolean;
  membershipRole: string | null;
}> {
  const session = await getBetterAuthSession();
  const userId = session?.user?.id;
  const sessionId = session?.session?.id;
  if (!userId || !sessionId) {
    throw new SafeError("You must be signed in.");
  }
  const ctx = await getOrgContext();
  return {
    userId,
    sessionId,
    isPlatformAdmin: (session.user as { role?: string }).role === "admin",
    membershipRole: ctx?.orgRole ?? null,
  };
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

    // PR-1 isolation gate: a second org would see PR-1's still-shared domain
    // data. Blocked here until PR 2 ("org-scope domain data") lands and removes
    // this check. Cheap and compiler-visible.
    const existing = await countOrganizations();
    if (existing >= 1) {
      throw new SafeError(
        "Creating additional organizations is disabled until org-scoped data ships (multi-tenancy PR 2)."
      );
    }

    const ownerUserId = await findUserIdByEmail(ownerEmail);
    if (!ownerUserId) {
      throw new SafeError(
        "No user account found for the owner email. The owner must have an account first."
      );
    }
    const { id } = await createOrganizationWithOwner({
      name,
      slug,
      ownerUserId,
    });
    return { organizationId: id };
  }, "Failed to create organization.");
}

// --- Invitation accept ----------------------------------------------------

/**
 * Accept a pending invitation for the currently signed-in user (whose email
 * must match the invite — enforced by the plugin), then switch into the org.
 */
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
    return { organizationId };
  }, "Failed to accept invitation.");
}

/** Server-component helper: the active org profile for identity chrome. */
export async function getActiveOrganizationProfile() {
  const ctx = await getOrgContext();
  if (!ctx) return null;
  return getActiveOrganization(ctx);
}
