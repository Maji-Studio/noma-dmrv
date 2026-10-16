import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatCalendarDate } from "@/lib/format-utils";
import { enrichStorageLocationRows, type BaseStorageLocationRow } from "./storage-location-enrichment";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Client } = await import("pg");
  const client = new Client();
  client.query = query;
  return { db: drizzle(client) };
});
vi.mock("./output-stock", () => ({ getOutputBinStocks: async () => new Map() }));
vi.mock("./lane-stock-derivation", () => ({ deriveLaneStock: async () => [] }));

const APPLIED_DAY = "2026-07-06";
const row: BaseStorageLocationRow = {
  id: "product-bin",
  organizationId: "calendar-day-org",
  code: "PB-DAY",
  name: "Product bin",
  type: "product_bin",
  facilityId: "calendar-day-facility",
  formulationId: null,
  feedstockTypeId: null,
  capacityKg: null,
  storageMethod: null,
  storageDescription: null,
  stockMode: "mix",
  drawOrder: "oldest_first",
  archivedAt: null,
  createdAt: new Date("2026-07-06T00:00:00.000Z"),
  updatedAt: new Date("2026-07-06T00:00:00.000Z"),
  version: 1,
  facilityCode: "FAC-DAY",
  facilityName: "Calendar day facility",
  feedstockTypeName: null,
  formulationName: null,
};

describe("last-applied calendar day decoding", () => {
  const originalTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "Europe/Zurich";
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it.each([`${APPLIED_DAY} 00:00:00`, null])("preserves the raw driver value %s through enrichment", async (lastAppliedAt) => {
    // Exercise Drizzle's real result mapper with node-postgres's zone-less value.
    query.mockImplementation(async (config: { text: string }) => ({
      rows: config.text.includes("MAX(")
        ? [[row.id, 1, 0, lastAppliedAt]]
        : [],
    }));
    const [bin] = await enrichStorageLocationRows({
      organizationId: row.organizationId,
      userId: "calendar-day-user",
      orgRole: "owner",
      isPlatformAdmin: false,
    }, [row]);

    if (lastAppliedAt === null) {
      expect(bin.productInventory.lastAppliedAt).toBeNull();
    } else {
      expect(formatCalendarDate(bin.productInventory.lastAppliedAt)).toBe("Jul 6, 2026");
      expect(bin.productInventory.lastAppliedAt?.toISOString()).toBe(`${APPLIED_DAY}T00:00:00.000Z`);
    }
  });
});
