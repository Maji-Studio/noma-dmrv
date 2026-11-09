"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import {
  formatZodActionError,
  logActionError,
  nulCharacterFailure,
  toWarnableSuccess,
  type ResultWithWarning,
} from "@/fn/action-errors";
import {
  createInvitedAccount,
  consumeInvitationSetPasswordRateLimit,
  getInvitationBootstrapState as readInvitationBootstrapState,
  type InvitationBootstrapState,
} from "@/data-access/invitation-bootstrap";
import { auth } from "@/lib/auth/better-auth";
import { InvitationAccountExistsError } from "@/data-access/invitation-bootstrap-errors";
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
  return toWarnableResult(async () => ({ data: await work() }), fallback);
}

/**
 * As `toResult`, for bodies whose work has a committed part and a non-fatal
 * follow-up. A returned `warning` keeps the result a success (issue #769).
 */
async function toWarnableResult<T>(
  work: () => Promise<ResultWithWarning<T>>,
  fallback: string
): Promise<ActionResult<T>> {
  try {
    return toWarnableSuccess(await work());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    const nulFailure = nulCharacterFailure(error);
    if (nulFailure) return nulFailure;
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

/** The invitation supplies the mailbox; setup never starts a session. */
export async function bootstrapInvitationAccountAction(
  input: unknown
): Promise<ActionResult<{ emailSent: true }>> {
  return toResult(async () => {
    const { invitationId, name } = invitationBootstrapSchema.parse(input);
    await requireSignedOut();
    let state = await readInvitationBootstrapState(invitationId);
    refuseConfirmedAccount(state);
    if (state.account === "none") {
      try {
        await createInvitedAccount({ invitationId, name });
      } catch (error) {
        if (!(error instanceof InvitationAccountExistsError)) throw error;
        state = await readInvitationBootstrapState(invitationId);
        if (state.account !== "pending") throw error;
      }
    }
    return sendInvitationSetPassword(state);
  }, INVITATION_BOOTSTRAP_FALLBACK);
}

/** A pending invitee can request another link without supplying a name. */
export async function resendInvitationSetPasswordAction(
  input: unknown
): Promise<ActionResult<{ emailSent: true }>> {
  return toResult(async () => {
    const { invitationId } = invitationIdSchema.parse(input);
    await requireSignedOut();
    const state = await readInvitationBootstrapState(invitationId);
    refuseConfirmedAccount(state);
    if (state.account !== "pending") {
      throw new SafeError("Enter your name to start account setup.");
    }
    return sendInvitationSetPassword(state);
  }, INVITATION_BOOTSTRAP_FALLBACK);
}

async function requireSignedOut(): Promise<void> {
  if (await auth.api.getSession({ headers: await currentAuthHeaders() })) {
    throw new SafeError(
      "You are already signed in. Sign out before creating a new account from an invitation."
    );
  }
}

function refuseConfirmedAccount(state: InvitationBootstrapState): void {
  if (state.account === "confirmed") {
    throw new SafeError("An account already exists for this invitation. Sign in instead.");
  }
}

async function sendInvitationSetPassword(state: InvitationBootstrapState): Promise<{ emailSent: true }> {
  if (await consumeInvitationSetPasswordRateLimit(state.invitationId)) {
    await auth.api.requestPasswordReset({ body: {
      email: state.email,
      redirectTo: `/set-password?invitation=${encodeURIComponent(state.invitationId)}`,
    } });
  }
  // A cooldown or provider failure has the same public acknowledgement.
  return { emailSent: true };
}
