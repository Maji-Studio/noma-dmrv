import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { feedstocks, samples } from "@/db/schema";
import {
  cleanupLabSampleFixture,
  createLabSampleFixture,
  type LabSampleFixture,
} from "./helpers/lab-sample-fixture";
import { getFeedstocks } from "@/data-access/feedstocks";
import { getSamples } from "@/data-access/samples";

const PAGE_SIZE = 2;
const SAME_DATE = new Date("2026-09-15T12:00:00.000Z");
const EARLIER_DATE = new Date("2026-09-14T12:00:00.000Z");
const LATER_DATE = new Date("2026-09-16T12:00:00.000Z");
const WET_MASS_KG = 100;
const DRY_MASS_KG = 90;
const CARBON_PERCENT = 80;
const ORGANIC_CARBON_PERCENT = 78;
// Neither insertion order nor code order follows the primary date order.
const SEEDS = [
  { suffix: "003", date: SAME_DATE },
  { suffix: "001", date: SAME_DATE },
  { suffix: "004", date: SAME_DATE },
  { suffix: "002", date: SAME_DATE },
  { suffix: "000", date: LATER_DATE },
  { suffix: "999", date: EARLIER_DATE },
];
const DATE_DESCENDING = ["000", "004", "003", "002", "001", "999"];
const DATE_ASCENDING = [...DATE_DESCENDING].reverse();
const CODE_DESCENDING = ["999", "004", "003", "002", "001", "000"];
const DATE_SORTS = [
  { label: "default date descending", sortBy: undefined, sortOrder: undefined },
  { label: "date ascending", sortBy: undefined, sortOrder: "asc" },
  { label: "createdAt descending", sortBy: "createdAt", sortOrder: "desc" },
  { label: "createdAt ascending", sortBy: "createdAt", sortOrder: "asc" },
  { label: "updatedAt descending", sortBy: "updatedAt", sortOrder: "desc" },
  { label: "updatedAt ascending", sortBy: "updatedAt", sortOrder: "asc" },
] as const;

type Row = { id: string; code: string };
type Page = { items: Row[]; total: number; totalPages: number };
let fixture: LabSampleFixture;
let feedstockRows: Row[];
let sampleRows: Row[];
let feedstockPrefix: string;
let samplePrefix: string;

beforeAll(async () => {
  fixture = await createLabSampleFixture({ withSecondBatch: false });
  feedstockPrefix = `E2E-DATE-FS-${fixture.tag}-`;
  samplePrefix = `E2E-DATE-SAM-${fixture.tag}-`;
  const organizationId = fixture.ctx.organizationId;
  const [intake] = await db.select().from(feedstocks).where(and(
    eq(feedstocks.organizationId, organizationId),
    eq(feedstocks.facilityId, fixture.facility.id),
  ));
  // Reuse the fixture's valid intake parents, with no additional stock draws.
  feedstockRows = await db.insert(feedstocks).values(SEEDS.map(({ suffix, date }) => ({
    ...intake,
    organizationId,
    id: randomUUID(),
    code: `${feedstockPrefix}${suffix}`,
    deliveryDate: date,
    createdAt: date,
    updatedAt: date,
    massWetKg: WET_MASS_KG,
    massDryKg: DRY_MASS_KG,
  }))).returning({ id: feedstocks.id, code: feedstocks.code });
  sampleRows = await db.insert(samples).values(SEEDS.map(({ suffix, date }) => ({
    organizationId,
    creditBatchId: fixture.batchA.id,
    sampleCode: `${samplePrefix}${suffix}`,
    samplingTime: date,
    createdAt: date,
    updatedAt: date,
    totalCarbonPercent: CARBON_PERCENT,
    organicCarbonPercent: ORGANIC_CARBON_PERCENT,
  }))).returning({ id: samples.id, code: samples.sampleCode });
});

afterAll(async () => {
  if (fixture) await cleanupLabSampleFixture(fixture);
});

async function expectStablePages(
  readPage: (page: number) => Promise<Page>,
  seededRows: Row[],
  prefix: string,
  expectedSuffixes: readonly string[],
) {
  const expectedCodes = expectedSuffixes.map(suffix => `${prefix}${suffix}`);
  const totalPages = Math.ceil(seededRows.length / PAGE_SIZE);
  const seen: Row[] = [];
  for (let page = 1; page <= totalPages; page++) {
    const result = await readPage(page);
    expect(result.total).toBe(seededRows.length);
    expect(result.totalPages).toBe(totalPages);
    expect(result.items).toHaveLength(PAGE_SIZE);
    expect(result.items.map(row => row.code)).toEqual(
      expectedCodes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    );
    seen.push(...result.items);
  }
  expect(seen.map(row => row.code)).toEqual(expectedCodes);
  expect(new Set(seen.map(row => row.id)).size).toBe(seededRows.length);
  expect(seen.map(row => row.id).sort()).toEqual(seededRows.map(row => row.id).sort());
  expect((await readPage(totalPages + 1)).items).toEqual([]);
}

describe("feedstock date ordering with PostgreSQL", () => {
  it.each(DATE_SORTS)("pages every intake exactly once: $label", async ({ sortBy, sortOrder }) => {
    await expectStablePages(page => getFeedstocks(fixture.ctx, {
      facilityId: fixture.facility.id,
      search: feedstockPrefix,
      page,
      pageSize: PAGE_SIZE,
      sortBy,
      sortOrder,
    }), feedstockRows, feedstockPrefix, sortOrder === "asc" ? DATE_ASCENDING : DATE_DESCENDING);
  });

  it("appends code order after a user-chosen non-date sort", async () => {
    await expectStablePages(page => getFeedstocks(fixture.ctx, {
      search: feedstockPrefix, page, pageSize: PAGE_SIZE, sortBy: "massDryKg", sortOrder: "desc",
    }), feedstockRows, feedstockPrefix, CODE_DESCENDING);
  });
});

describe("sample date ordering with PostgreSQL", () => {
  async function readPage(page: number, sortBy?: "createdAt" | "updatedAt" | "totalCarbonPercent", sortOrder?: "asc" | "desc"): Promise<Page> {
    const result = await getSamples(fixture.ctx, {
      creditBatchId: fixture.batchA.id,
      search: samplePrefix,
      page,
      pageSize: PAGE_SIZE,
      sortBy,
      sortOrder,
    });
    return { ...result, items: result.items.map(row => ({ id: row.id, code: row.sampleCode })) };
  }

  it.each(DATE_SORTS)("pages every sample exactly once: $label", async ({ sortBy, sortOrder }) => {
    await expectStablePages(page => readPage(page, sortBy, sortOrder), sampleRows, samplePrefix,
      sortOrder === "asc" ? DATE_ASCENDING : DATE_DESCENDING);
  });

  it("appends code order after a user-chosen non-date sort", async () => {
    await expectStablePages(page => readPage(page, "totalCarbonPercent", "desc"), sampleRows, samplePrefix, CODE_DESCENDING);
  });
});
