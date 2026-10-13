import { z } from "zod";
import { creditBatchSamplingChoices, creditBatchStatuses } from "@/schemas/credit-batches";

/**
 * The lookup shape of a credit batch: just what a client needs to pick the
 * batch a lab sample belongs to. No rollups, mass, durability or certification
 * facts; those stay in the app.
 */
export const creditBatchRepresentationSchema = z.object({
  id: z.uuid().describe("Credit batch identifier, UUID."),
  code: z.string().describe("Human-readable credit batch code, unique within the organization."),
  version: z.number().int().positive().describe("Positive row version for concurrency checks."),
  facilityId: z.uuid().describe("Owning facility identifier, UUID. The facility sets the durability tier and the time zone."),
  feedstockTypeId: z.uuid().describe("The one feedstock type of this batch, UUID."),
  status: z.enum(creditBatchStatuses).describe("Registry progress: draft, pending, verified, issued or rejected."),
  sampling: z.enum(creditBatchSamplingChoices).describe("Whether the batch is sampled or unsampled; fixed at creation."),
  startDate: z.iso.date().describe("First day of the batch's production window, YYYY-MM-DD, in the facility's time zone."),
  endDate: z.iso.date().describe("Last day of the batch's production window, YYYY-MM-DD, in the facility's time zone."),
  archivedAt: z.iso.datetime().nullable().describe("Archive instant in UTC (RFC 3339), or null when active."),
  createdAt: z.iso.datetime().describe("Creation instant in UTC, RFC 3339."),
  updatedAt: z.iso.datetime().describe("Last update instant in UTC, RFC 3339."),
});
export type CreditBatchRepresentation = z.infer<typeof creditBatchRepresentationSchema>;

type Instant = Date | string;
export type CreditBatchRepresentationInput = Omit<CreditBatchRepresentation, "archivedAt" | "createdAt" | "updatedAt"> & {
  archivedAt: Instant | null; createdAt: Instant; updatedAt: Instant;
};

const instant = (value: Instant) => new Date(value).toISOString();

/** Explicit narrow projection; a joined or rich batch row cannot widen the API. */
export function representCreditBatch(row: CreditBatchRepresentationInput): CreditBatchRepresentation {
  return creditBatchRepresentationSchema.parse({
    id: row.id, code: row.code, version: row.version, facilityId: row.facilityId, feedstockTypeId: row.feedstockTypeId,
    status: row.status, sampling: row.sampling, startDate: row.startDate, endDate: row.endDate,
    archivedAt: row.archivedAt === null ? null : instant(row.archivedAt),
    createdAt: instant(row.createdAt), updatedAt: instant(row.updatedAt),
  });
}
