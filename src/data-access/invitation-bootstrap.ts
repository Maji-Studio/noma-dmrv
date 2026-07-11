import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, invitations, users } from "@/db/schema";
import { SafeError } from "@/lib/errors";

export type InvitationBootstrapState = {
  invitationId: string;
  email: string;
  organizationId: string;
  accountExists: boolean;
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
    throw new SafeError("Invitation not found, expired, or already used.");
  }
  return invitation;
}

async function findUserByEmail(
  executor: Pick<typeof db, "select">,
  email: string
): Promise<{ id: string } | undefined> {
  const [user] = await executor
    .select({ id: users.id })
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
export async function getInvitationBootstrapState(
  invitationId: string
): Promise<InvitationBootstrapState> {
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
  const invitation = assertValidInvitation(row);
  const user = await findUserByEmail(db, invitation.email);
  return {
    invitationId: invitation.id,
    email: invitation.email,
    organizationId: invitation.organizationId,
    accountExists: Boolean(user),
  };
}

/** Create the invited credential account after re-checking the bearer token. */
export async function createInvitedAccount(input: {
  invitationId: string;
  name: string;
  passwordHash: string;
}): Promise<{ userId: string; email: string; organizationId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        organizationId: invitations.organizationId,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(eq(invitations.id, input.invitationId))
      .limit(1)
      .for("update");
    const invitation = assertValidInvitation(row);
    if (await findUserByEmail(tx, invitation.email)) {
      throw new SafeError(
        "An account already exists for this invitation. Sign in instead."
      );
    }

    const userId = randomUUID();
    await tx.insert(users).values({
      id: userId,
      email: invitation.email.toLowerCase(),
      name: input.name,
      role: "user",
      // Receiving the single-use invitation proves control of this address.
      emailVerified: true,
    });
    await tx.insert(accounts).values({
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: "credential",
      password: input.passwordHash,
    });
    return {
      userId,
      email: invitation.email.toLowerCase(),
      organizationId: invitation.organizationId,
    };
  });
}
