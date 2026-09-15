import { z } from "zod";

import { formatZodActionError, toLoggedActionError } from "@/fn/action-errors";
import { requireOrgContext, type OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";

const PRIVATE_READ_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
} as const;

interface ReadResponseOptions<T> {
  fallbackMessage: string;
  invalidInputContext?: string;
  logContext: string;
  read: (ctx: OrgContext) => Promise<T>;
}

export async function readInput(request: Request): Promise<unknown> {
  const encoded = await request.text();
  return encoded === "" ? undefined : JSON.parse(encoded);
}

/**
 * HTTP adapter for private read models. Authentication is resolved once per
 * request, the orchestration callback receives that verified OrgContext, and
 * every response is explicitly private and non-cacheable by intermediaries.
 */
export async function readResponse<T>({
  fallbackMessage,
  invalidInputContext,
  logContext,
  read,
}: ReadResponseOptions<T>): Promise<Response> {
  try {
    const ctx = await requireOrgContext();
    const data = await read(ctx);
    return Response.json(
      { success: true, data },
      { headers: PRIVATE_READ_HEADERS },
    );
  } catch (error) {
    const invalidInput = error instanceof z.ZodError || error instanceof SyntaxError;
    const message =
      error instanceof z.ZodError
        ? formatZodActionError(error, invalidInputContext)
        : error instanceof SyntaxError
          ? invalidInputContext ?? "Invalid read parameters."
          : toLoggedActionError(error, fallbackMessage, {
              message: "authenticated read failed",
              context: { op: logContext },
            });

    return Response.json(
      { success: false, error: message },
      {
        status: invalidInput || error instanceof SafeError ? 400 : 500,
        headers: PRIVATE_READ_HEADERS,
      },
    );
  }
}
