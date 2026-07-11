"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { logActionError } from "@/fn/action-errors";
import {
  createInvitedAccount,
  getInvitationBootstrapState as readInvitationBootstrapState,
  type InvitationBootstrapState,
} from "@/data-access/invitation-bootstrap";
import { auth } from "@/lib/auth/better-auth";
import { hashPassword } from "@/lib/auth/hash-password";
import { SafeError, toActionError } from "@/lib/errors";
import {
  invitationBootstrapSchema,
  invitationIdSchema,
} from "@/schemas/organizations";
import type { ActionResult } from "@/types/actions";

const INVITATION_LOAD_FALLBACK = "Failed to load invitation.";
const INVITATION_BOOTSTRAP_FALLBACK = "Failed to create invited account.";

async function toResult<T>(
  work: () => Promise<T>,
  fallback: string
): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await work() };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((issue) => issue.message).join(", "),
      };
    }
    if (!(error instanceof SafeError)) {
      logActionError(error, { message: "invitation bootstrap action failed" });
    }
    return { success: false, error: toActionError(error, fallback) };
  }
}

async function currentAuthHeaders(): Promise<Headers> {
  const requestHeaders = new Headers(await headers());
  const cookieHeader = (await cookies())
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  if (cookieHeader) requestHeaders.set("cookie", cookieHeader);
  return requestHeaders;
}

export async function getInvitationBootstrapState(
  input: unknown
): Promise<ActionResult<InvitationBootstrapState>> {
  return toResult(async () => {
    const { invitationId } = invitationIdSchema.parse(input);
    return readInvitationBootstrapState(invitationId);
  }, INVITATION_LOAD_FALLBACK);
}

/**
 * Intentionally replaces the normal requireAuth guard: the invitation id must
 * be pending and unexpired, is single-use once accepted, and supplies the
 * email server-side. Account creation never trusts an email from the client;
 * Better Auth then enforces the signed-in email match before acceptance.
 */
export async function bootstrapInvitationAccountAction(
  input: unknown
): Promise<ActionResult<{ organizationId: string }>> {
  return toResult(async () => {
    const { invitationId, name, password } =
      invitationBootstrapSchema.parse(input);
    const state = await readInvitationBootstrapState(invitationId);
    if (state.accountExists) {
      throw new SafeError(
        "An account already exists for this invitation. Sign in instead."
      );
    }

    const passwordHash = await hashPassword(password);
    const account = await createInvitedAccount({
      invitationId,
      name,
      passwordHash,
    });
    await auth.api.signInEmail({
      body: { email: account.email, password },
      headers: await headers(),
    });
    const accepted = await auth.api.acceptInvitation({
      body: { invitationId },
      headers: await currentAuthHeaders(),
    });
    const organizationId = accepted?.invitation?.organizationId;
    if (!organizationId || organizationId !== account.organizationId) {
      throw new SafeError("Invitation could not be accepted.");
    }
    await auth.api.setActiveOrganization({
      body: { organizationId },
      headers: await currentAuthHeaders(),
    });
    return { organizationId };
  }, INVITATION_BOOTSTRAP_FALLBACK);
}
