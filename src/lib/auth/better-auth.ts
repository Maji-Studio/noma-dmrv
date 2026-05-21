/**
 * Better Auth configuration
 * Sets up authentication with email/password and admin invite
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Resend } from "resend";
import { env } from "@/config/env";
import { db } from "@/db";
import * as schema from "@/db/schema";

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

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
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
            <p>Hello ${user.name || "there"},</p>
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
            <p>Hello ${user.name || "there"},</p>
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
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
});
