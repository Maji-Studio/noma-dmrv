"use server";

import { cookies, headers } from "next/headers";
import {
  logActionError,
  toActionFailure,
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
const INVITATION_BOOTSTRAP_FALLBACK = "Your account could not be set up. Try again.";
/** Shown under the "Email me a link" form, which has no title of its own. */
const INVITATION_LINK_FALLBACK = "The link was not sent. Try again.";
/** Shown under the "Link not sent" title, next to Send again, so it gives the next step instead. */
const INVITATION_RESEND_FALLBACK = "If Send again fails too, ask your Admin to send the invitation again.";

async function toResult<T>(
  work: () => Promise<T>,
  fallback: string
): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await work() };
  } catch (error) {
    return toActionFailure(error, {
      fallbackMessage: fallback,
      log: { message: "invitation bootstrap action failed" },
    });
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
    return sendInvitationSetPassword(state, INVITATION_LINK_FALLBACK);
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
    return sendInvitationSetPassword(state, INVITATION_RESEND_FALLBACK);
  }, INVITATION_RESEND_FALLBACK);
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
    throw new InvitationAccountExistsError();
  }
}

async function sendInvitationSetPassword(
  state: InvitationBootstrapState,
  fallback: string,
): Promise<{ emailSent: true }> {
  let reservation: Awaited<ReturnType<typeof consumeInvitationSetPasswordRateLimit>> = false;
  try {
    reservation = await consumeInvitationSetPasswordRateLimit(state.invitationId);
    if (reservation) {
      await auth.api.requestPasswordReset({ body: {
        email: state.email,
        redirectTo: `/set-password?invitation=${encodeURIComponent(state.invitationId)}`,
      } });
    }
  } catch (error) {
    logActionError(error, { message: "invitation password setup email failed" });
    if (reservation) {
      try {
        await reservation.refund();
      } catch (refundError) {
        logActionError(refundError, { message: "invitation password setup cooldown refund failed" });
      }
    }
    throw new SafeError(toActionError(error, fallback));
  }
  // A cooldown has the same acknowledgement as a send. So does a provider
  // failure: Better Auth logs a failed sender and answers success, so only a
  // failed reset request (not a failed delivery) reaches the refund above.
  return { emailSent: true };
}
