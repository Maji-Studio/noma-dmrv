import { ZodError } from "zod";

import { toActionFailure, type ActionFailure } from "@/fn/action-errors";
import {
  resolveOrgContext,
  type OrgContext,
  type OrgContextDenial,
} from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { ActionResult } from "@/types/actions";

const PRIVATE_READ_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
} as const;

const STATUS = {
  ok: 200,
  invalidInput: 400,
  unauthenticated: 401,
  forbidden: 403,
  conflict: 409,
  serverError: 500,
} as const;

/**
 * A denied org context is an authorization answer, not a bad request: a caller
 * with no session can fix it by signing in (401), a signed-in caller with no
 * usable organization cannot (403).
 */
const DENIAL_RESPONSES: Record<
  OrgContextDenial,
  { error: string; status: number }
> = {
  unauthenticated: {
    error: "Sign in to continue.",
    status: STATUS.unauthenticated,
  },
  "no-organization": {
    error: "Select an Organization to continue.",
    status: STATUS.forbidden,
  },
};

const MALFORMED_BODY_ERROR =
  "The request could not be read. Refresh the page and try again.";

// A read request carries filters, not documents. The cap keeps a hostile or
// broken client from making the handler buffer an arbitrary body.
const MAX_READ_BODY_BYTES = 16 * 1024;
const OVERSIZED_BODY_ERROR =
  "The request was too large to read. Narrow the filters and try again.";

const READ_LOG_MESSAGE = "authenticated read failed";

interface ReadResponseOptions<T> {
  fallbackMessage: string;
  invalidInputContext?: string;
  logContext: string;
  read: (ctx: OrgContext) => Promise<T>;
}

/**
 * Decode a read request body. An unparseable body is the one genuine
 * bad-request case, so it is answered as such; a `SyntaxError` raised deeper in
 * a read is left alone and reported as a server fault.
 */
export async function readInput(request: Request): Promise<unknown> {
  if (declaredBodyBytes(request) > MAX_READ_BODY_BYTES) {
    throw new SafeError(OVERSIZED_BODY_ERROR);
  }
  const encoded = await request.text();
  if (encoded === "") return undefined;
  if (byteLength(encoded) > MAX_READ_BODY_BYTES) {
    throw new SafeError(OVERSIZED_BODY_ERROR);
  }
  try {
    return JSON.parse(encoded);
  } catch {
    throw new SafeError(MALFORMED_BODY_ERROR);
  }
}

/** The body size the client declared, or 0 when it declared none. */
function declaredBodyBytes(request: Request): number {
  const declared = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  return Number.isNaN(declared) ? 0 : declared;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * HTTP adapter for private read models. Authentication is resolved once per
 * request, the read callback receives that verified `OrgContext`, failures are
 * formatted by the same helper `withAction` uses, and every response is
 * explicitly private and non-cacheable by intermediaries.
 */
export async function readResponse<T>({
  fallbackMessage,
  invalidInputContext,
  logContext,
  read,
}: ReadResponseOptions<T>): Promise<Response> {
  try {
    // Resolving the context reads the database, so it is inside the same
    // try/catch: a failure there is a server fault like any other, not an
    // unhandled rejection that escapes without a log line.
    const resolution = await resolveOrgContext();
    if (!resolution.ok) {
      const denied = DENIAL_RESPONSES[resolution.denial];
      return readJson({ success: false, error: denied.error }, denied.status);
    }
    return readJson(
      { success: true, data: await read(resolution.ctx) },
      STATUS.ok,
    );
  } catch (error) {
    const failure = toActionFailure(error, {
      fallbackMessage,
      log: { message: READ_LOG_MESSAGE, context: { op: logContext } },
      zodErrorPrefix: invalidInputContext,
    });
    return readJson(failure, failureStatus(error, failure));
  }
}

/**
 * Rejected input and org-scoped lookups that came back empty are both client
 * mistakes (400); an unexpected failure is ours (500).
 */
function failureStatus(error: unknown, failure: ActionFailure): number {
  if (failure.conflict) return STATUS.conflict;
  if (error instanceof ZodError || error instanceof SafeError) {
    return STATUS.invalidInput;
  }
  return STATUS.serverError;
}

function readJson(body: ActionResult<unknown>, status: number): Response {
  return Response.json(body, { status, headers: PRIVATE_READ_HEADERS });
}
