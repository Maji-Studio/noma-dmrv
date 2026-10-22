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
  isAdmin,
  requireOrgContext,
  requireOrgRole,
  requirePlatformAdmin,
} from "@/lib/auth/server";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";
import { SafeError, toActionError } from "@/lib/errors";
import {
  formatZodActionError,
  logActionError,
  toWarnableSuccess,
  type ResultWithWarning,
} from "@/fn/action-errors";
import { saveOrgPreference } from "@/fn/org-preference";
import type { CreateIntentOptions } from "@/schemas/create-intent";
import { parseCreateIntentKey } from "./with-create";
import { withAction } from "@/fn/with-action";
import { env } from "@/config/env";
import {
  cancelInvitationAsPlatformAdmin,
  createInvitationAsPlatformAdmin,
  createOrganizationWithAdmin,
  findMembershipRole,
  listAllOrganizations,
  listPlatformOrganizationDirectory,
  type PlatformOrganizationDirectoryRow,
  listOrgInvitations,
  listOrgMembers,
  removeMemberAsPlatformAdmin,
  renameActiveOrganization,
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
  renameOrganizationSchema,
} from "@/schemas/organizations";

const LOG_MESSAGE = "organization action failed";

/**
 * Run a body producing an ActionResult, mapping thrown errors. SafeError and
 * Better Auth APIError messages are surfaced; everything else falls back to a
 * generic message (and is logged).
 */
async function toResult<T>(
  fn: () => Promise<T>,
  fallback: string
): Promise<ActionResult<T>> {
  return toWarnableResult(async () => ({ data: await fn() }), fallback);
}

/**
 * As `toResult`, for bodies whose work has a committed part and a non-fatal
 * follow-up. A returned `warning` keeps the result a success (issue #769).
 */
async function toWarnableResult<T>(
  fn: () => Promise<ResultWithWarning<T>>,
  fallback: string
): Promise<ActionResult<T>> {
  try {
    return toWarnableSuccess(await fn());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
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
    logActionError(error, { message: LOG_MESSAGE });
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
  return withAction(async (ctx) => listOrgMembers(ctx), {
    fallbackMessage: "Failed to load members.",
    log: { message: LOG_MESSAGE, context: { op: "organization:list-members" } },
  });
}

export async function listInvitationsFn(): Promise<
  ActionResult<OrgInvitationRow[]>
> {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, "admin");
    return listOrgInvitations(ctx);
  }, {
    fallbackMessage: "Failed to load invitations.",
    log: { message: LOG_MESSAGE, context: { op: "organization:list-invitations" } },
  });
}

export async function listOrganizationsFn(): Promise<
  ActionResult<OrganizationSummary[]>
> {
  return toResult(async () => {
    await requirePlatformAdmin();
    return listAllOrganizations();
  }, "Failed to load organizations.");
}

export async function listPlatformOrganizationsFn(): Promise<ActionResult<PlatformOrganizationDirectoryRow[]>> {
  return toResult(async () => {
    await requirePlatformAdmin();
    return listPlatformOrganizationDirectory();
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

// The switch toast reads "<Org> did not open. <reason>", so each reason says
// why in the switcher's own words. Better Auth's texts are system language.
const SWITCH_ACCESS_LOST = "You no longer have access to it.";
const SWITCH_ORG_GONE = "It no longer exists.";
const SWITCH_REASONS_BY_CODE: Record<string, string> = {
  USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION: SWITCH_ACCESS_LOST,
  ORGANIZATION_NOT_FOUND: SWITCH_ORG_GONE,
};

/** Better Auth's setActiveOrganization, with its error codes worded for the switcher. */
async function setActiveOrganizationAsMember(organizationId: string): Promise<void> {
  try {
    await auth.api.setActiveOrganization({
      body: { organizationId },
      headers: await headers(),
    });
  } catch (error) {
    const code = apiErrorCode(error);
    const reason = code ? SWITCH_REASONS_BY_CODE[code] : undefined;
    if (reason) throw new SafeError(reason);
    // Unmapped: keep Better Auth's system wording out of the toast ("Try again.").
    throw new Error("Better Auth could not set the active organization.", { cause: error });
  }
}

function apiErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "body" in error) {
    const code = (error.body as { code?: unknown } | null)?.code;
    if (typeof code === "string") return code;
  }
  return null;
}

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
  return toWarnableResult(async () => {
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
      await setActiveOrganizationAsMember(organizationId);
    } else {
      // No membership row: a removed member looks the same as a stranger. Say
      // the same thing for every id, existing or not, so nothing leaks.
      if (!(await isAdmin())) throw new SafeError(SWITCH_ACCESS_LOST);
      await requirePlatformAdmin();
      await setActiveOrgForPlatformAdmin(sessionId, organizationId);
    }

    // The session has moved. Saving the preference is a separate outcome: a
    // failure here is a warning, never a failed switch (issue #769).
    const warning = await saveOrgPreference(session.user.id, organizationId);
    return { data: { organizationId }, warning };
    // The toast already says "<Org> did not open.", so the catch-all carries
    // only the next step; a "Failed to switch ..." sentence would repeat it.
  }, "Try again.");
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
    throw new SafeError(SWITCH_ORG_GONE);
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
  input: unknown,
  options?: CreateIntentOptions,
): Promise<ActionResult<{
  organizationId: string;
  organizationName: string;
  firstAdmin: { kind: "member" } | { kind: "invited"; acceptUrl: string };
}>> {
  return toResult(async () => {
    await requirePlatformAdmin();
    const values = createOrganizationSchema.parse(input);
    const intentKey = parseCreateIntentKey(options);
    const organization = await createOrganizationWithAdmin({ ...values, organizationId: intentKey });
    return {
      organizationId: organization.id,
      organizationName: organization.name,
      firstAdmin: organization.firstAdmin.kind === "member"
        ? { kind: "member" as const }
        : { kind: "invited" as const, acceptUrl: buildAcceptUrl(organization.firstAdmin.invitationId) },
    };
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
  return toWarnableResult(async () => {
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
      throw new SafeError(
        "The invitation was not accepted. Check that it is still valid and try again.",
      );
    }
    await auth.api.setActiveOrganization({
      body: { organizationId },
      headers: await headers(),
    });
    const warning = await saveOrgPreference(session.user.id, organizationId);
    return { data: { organizationId }, warning };
  }, "Failed to accept invitation.");
}

export async function renameOrganizationAction(
  input: unknown,
): Promise<ActionResult<{ name: string; slug: string }>> {
  return withAction(async (ctx) => {
    const values = renameOrganizationSchema.parse(input);
    requireOrgRole(ctx, "admin");
    return renameActiveOrganization(ctx, values);
  }, {
    fallbackMessage: "Failed to rename the organization.",
    log: { message: LOG_MESSAGE, context: { op: "organization:rename" } },
  });
}
