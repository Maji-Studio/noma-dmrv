import { createHash } from "node:crypto";
import { z } from "zod";
import { API_CURSOR_MAX_LENGTH, API_CURSOR_VERSION } from "@/config/api-rest";
import { ApiHttpError } from "./http-error";

// Preserve PostgreSQL microseconds; JavaScript Date would skip tied rows.
const positionSchema = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() });
const cursorSchema = z.strictObject({
  v: z.literal(API_CURSOR_VERSION), binding: z.string(), position: positionSchema,
});
export type CursorPosition = z.infer<typeof positionSchema>;
export type CursorBinding = { organizationId: string; resource: string; filters: Record<string, string | undefined> };

function fingerprint(binding: CursorBinding): string {
  return createHash("sha256").update(JSON.stringify({
    organizationId: binding.organizationId, resource: binding.resource,
    filters: Object.entries(binding.filters).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)),
  })).digest("hex");
}

export function encodeCursor(position: CursorPosition, binding: CursorBinding): string {
  return Buffer.from(JSON.stringify({ v: API_CURSOR_VERSION, binding: fingerprint(binding), position })).toString("base64url");
}

export function decodeCursor(value: string, binding: CursorBinding): CursorPosition {
  try {
    if (value.length > API_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error();
    const cursor = cursorSchema.parse(JSON.parse(decoded.toString("utf8")));
    if (cursor.binding !== fingerprint(binding)) throw new Error();
    return cursor.position;
  } catch {
    throw new ApiHttpError(400, "invalid_cursor", "Use a cursor from this organization and filter set.");
  }
}
