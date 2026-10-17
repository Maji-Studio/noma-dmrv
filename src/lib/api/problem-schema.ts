import { z } from "zod";
import { stockEffectsSchema } from "@/lib/representations/stock-effects";

const conflictRefSchema = z.object({
  entity: z.string().describe("Conflicting resource kind, plain text."),
  id: z.string().describe("Conflicting resource identifier, opaque string."),
  code: z.string().describe("Operator-readable conflict label, plain text."),
});

export const stockPreviewSchema = z.object({
  basisFingerprint: z.string().describe("Stock basis of the fresh dry run, opaque string; send it back to write against that stock."),
  stockEffects: stockEffectsSchema,
});

export const cascadePreviewSchema = z.object({
  orders: z.array(z.object({ id: z.uuid().describe("Order identifier, UUID."), code: z.string().describe("Order code.") })).describe("Orders that this customer delete would remove."),
  cascadeFingerprint: z.string().describe("Opaque fingerprint of the order set; send it back to confirm this cascade."),
});

/** Wire shape emitted by problemResponse; open metadata carries safe domain limits. */
export const problemSchema = z.object({
  type: z.string().describe("Problem type URI, urn:noma:problem:<code>."),
  title: z.string().describe("Short HTTP status title, plain text."),
  status: z.number().int().describe("HTTP response status code."),
  detail: z.string().describe("Actionable plain-text detail; server failures are sanitized."),
  instance: z.string().describe("Request path, URI reference."),
  code: z.string().describe("Stable machine-readable problem code."),
  retryable: z.boolean().describe("Whether retrying may succeed; retain the same idempotency key."),
  errors: z.array(z.object({
    pointer: z.string().describe("RFC 6901 JSON Pointer to the invalid input; empty string denotes the root."),
    code: z.string().describe("Stable field error code."),
    detail: z.string().describe("Field correction guidance, plain text."),
    meta: z.record(z.string(), z.unknown()).optional().describe("Non-sensitive constraint metadata, such as maximum or unit; never rejected values."),
  })).describe("Input issues; empty for server failures."),
  conflict: conflictRefSchema.optional().describe("Visible record that blocks the write."),
  blockers: z.array(conflictRefSchema).optional().describe("Further visible blocking records, in display order."),
  current: z.unknown().optional().describe("Current resource representation after a failed version precondition."),
  preview: stockPreviewSchema.optional().describe("Fresh dry run after stock_basis_changed: the current basis fingerprint and stock effects. Absent when no preview could be computed."),
});

/** Customer delete has a cascade preview instead of a stock preview. */
export const customerDeleteConflictSchema = problemSchema.extend({
  preview: cascadePreviewSchema.optional().describe("Fresh order cascade after cascade_changed; absent if the fresh dry run failed."),
});
