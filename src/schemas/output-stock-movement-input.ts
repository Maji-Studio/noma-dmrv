import { z } from "zod";
import { eventInstantSchema } from "./event-instant";
import { expectedVersionSchema } from "./helpers";
import {
  moistureSchema, orderedSourcesSchema, OUTPUT_STOCK_REASON_MAX_LENGTH, OUTPUT_STOCK_REQUEST_KEY_MAX_LENGTH,
  reasonSchema, refineOutputStockEntry, wetMassSchema,
} from "./output-stock";

/** What REST and MCP publish (decisions 50 and 53): losses and counts, no corrections, no product versions. */
const publishedBodyFields = {
  kind: z.enum(["loss", "count"]).describe("loss: wet mass that left the bin. count: the whole bin weighed; it resets stock and moisture and never raises stock."),
  occurredAt: eventInstantSchema,
  wetMassKg: wetMassSchema().describe("Wet kilograms lost, or the whole counted bin. A count of 0 records the bin as empty."),
  moisturePercent: moistureSchema().nullable().optional().describe("Measured moisture as percent of wet mass, below 100. Required unless sources are given or a count is 0."),
  sources: orderedSourcesSchema.optional().describe("Split bins, losses only: the sub-bins in the order they were emptied, each with its moisture."),
  reason: reasonSchema(OUTPUT_STOCK_REASON_MAX_LENGTH).describe("Why the stock changed, untrusted plain text."),
  basisFingerprint: z.string().min(1).optional().describe("basisFingerprint from a dry run. If stock moved since, the write is refused with stock_basis_changed. Omit it to act on current stock."),
};

const publishedFields = {
  storageLocationId: z.uuid().describe("Biochar or product bin UUID. The facility and its time zone come from the bin."),
  ...publishedBodyFields,
};

/**
 * UI-only fields the operation also takes: a delivery correction, the facility
 * the form was opened for, the product versions its preview showed, and the
 * form's request key. None of them is in the published contract.
 */
const unpublishedFields = {
  kind: z.enum(["loss", "count", "delivery"]),
  correctsMovementId: z.uuid().optional(),
  facilityId: z.uuid().optional(),
  expectedProductVersions: z.record(z.uuid(), expectedVersionSchema).optional(),
  idempotencyKey: z.string().trim().min(1).max(OUTPUT_STOCK_REQUEST_KEY_MAX_LENGTH).optional(),
};

/** The published input of `record_output_stock_movement`; adapters reject anything else. */
export const recordOutputStockMovementApiInput = z.strictObject(publishedFields).superRefine(refineOutputStockEntry);

/** The REST body: the bin is the path segment, so the body names everything else. */
export const recordOutputStockMovementApiBody = z.strictObject(publishedBodyFields).superRefine(refineOutputStockEntry);

/** The full operation input: the published body plus the UI-only fields. */
export const recordOutputStockMovementInput = z.strictObject({ ...publishedFields, ...unpublishedFields }).superRefine(refineOutputStockEntry);

export type RecordOutputStockMovementInput = z.output<typeof recordOutputStockMovementInput>;
