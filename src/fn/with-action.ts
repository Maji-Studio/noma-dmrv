"use server";

import { z } from "zod";
import { getUser } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit/in-memory";
import type { ActionResult } from "@/types/actions";

interface WithActionOptions {
  /** Prefix for ZodError messages. Default: "Validation error" */
  zodErrorPrefix?: string;
  /** Fallback message when error is not an Error instance. Default: "An unexpected error occurred" */
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
  fn: (userId: string) => Promise<T>,
  options?: WithActionOptions
): Promise<ActionResult<T>> {
  const {
    zodErrorPrefix = "Validation error",
    fallbackMessage = "An unexpected error occurred",
    rateLimit,
  } = options ?? {};

  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }
    if (rateLimit) {
      const verdict = checkRateLimit({
        key: `${rateLimit.key}:${user.id}`,
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
    const data = await fn(user.id);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `${zodErrorPrefix}: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    if (process.env.NODE_ENV === "development" && error instanceof Error) {
      console.error("[withAction]", error.name, error.constructor.name);
    }
    return {
      success: false,
      error:
        error instanceof SafeError || process.env.NODE_ENV === "development"
          ? (error instanceof Error ? error.message : fallbackMessage)
          : fallbackMessage,
    };
  }
}
