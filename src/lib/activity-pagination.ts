import { z } from "zod";
import { SafeError } from "@/lib/errors";

export const DEFAULT_ACTIVITY_PAGE_SIZE = 50;
export const MAX_ACTIVITY_PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 256;
const MAX_SEQUENCE = BigInt("9223372036854775807");
const cursorSchema = z.object({
  occurredAt: z.iso.datetime({ precision: 3 }),
  sequence: z.string().regex(/^[1-9]\d*$/).refine(value => BigInt(value) <= MAX_SEQUENCE),
}).strict();
export const activityPageOptionsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(MAX_ACTIVITY_PAGE_SIZE).default(DEFAULT_ACTIVITY_PAGE_SIZE),
});
export type ActivityPageOptions = z.input<typeof activityPageOptionsSchema>;
export function decodeActivityCursor(cursor: string) {
  try {
    if (!cursor || cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const buffer = Buffer.from(cursor, "base64url");
    if (buffer.toString("base64url") !== cursor) throw new Error();
    const parsed = cursorSchema.parse(JSON.parse(buffer.toString("utf8")));
    const occurredAt = new Date(parsed.occurredAt);
    if (occurredAt.toISOString() !== parsed.occurredAt) throw new Error();
    return { occurredAt, sequence: BigInt(parsed.sequence) };
  } catch {
    throw new SafeError("Invalid activity cursor");
  }
}
export function encodeActivityCursor(row: { occurredAt: Date; sequence: bigint }) {
  return Buffer.from(JSON.stringify({ occurredAt: row.occurredAt.toISOString(), sequence: row.sequence.toString() })).toString("base64url");
}
