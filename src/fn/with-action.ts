"use server";

import { z } from "zod";
import { getUser } from "@/lib/auth/server";
import type { ActionResult } from "@/types/actions";

interface WithActionOptions {
  /** Prefix for ZodError messages. Default: "Validation error" */
  zodErrorPrefix?: string;
  /** Fallback message when error is not an Error instance. Default: "An unexpected error occurred" */
  fallbackMessage?: string;
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
  } = options ?? {};

  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
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
      console.error("[withAction]", error.message);
    }
    return {
      success: false,
      error: fallbackMessage,
    };
  }
}
