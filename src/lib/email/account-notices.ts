import { randomUUID } from "node:crypto";
import { env } from "@/config/env";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";
import { logger } from "@/lib/log";
import { orgRoleLabel } from "@/lib/org-role-label";
import { orgRoleSchema } from "@/schemas/organizations";
import { logLocalFallbackLink, sendEmail, type EmailType } from "./send";
import { passwordChangedEmail } from "./templates/password-changed-email";
import { roleChangedEmail } from "./templates/role-changed-email";
import { removedFromOrganizationEmail } from "./templates/removed-from-organization-email";

type NoticeRecipient = { userId: string; email: string };
type MemberNotice = NoticeRecipient & {
  memberId: string;
  organizationId: string;
  organizationName: string;
};

/** Everything here is best-effort and must be called only after commit. */
async function deliverNotice(
  type: EmailType,
  recipient: NoticeRecipient & { memberId?: string; organizationId?: string },
  compose: () => Promise<{ subject: string; html: string; text: string }>,
  fallbackUrl: string,
): Promise<void> {
  const context = { userId: recipient.userId, memberId: recipient.memberId, organizationId: recipient.organizationId };
  try {
    const content = await compose();
    const result = await sendEmail({
      type, ...context, to: recipient.email, ...content,
      // Every committed event gets a new key, including repeated role cycles.
      idempotencyKey: `${type}/${recipient.memberId ?? recipient.userId}/${randomUUID()}`,
    });
    if (!result.sent) logger.warn(context, "account notice was not sent");
    logLocalFallbackLink(result, `[auth:${type}] appUrl`, fallbackUrl);
  } catch {
    // Provider errors (and even their names) can contain PII.
    logger.error(context, "account notice delivery failed");
  }
}

async function currentActor(expectedUserId?: string) {
  try {
    const actor = (await getBetterAuthSession())?.user;
    return actor && (!expectedUserId || actor.id === expectedUserId) ? actor : undefined;
  } catch {
    return undefined;
  }
}

export async function sendPasswordChangedNotice(recipient: NoticeRecipient): Promise<void> {
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  const resetUrl = `${appUrl}/forgot-password`;
  await deliverNotice("password-changed", recipient, async () => passwordChangedEmail({
    to: recipient.email, changedAt: new Date(), resetUrl, appUrl,
  }), resetUrl);
}

export async function sendRoleChangedNotice(input: MemberNotice & {
  fromRole: string;
  toRole: string;
  actorUserId?: string;
}): Promise<void> {
  if (input.fromRole === input.toRole) return;
  await deliverNotice("role-changed", input, async () => {
    const actor = await currentActor(input.actorUserId);
    return roleChangedEmail({
      to: input.email, organizationName: input.organizationName,
      actorName: actor?.name?.trim() || undefined,
      fromRole: orgRoleLabel(orgRoleSchema.parse(input.fromRole))!,
      toRole: orgRoleLabel(orgRoleSchema.parse(input.toRole))!,
      changedAt: new Date(), appUrl: env.NEXT_PUBLIC_APP_URL,
    });
  }, env.NEXT_PUBLIC_APP_URL);
}

export async function sendRemovedFromOrganizationNotice(input: MemberNotice & {
  actorUserId?: string;
}): Promise<void> {
  if (input.actorUserId === input.userId) return;
  await deliverNotice("removed-from-organization", input, async () => {
    const actor = await currentActor(input.actorUserId);
    return removedFromOrganizationEmail({
      to: input.email, organizationName: input.organizationName,
      actorName: actor?.name?.trim() || undefined,
      removedAt: new Date(), appUrl: env.NEXT_PUBLIC_APP_URL,
    });
  }, env.NEXT_PUBLIC_APP_URL);
}
