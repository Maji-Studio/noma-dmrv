"use server";

import { z } from "zod";
import { requireOrgContext } from "@/lib/auth/server";
import type { OrgContext } from "@/lib/auth/server";
import { ActionConflictError, toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit/in-memory";
import type { ActionResult } from "@/types/actions";
import { formatZodActionError, logActionError } from "./action-errors";

interface WithActionOptions<T> {
  /** Optional task-specific context for ZodError messages. */
  zodErrorPrefix?: string;
  /** Fallback message when error is not an Error instance. */
  fallbackMessage?: string;
  /**
   * Opt-in per-user abuse limit, scoped by `key`. Only expensive actions (e.g.
   * the certification submit pipeline) pass this; CRUD actions leave it unset.
   * Checked after auth so the limiter keys on the resolved user id.
   */
  rateLimit?: { key: string; max: number; windowMs: number };
  /**
   * Structured log line for unexpected errors (not Zod, not conflict, not
   * mapped). Per-entity actions pass their existing message and `op` context
   * so the log output is unchanged when they migrate onto this helper.
   */
  log?: { message: string; context?: Record<string, unknown> };
  /**
   * Consulted after the Zod and conflict branches and before the generic
   * fallback. Return an `ActionResult` to answer the caller with it (domain
   * errors that carry a field or a conflict of their own); return `undefined`
   * to fall through to logging and the fallback message.
   */
  mapError?: (error: unknown) => ActionResult<T> | undefined;
}

const DEFAULT_LOG = { message: "server action failed" } as const;

/**
 * Wrap a server action with auth, try/catch, and ActionResult formatting.
 * Does NOT handle field mapping, withAutoCode, or other entity-specific logic.
 */
export async function withAction<T>(
  fn: (ctx: OrgContext) => Promise<T>,
  options?: WithActionOptions<T>
): Promise<ActionResult<T>> {
  const {
    zodErrorPrefix,
    fallbackMessage = "The action could not be completed. Try again.",
    rateLimit,
    log = DEFAULT_LOG,
    mapError,
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
        error: formatZodActionError(error, zodErrorPrefix),
      };
    }
    if (error instanceof ActionConflictError) {
      return {
        success: false,
        error: error.message,
        conflict: error.conflict,
      };
    }
    const mapped = mapError?.(error);
    if (mapped) return mapped;
    logActionError(error, log);
    return {
      success: false,
      error: toActionError(error, fallbackMessage),
    };
  }
}
