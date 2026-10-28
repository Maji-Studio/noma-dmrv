import { Resend } from "resend";
import { env } from "@/config/env";
import { logger } from "@/lib/log";

export type EmailType = "reset-password" | "verify-email" | "email-change-confirm" | "email-change-notice" | "org-invite" | "password-changed" | "role-changed" | "removed-from-organization";
export type EmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: "not-configured" | "provider-error" };

type EmailInput = {
  type: EmailType;
  userId?: string;
  invitationId?: string;
  memberId?: string;
  organizationId?: string;
  idempotencyKey?: string;
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative; every email sends both. */
  text: string;
};

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/** Preserve local fallback links only when delivery is unconfigured. */
export function logLocalFallbackLink(result: EmailResult, label: string, url: string): void {
  if (!result.sent && result.reason === "not-configured" && env.NODE_ENV !== "production") {
    console.log(`${label}=${url}`);
  }
}

/** Provider messages and exception text may contain addresses. Log only status. */
function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return;
  return typeof error.statusCode === "number" && Number.isFinite(error.statusCode)
    ? error.statusCode
    : undefined;
}

/** Server-only delivery boundary shared by every transactional email. */
export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const context = {
    emailType: input.type,
    userId: input.userId,
    invitationId: input.invitationId,
    organizationId: input.organizationId,
  };
  if (!resend || !env.RESEND_FROM_EMAIL) {
    logger.warn(context, "email not configured; using local link fallback");
    return { sent: false, reason: "not-configured" };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      replyTo: env.RESEND_REPLY_TO,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }, input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey });
    if (error || !data?.id) {
      logger.error({ ...context, statusCode: errorStatus(error) }, "email provider failed");
      return { sent: false, reason: "provider-error" };
    }
    logger.info({ ...context, messageId: data.id }, "email sent");
    return { sent: true, id: data.id };
  } catch (error) {
    logger.error({ ...context, statusCode: errorStatus(error) }, "email provider failed");
    return { sent: false, reason: "provider-error" };
  }
}
