"use server";

import { z } from "zod";
import { requireOrgContext } from "@/lib/auth/server";
import type { OrgContext } from "@/lib/auth/server";
import { ActionConflictError, toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit/in-memory";
import type { ActionResult } from "@/types/actions";
import { logActionError } from "./action-errors";

interface WithActionOptions {
  /** Prefix for ZodError messages. Default: "Validation error" */
  zodErrorPrefix?: string;
  /** Fallback message when error is not an Error instance. */
  fallbackMessage?: string;
  /**
   * Opt-in per-user abuse limit, scoped by `key`. Only expensive actions (e.g.
   * the certification submit pipeline) pass this; CRUD actions leave it unset.
   * Checked after auth so the limiter keys on the resolved user id.
   */
  rateLimit?: { key: string; max: number; windowMs: number };
}

/**
 * Wrap a server action with auth, try/catch, and ActionResult formatting.
 * Does NOT handle field mapping, withAutoCode, or other entity-specific logic.
 */
export async function withAction<T>(
  fn: (ctx: OrgContext) => Promise<T>,
  options?: WithActionOptions
): Promise<ActionResult<T>> {
  const {
    zodErrorPrefix = "Validation error",
    fallbackMessage = "The action could not be completed. Try again.",
    rateLimit,
  } = options ?? {};

  try {
    const ctx = await requireOrgContext();
    if (rateLimit) {
      const verdict = checkRateLimit({
        key: `${rateLimit.key}:${ctx.userId}`,
        max: rateLimit.max,
        windowMs: rateLimit.windowMs,
      });
      if (!verdict.allowed) {
        return {
          success: false,
          error: `Too many attempts. Try again in ${verdict.retryAfterSeconds}s.`,
        };
      }
    }
    const data = await fn(ctx);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `${zodErrorPrefix}: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    if (error instanceof ActionConflictError) {
      return {
        success: false,
        error: error.message,
        conflict: error.conflict,
      };
    }
    logActionError(error, {
      message: "server action failed",
    });
    return {
      success: false,
      error: toActionError(error, fallbackMessage),
    };
  }
}
