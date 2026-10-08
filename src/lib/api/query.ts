import { z } from "zod";
import { ApiHttpError } from "./http-error";

export function parseApiQuery<S extends z.ZodType>(request: Request, schema: S): z.output<S> {
  const params = new URL(request.url).searchParams;
  const values: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(values, key)) throw new ApiHttpError(400, "invalid_query", "Query parameters must not repeat.");
    Object.defineProperty(values, key, { value, enumerable: true });
  }
  const parsed = schema.safeParse(values);
  if (!parsed.success) throw new ApiHttpError(400, "invalid_query", "Send valid query parameters.");
  return parsed.data;
}

export const mutationQuerySchema = z.strictObject({
  dryRun: z.enum(["true", "false"]).optional().transform((value) => value === "true").describe("true validates and previews the write then rolls back; false commits the write (default)."),
});
