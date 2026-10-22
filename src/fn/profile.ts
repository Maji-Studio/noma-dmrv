"use server";

/**
 * Settings, You, Profile: a signed-in person changes their own name and
 * password. Better Auth owns the user, credential and session rows, so these
 * actions go through its API with the caller's own session headers; nothing
 * here can name another user. Email is not editable (#1277, decision 3).
 */
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "@/config/auth";
import { auth } from "@/lib/auth/better-auth";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import { changePasswordSchema, profileNameSchema } from "@/schemas/profile";
import { withAction } from "./with-action";

// Guessing the current password through this form is throttled per user.
const CHANGE_PASSWORD_MAX_ATTEMPTS = 5;
const CHANGE_PASSWORD_WINDOW_MS = 15 * 60 * 1000;

const VALIDATION_FAILED = "validation_failed";

function fieldRefusal(field: "currentPassword" | "newPassword", message: string): DomainError {
  return new DomainError(VALIDATION_FAILED, message, {
    issues: [{ path: [field], code: VALIDATION_FAILED, message }],
  });
}

function translatePasswordError(error: unknown): never {
  if (error instanceof APIError) {
    switch (error.body?.code) {
      case "INVALID_PASSWORD":
        throw fieldRefusal("currentPassword", "That is not your current password.");
      case "CREDENTIAL_ACCOUNT_NOT_FOUND":
        throw new SafeError("This account signs in without a password.");
      case "PASSWORD_TOO_SHORT":
        throw fieldRefusal("newPassword", `Password must be at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`);
      case "PASSWORD_TOO_LONG":
        throw fieldRefusal("newPassword", `Password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`);
    }
  }
  // Auth errors can carry the submitted passwords. Never hand their messages
  // or causes to the action wrapper's logger.
  throw new Error("Profile password request failed");
}

export async function updateProfileNameFn(input: unknown) {
  return withAction(async () => {
    const { name } = profileNameSchema.parse(input);
    try {
      await auth.api.updateUser({ body: { name }, headers: await headers() });
    } catch {
      throw new Error("Profile name request failed");
    }
    return { name };
  }, {
    fallbackMessage: "Your name was not saved. Try again.",
    log: { message: "profile action failed", context: { op: "update-name" } },
  });
}

/**
 * Changes the caller's password, then signs out every other device; this
 * device keeps its session (#1277, decision 4). Better Auth's own
 * `revokeOtherSessions` flag on change-password creates a replacement session
 * inside its transaction, whose create hook then waits for a second pool
 * connection, so the two steps run one after the other instead.
 */
export async function changePasswordFn(input: unknown) {
  return withAction(async (ctx) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(input);
    const requestHeaders = await headers();
    try {
      await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: false },
        headers: requestHeaders,
      });
    } catch (error) {
      translatePasswordError(error);
    }
    try {
      await auth.api.revokeOtherSessions({ headers: requestHeaders });
      return { otherDevicesSignedOut: true };
    } catch {
      // The password changed; only the sign-out of other devices failed. The
      // flag, not ActionResult.warning, carries it: withAction has no warning
      // path. The error itself is not logged, since it may carry PII.
      logger.warn({ op: "change-password", userId: ctx.userId }, "other sessions were not signed out");
      return { otherDevicesSignedOut: false };
    }
  }, {
    rateLimit: { key: "change-password", max: CHANGE_PASSWORD_MAX_ATTEMPTS, windowMs: CHANGE_PASSWORD_WINDOW_MS },
    fallbackMessage: "Your password was not changed. Try again.",
    log: { message: "profile action failed", context: { op: "change-password" } },
  });
}
