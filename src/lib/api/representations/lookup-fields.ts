import { z } from "zod";

export const lookupFields = {
  id: z.uuid().describe("Resource identifier, UUID."),
  code: z.string().describe("Exact human-readable code, unique within the organization."),
  name: z.string().describe("Human-readable display name, plain text."),
  archivedAt: z.iso.datetime().nullable().describe("Archive event instant in UTC (RFC 3339), or null when active or archiving is unsupported."),
  createdAt: z.iso.datetime().describe("Creation event instant in UTC (RFC 3339)."),
  updatedAt: z.iso.datetime().describe("Last update event instant in UTC (RFC 3339)."),
};
export const lookupVersion = z.number().int().positive().describe("Positive integer row version for concurrency checks.");
export const lookupFacilityId = z.uuid().describe("Owning facility identifier, UUID.");

type Instant = Date | string;
export type LookupRepresentationInput<T> = Omit<T, "createdAt" | "updatedAt" | "archivedAt"> & {
  createdAt: Instant; updatedAt: Instant; archivedAt?: Instant | null;
};

export function lookupInstants(row: { createdAt: Instant; updatedAt: Instant; archivedAt?: Instant | null }) {
  return {
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
    archivedAt: row.archivedAt == null ? null : new Date(row.archivedAt).toISOString(),
  };
}
