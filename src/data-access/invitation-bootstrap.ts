import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { isPgUniqueViolation } from "@/db/errors";
import { INVITATION_SET_PASSWORD_RATE_LIMIT } from "@/config/auth";
import { invitations, users } from "@/db/schema";
import { consumeRateLimit, refundRateLimit } from "@/data-access/api-rate-limits";
import { InvitationAccountExistsError } from "@/data-access/invitation-bootstrap-errors";
import { auth } from "@/lib/auth/better-auth";
import { SafeError } from "@/lib/errors";

const USERS_EMAIL_UNIQUE_CONSTRAINT = "users_email_unique";

export type InvitationBootstrapState = {
  invitationId: string;
  email: string;
  organizationId: string;
  account: "none" | "pending" | "confirmed";
};

type ValidInvitation = {
  id: string;
  email: string;
  organizationId: string;
};

function assertValidInvitation(
  invitation: {
    id: string;
    email: string;
    organizationId: string;
    status: string;
    expiresAt: Date | null;
  } | undefined
): ValidInvitation {
  if (
    !invitation ||
    invitation.status !== "pending" ||
    !invitation.expiresAt ||
    invitation.expiresAt.getTime() <= Date.now()
  ) {
    throw new SafeError(
      "This invitation is invalid, expired, or already used. Ask an Admin for a new invitation.",
    );
  }
  return invitation;
}

// org-scope-ok: pre-sign-in lookup uses the email from the validated invitation.
async function findUserByEmail(
  executor: Pick<typeof db, "select">,
  email: string
): Promise<{ id: string; emailVerified: boolean } | undefined> {
  const [user] = await executor
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return user;
}

/**
 * This read is intentionally anonymous: possession of the pending, unexpired
 * invitation id is the bearer authorization for the bootstrap page. The
 * server derives the email from that row and never accepts it from the client.
 */
// org-scope-ok: pre-sign-in read is scoped to a pending, unexpired invitation id.
export async function getInvitationBootstrapState(
  invitationId: string
): Promise<InvitationBootstrapState> {
  const invitation = await readValidInvitation(invitationId);
  const user = await findUserByEmail(db, invitation.email);
  return {
    invitationId: invitation.id,
    email: invitation.email,
    organizationId: invitation.organizationId,
    account: user ? (user.emailVerified ? "confirmed" : "pending") : "none",
  };
}

/** Create a pending user; the invited mailbox establishes the credential. */
// org-scope-ok: pre-sign-in creation derives the email from a pending, unexpired invitation id.
export async function createInvitedAccount(input: {
  invitationId: string;
  name: string;
}): Promise<{ userId: string; email: string; organizationId: string }> {
  const invitation = await readValidInvitation(input.invitationId);
  if (await findUserByEmail(db, invitation.email)) {
    throw new InvitationAccountExistsError();
  }

  const email = invitation.email.toLowerCase();
  const { internalAdapter } = await auth.$context;
  let createdUser: Awaited<ReturnType<typeof internalAdapter.createUser>>;
  try {
    createdUser = await internalAdapter.createUser({
      email,
      name: input.name,
      emailVerified: false,
    }, { method: "invitation" });
  } catch (error) {
    // Normalized email plus the database uniqueness constraint is the race
    // backstop when two bootstrap requests pass the anonymous pre-check.
    if (isPgUniqueViolation(error, USERS_EMAIL_UNIQUE_CONSTRAINT)) {
      throw new InvitationAccountExistsError();
    }
    throw error;
  }

  return {
    userId: createdUser.id,
    email,
    organizationId: invitation.organizationId,
  };
}

/** Atomically reserve a password setup email across invitations for the mailbox. */
// org-scope-ok: pre-sign-in cooldown derives the user from a pending, unexpired invitation id.
export async function consumeInvitationSetPasswordRateLimit(
  invitationId: string
): Promise<false | { refund: () => Promise<void> }> {
  const invitation = await readValidInvitation(invitationId);
  const user = await findUserByEmail(db, invitation.email);
  if (!user) return false;
  const bucket = {
    key: `invitation-set-password:${user.id}`,
    ...INVITATION_SET_PASSWORD_RATE_LIMIT,
  };
  const result = await consumeRateLimit(bucket);
  return result.allowed ? { refund: () => refundRateLimit(bucket) } : false;
}

// org-scope-ok: pre-sign-in lookup validates the invitation id, status and expiry.
async function readValidInvitation(invitationId: string): Promise<ValidInvitation> {
  const [row] = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      organizationId: invitations.organizationId,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1);
  return assertValidInvitation(row);
}
