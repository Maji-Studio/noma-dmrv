import { DatabaseError } from "pg";
import { pgErrorCode } from "@/db/errors";
import { DomainError } from "@/lib/domain-errors";
import { logger } from "@/lib/log";
import { problemResponse } from "./problem";

function databaseCause(error: unknown): DatabaseError | undefined {
  const visited = new Set<unknown>();
  while (error instanceof Error && !visited.has(error)) {
    if (error instanceof DatabaseError) return error;
    visited.add(error);
    error = error.cause;
  }
  return undefined;
}

/** REST failures never log messages, headers, payloads, stacks or raw causes. */
export function unexpectedApiErrorResponse(error: unknown, op: string, instance: string, requestId: string) {
  // Classify by trusted classes rather than a mutable error.name, which could
  // itself contain credential material supplied by a plugin or upstream API.
  const databaseError = databaseCause(error);
  const errorName = error instanceof DomainError ? "DomainError"
    : databaseError ? "DatabaseError"
    : error instanceof TypeError ? "TypeError"
    : error instanceof RangeError ? "RangeError"
    : error instanceof SyntaxError ? "SyntaxError"
    : error instanceof Error ? "Error" : "UnknownError";
  const code = error instanceof DomainError ? error.code
    : databaseError ? pgErrorCode(databaseError) : undefined;
  logger.error({ op, requestId, errorName, ...(code ? { code } : {}) }, "API request failed");
  return problemResponse({ status: 500, code: "internal_error", detail: "", instance, requestId });
}
