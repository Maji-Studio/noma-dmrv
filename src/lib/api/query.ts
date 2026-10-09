import { z } from "zod";
import { ApiHttpError } from "./http-error";
import { API_TEXT_PATTERN } from "./input-text";

export function parseApiQuery<S extends z.ZodType>(request: Request, schema: S): z.output<S> {
  const params = new URL(request.url).searchParams;
  const values: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(values, key)) throw new ApiHttpError(400, "invalid_query", "Query parameters must not repeat.");
    Object.defineProperty(values, key, { value, enumerable: true });
  }
  return parseQueryInput(values, schema);
}

/**
 * Free-text list filters get the control-character pre-check. Identifiers such
 * as an MCP get tool's idOrCode are not filters: they answer not_found, as the
 * REST path segment does. Other fields are validated by their own schema.
 */
const CONTROL_CHECKED_QUERY_KEYS: ReadonlySet<string> = new Set(["q", "code", "cursor"]);

/** Shared validation preserves REST query error codes and issue paths. */
export function parseQueryInput<S extends z.ZodType>(values: unknown, schema: S): z.output<S> {
  if (values && typeof values === "object") {
    const issues: z.core.$ZodIssue[] = Object.entries(values)
      .filter(([key, value]) => CONTROL_CHECKED_QUERY_KEYS.has(key) && typeof value === "string" && !API_TEXT_PATTERN.test(value))
      .map(([key]) => ({ code: "custom", path: [key], message: "Query values must not contain control characters." }));
    if (issues.length) throw new ApiHttpError(400, "invalid_query", "Send query values without control characters.", undefined, issues);
  }
  const parsed = schema.safeParse(values);
  if (!parsed.success) throw new ApiHttpError(400, "invalid_query", "Send valid query parameters.", undefined, parsed.error.issues);
  return parsed.data;
}

export const mutationQuerySchema = z.strictObject({
  dryRun: z.enum(["true", "false"]).optional().transform((value) => value === "true").describe("true validates and previews the write then rolls back; false commits the write (default)."),
});
