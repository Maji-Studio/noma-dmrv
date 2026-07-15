/**
 * Better Auth configuration
 * Sets up authentication with email/password and admin invite
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { count, eq } from "drizzle-orm";
import { Resend } from "resend";
import { env } from "@/config/env";
import { db } from "@/db";
import { seedOrgDefaults } from "@/db/org-defaults";
import * as schema from "@/db/schema";
import { logger } from "@/lib/log";

/** Pending invitations expire after 7 days. */
const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const SINGLE_ORGANIZATION_COUNT = 1;

/**
 * Build the URL an invitee follows to accept an org invitation. The invitation
 * id is the only token; the accept page (src/app/(auth)/accept-invitation)
 * establishes the session and calls the plugin's accept endpoint.
 */
function buildInvitationAcceptUrl(invitationId: string): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return `${base}/accept-invitation/${invitationId}`;
}

const hasEmailConfig = Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
const resend = hasEmailConfig ? new Resend(env.RESEND_API_KEY) : null;
const isProduction = process.env.NODE_ENV === "production";

function sanitizeAuthUrl(url: string) {
  try {
    const parsed = new URL(url);
    const redactedPath = parsed.pathname
      .split("/")
      .map((segment) => (segment.length >= 20 ? "<redacted>" : segment))
      .join("/");
    return `${parsed.origin}${redactedPath}`;
  } catch {
    const base = url.split("?")[0];
    return base || "<invalid-url>";
  }
}

// User-controlled values (profile name, organization name) are interpolated
// into email HTML; escape them so a crafted name can't inject markup into
// what email clients render.
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function logAuthEmailFallback(args: {
  type: "reset-password" | "verify-email";
  userId: string;
  url: string;
}) {
  const sanitizedUrl = sanitizeAuthUrl(args.url);
  console.warn(
    `[auth:${args.type}] RESEND_* env vars are not configured, using local fallback.`
  );
  // Never log the user's email — log userId only (see CLAUDE.md: no PII in logs).
  console.warn(
    `[auth:${args.type}] userId=${args.userId} url=${sanitizedUrl}`
  );
  if (!isProduction) {
    console.warn(`[auth:${args.type}] fullUrl=${args.url}`);
  }
}

async function sendAuthEmail(args: {
  type: "reset-password" | "verify-email";
  userId: string;
  to: string;
  subject: string;
  html: string;
  url: string;
}) {
  if (!resend || !env.RESEND_FROM_EMAIL) {
    logAuthEmailFallback({
      type: args.type,
      userId: args.userId,
      url: args.url,
    });
    return;
  }

  await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: args.to,
    subject: args.subject,
    html: args.html,
  });
}

/**
 * Build the list of origins Better Auth accepts on auth requests.
 *
 * Sign-in/sign-up requests are rejected unless their Origin header is trusted.
 * trustedOrigins is Better Auth's CSRF guard — it validates the Origin header
 * on auth mutations and gates redirect targets. Keep it least-privilege: only
 * the exact hosts that serve THIS deployment.
 *
 * We intentionally do NOT wildcard a shared host:
 *   - "*.vercel.app" would trust every app on Vercel (multi-tenant).
 *   - "*.maji.studio" would trust every sibling subdomain (n8n.maji.studio,
 *     staging.maji.studio, …) — an XSS or subdomain takeover on any of them
 *     would become a trusted origin against auth.
 *
 * The canonical custom domain comes from NEXT_PUBLIC_APP_URL (per-environment:
 * noma.maji.studio in prod, staging.noma.maji.studio in preview). The raw
 * deployment URLs come from Vercel's own project-bound env vars.
 */
function buildTrustedOrigins(): string[] {
  const origins = [
    env.NEXT_PUBLIC_APP_URL,
    // Vercel-provided URLs bound to this project/deployment, when present.
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    process.env.VERCEL_BRANCH_URL
      ? `https://${process.env.VERCEL_BRANCH_URL}`
      : null,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null,
  ].filter((origin): origin is string => Boolean(origin));

  // De-duplicate while preserving order.
  return [...new Set(origins)];
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      organization: schema.organizations,
      member: schema.members,
      invitation: schema.invitations,
    },
  }),
  user: {
    additionalFields: {
      // Surfaces the `role` column (admin | user) on the session user so
      // requireAdmin() can gate admin routes. input:false keeps it out
      // of self-service signup.
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: !env.ALLOW_SELF_SIGNUP,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 72,
    sendResetPassword: async ({ user, url }) => {
      try {
        await sendAuthEmail({
          type: "reset-password",
          userId: user.id,
          to: user.email,
          subject: "Reset your password",
          url,
          html: `
            <p>Hello ${escapeHtml(user.name || "there")},</p>
            <p>You requested to reset your password. Click the link below to continue:</p>
            <p><a href="${url}">Reset Password</a></p>
            <p>This link will expire in 24 hours.</p>
            <p>If you didn't request this, you can safely ignore this email.</p>
          `,
        });
      } catch (error) {
        console.error("Failed to send password reset email:", {
          userId: user.id,
          from: env.RESEND_FROM_EMAIL,
          error,
        });
        throw error;
      }
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: 60 * 60 * 24, // 24 hours
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      try {
        await sendAuthEmail({
          type: "verify-email",
          userId: user.id,
          to: user.email,
          url,
          subject: "Verify your email",
          html: `
            <p>Hello ${escapeHtml(user.name || "there")},</p>
            <p>Please verify your email address by clicking the link below:</p>
            <p><a href="${url}">Verify Email</a></p>
            <p>This link will expire in 24 hours.</p>
          `,
        });
      } catch (error) {
        console.error("Failed to send verification email:", {
          userId: user.id,
          from: env.RESEND_FROM_EMAIL,
          error,
        });
        throw error;
      }
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Refresh every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  rateLimit: {
    enabled: process.env.DISABLE_RATE_LIMIT !== "true",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 15 * 60, max: 10 },
      "/sign-up/email": { window: 60 * 60, max: 3 },
      "/request-password-reset": { window: 15 * 60, max: 5 },
      "/reset-password": { window: 15 * 60, max: 10 },
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.NEXT_PUBLIC_APP_URL,
  trustedOrigins: buildTrustedOrigins(),
  databaseHooks: {
    session: {
      create: {
        // On sign-in, auto-select the active organization for a sole member,
        // or for a Platform Admin when the PR-1 gate permits only one org.
        before: async (session) => {
          const memberships = await db
            .select({ organizationId: schema.members.organizationId })
            .from(schema.members)
            .where(eq(schema.members.userId, session.userId))
            .limit(2);
          if (memberships.length === 1) {
            return {
              data: {
                ...session,
                activeOrganizationId: memberships[0].organizationId,
              },
            };
          }
          if (memberships.length === 0) {
            const [user] = await db
              .select({ role: schema.users.role })
              .from(schema.users)
              .where(eq(schema.users.id, session.userId))
              .limit(1);
            if (user?.role === "admin") {
              const [organizationCount] = await db
                .select({ value: count() })
                .from(schema.organizations);
              if (
                Number(organizationCount?.value ?? 0) ===
                SINGLE_ORGANIZATION_COUNT
              ) {
                const [organizationRow] = await db
                  .select({ id: schema.organizations.id })
                  .from(schema.organizations)
                  .limit(1);
                if (organizationRow) {
                  // Coupled to MAX_ORGANIZATIONS_UNTIL_PR2 in data-access:
                  // revisit when PR 2 allows a second org, because "the only
                  // org" immediately stops being a safe Platform Admin default.
                  return {
                    data: {
                      ...session,
                      activeOrganizationId: organizationRow.id,
                    },
                  };
                }
              }
            }
          }
          return { data: session };
        },
      },
    },
  },
  plugins: [
    organization({
      // Organization creation is reserved for app-level Platform Admins. The
      // guarded server action uses the server-only userId path so the selected
      // user, rather than the acting Platform Admin, becomes the Owner.
      allowUserToCreateOrganization: false,
      organizationHooks: {
        afterCreateOrganization: async ({ organization }) => {
          try {
            await seedOrgDefaults(db, organization.id);
          } catch (error) {
            // Organization and owner membership are already committed before
            // this hook runs. Starter types are optional and can be recreated,
            // so do not turn a recoverable seed failure into a wedged retry.
            logger.error(
              { error, organizationId: organization.id },
              "failed to seed organization defaults",
            );
          }
        },
      },
      invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
      // Re-inviting the same email cancels the stale pending invite so the
      // pending list never shows duplicates.
      cancelPendingInvitationsOnReInvite: true,
      sendInvitationEmail: async (data) => {
        const acceptUrl = buildInvitationAcceptUrl(data.id);
        // The UI also surfaces a copyable accept link from the invite action,
        // so email is best-effort. Never log the invitee email (PII) — log the
        // invitation and organization ids only.
        if (!resend || !env.RESEND_FROM_EMAIL) {
          console.warn(
            `[auth:org-invite] RESEND_* not configured; using copyable-link fallback. invitationId=${data.id} organizationId=${data.organization.id}`
          );
          if (!isProduction) {
            console.warn(`[auth:org-invite] acceptUrl=${acceptUrl}`);
          }
          return;
        }
        try {
          await resend.emails.send({
            from: env.RESEND_FROM_EMAIL,
            to: data.email,
            subject: `You're invited to join ${data.organization.name}`,
            html: `
              <p>Hello,</p>
              <p>You've been invited to join <strong>${escapeHtml(data.organization.name)}</strong> as ${escapeHtml(data.role)}.</p>
              <p><a href="${acceptUrl}">Accept invitation</a></p>
              <p>This invitation expires in 7 days.</p>
            `,
          });
        } catch (error) {
          console.error("Failed to send org invitation email:", {
            invitationId: data.id,
            organizationId: data.organization.id,
            from: env.RESEND_FROM_EMAIL,
            error,
          });
          // Swallow — the copyable link in the UI is the reliable path.
        }
      },
    }),
    nextCookies(),
  ],
});
