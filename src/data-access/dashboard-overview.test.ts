import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { OrgContext } from "@/lib/auth/server";
import { getDashboardAttentionItems, getDashboardOverview, KPI_HINTS } from "./dashboard-overview";
import { ATTENTION_PER_CHECK } from "./dashboard-attention";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  previews: vi.fn(),
  union: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("./credit-batches", () => ({ getCo2eStoredPreviews: mocks.previews }));
vi.mock("./biochar-products", () => ({
  sourceAllocationAggregate: () => ({
    biocharProductId: sql`product_id`,
    allocatedDryMassKg: sql`allocated_dry_mass_kg`,
  }),
}));
vi.mock("drizzle-orm/pg-core", async (importOriginal) => ({
  ...await importOriginal<typeof import("drizzle-orm/pg-core")>(),
  unionAll: () => mocks.union(),
}));
vi.mock("./dashboard-stations", () => ({
  epochMs: () => sql`0`,
  getDashboardStations: async () => ({ stations: [], overdueBatches: 0 }),
}));
vi.mock("./dashboard-structural-gaps", () => ({
  loadDashboardStructuralGapCounts: async () => ({}),
  buildDashboardStructuralGaps: () => [],
}));

const CTX: OrgContext = {
  userId: "dashboard-test-user",
  organizationId: "dashboard-test-org",
  orgRole: "admin",
  isPlatformAdmin: false,
};
const FACILITY_ID = "dashboard-test-facility";
const DAY = "2026-07-01";
const BLEND_KG = 7_380;
const INGREDIENT_KG = 4_380;
const MOISTURE_PERCENT = 0.6;
const ALLOCATED_DRY_KG = 2_982;
const DERIVED_DRY_KG = 2_982;
const PURE_DRY_KG = 7_335.72;
const KG_PER_TONNE = 1_000;
const PRODUCT = {
  productionDate: DAY,
  massKg: BLEND_KG,
  moistureContentPercent: MOISTURE_PERCENT,
  composition: {},
  sourceAllocatedDryMassKg: null,
};
const COMPOSITION = {
  ingredients: [{
    formulationIngredientId: "ingredient-line",
    feedstockTypeId: "blend-feedstock",
    feedstockTypeName: "Blend ingredient",
    feedstockTypeCategory: "manure",
    massKg: INGREDIENT_KG,
  }],
};

type Row = Record<string, unknown>;
let rowsByTable: Record<string, Row[]>;

beforeEach(() => {
  mocks.union.mockResolvedValue([]);
  rowsByTable = { facilities: [{ timezone: "UTC" }] };
  mocks.previews.mockResolvedValue({});
  // Project only selected columns, so omitting composition or the allocation
  // from the dashboard query also breaks the regression.
  mocks.select.mockImplementation((selection: Record<string, unknown>) => {
    let tableName = "";
    const rows = () => (rowsByTable[tableName] ?? []).map((row) =>
      Object.fromEntries(Object.keys(selection).map((key) => [key, row[key]])),
    );
    const query = {
      from: (table: AnyPgTable) => { tableName = getTableName(table); return query; },
      where: () => query,
      innerJoin: () => query,
      leftJoin: () => query,
      orderBy: () => query,
      limit: () => query,
      then: <T,>(resolve: (value: Row[]) => T) => Promise.resolve(rows()).then(resolve),
    };
    return query;
  });
});

describe("dashboard display totals", () => {
  it.each([
    {
      label: "allocated dry biochar even when blend moisture would disagree",
      product: { ...PRODUCT, composition: COMPOSITION, moistureContentPercent: 20, sourceAllocatedDryMassKg: ALLOCATED_DRY_KG },
      expectedKg: ALLOCATED_DRY_KG,
    },
    {
      label: "source biochar excluding ingredients when no allocation exists",
      product: { ...PRODUCT, composition: COMPOSITION },
      expectedKg: DERIVED_DRY_KG,
    },
    { label: "unchanged pure biochar", product: PRODUCT, expectedKg: PURE_DRY_KG },
    {
      label: "wet source biochar excluding ingredients without moisture or an allocation",
      product: { ...PRODUCT, composition: COMPOSITION, moistureContentPercent: null },
      expectedKg: BLEND_KG - INGREDIENT_KG,
    },
    {
      label: "the existing wet fallback without moisture or an allocation",
      product: { ...PRODUCT, moistureContentPercent: null },
      expectedKg: BLEND_KG,
    },
    {
      label: "allocated dry biochar without moisture",
      product: { ...PRODUCT, moistureContentPercent: null, sourceAllocatedDryMassKg: ALLOCATED_DRY_KG },
      expectedKg: ALLOCATED_DRY_KG,
    },
    {
      label: "a measured zero allocation",
      product: { ...PRODUCT, sourceAllocatedDryMassKg: 0 },
      expectedKg: 0,
    },
  ])("counts $label in the bagged segment", async ({ product, expectedKg }) => {
    rowsByTable.biochar_products = [product];
    const overview = await getDashboardOverview(CTX, FACILITY_ID, "all");
    expect(overview.massFlow.find((segment) => segment.key === "bagged")?.tonnes)
      .toBeCloseTo(expectedKg / KG_PER_TONNE);
  });

  it.each([
    { count: 1, detail: "before project emissions, 1 credit batch" },
    { count: 3, detail: "before project emissions, 3 credit batches" },
    { count: 0, detail: "no credit batch ended in period" },
  ])("qualifies the CO₂e estimate for $count credit batches", async ({ count, detail }) => {
    const batches = Array.from({ length: count }, (_, index) => ({
      id: `batch-${index}`, endDate: DAY,
    }));
    rowsByTable.credit_batches = batches;
    mocks.previews.mockResolvedValue(Object.fromEntries(batches.map(({ id }) => [id, { co2eStoredTonnes: 1 }])));
    const overview = await getDashboardOverview(CTX, FACILITY_ID, "all");
    expect(overview.kpis.find((kpi) => kpi.key === "co2eStored")).toMatchObject({
      value: count || null,
      detail,
    });
  });

  it("keeps the no-estimate reason when a credit batch has no preview", async () => {
    rowsByTable.credit_batches = [{ id: "batch-without-estimate", endDate: DAY }];
    const overview = await getDashboardOverview(CTX, FACILITY_ID, "all");
    expect(overview.kpis.find((kpi) => kpi.key === "co2eStored")).toMatchObject({
      value: null,
      detail: "no estimate in period",
    });
  });

  // #1532 F9: each figure counts by its own date, and the hint says which.
  it("names the date each KPI is counted by", async () => {
    const overview = await getDashboardOverview(CTX, FACILITY_ID, "month");
    const hints = Object.fromEntries(overview.kpis.map((kpi) => [kpi.key, kpi.hint]));
    expect(hints).toEqual(KPI_HINTS);
    expect(hints.feedstockProcessed).toContain("counted on the day each run started");
    expect(hints.biocharProduced).toContain("counted on the day each run started");
    expect(hints.appliedToSoil).toContain("counted on the application date");
    expect(hints.co2eStored).toContain("Counted on the day each batch's period ends");
  });
});

// #1532 F5 round 1: "N open" counts rows, so a check past its cap must fold
// into one grouped row rather than drop the records it cannot show.
describe("needs attention rows", () => {
  const TODAY = "2026-11-03";
  const runIds = Array.from({ length: ATTENTION_PER_CHECK + 2 }, (_, index) => `run-${index}`);
  const runRow = (id: string, ord: number) => ({
    kind: "run-mass", id, code: `PR-${ord}`, dateDay: DAY, dateMs: null, ord,
    total: runIds.length, allIds: runIds, removals: [],
  });
  const feedstockRow = (ord: number) => ({
    kind: "feedstock-missing", id: `fs-${ord}`, code: `FS-${ord}`, dateDay: null, dateMs: 0, ord,
    total: 2, allIds: ["fs-1", "fs-2"], removals: [],
  });
  const batchRow = (ord: number) => ({
    kind: "batch-pending", id: `cb-${ord}`, code: `CB-${ord}`, dateDay: "2026-09-30", dateMs: null, ord,
    total: ATTENTION_PER_CHECK + 1, allIds: [], removals: [],
  });

  it("groups an over-cap check into one row linking to its filtered list", async () => {
    mocks.union.mockResolvedValue([
      // The branch is capped in SQL; its window count and id list carry the rest.
      ...runIds.slice(0, ATTENTION_PER_CHECK).map((id, index) => runRow(id, index + 1)),
      feedstockRow(1),
      feedstockRow(2),
      ...Array.from({ length: ATTENTION_PER_CHECK + 1 }, (_, index) => batchRow(index + 1)),
    ]);

    const { items, batches } = await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY);

    const runs = new URLSearchParams({ facility: FACILITY_ID, ids: runIds.join(",") });
    expect(items.map(({ entityCode, count, title, href }) => ({ entityCode, count, title, href }))).toEqual([
      { entityCode: "Production runs", count: runIds.length, title: "Complete runs missing mass data", href: `/production-runs?${runs.toString()}` },
      { entityCode: "FS-1", count: undefined, title: "Feedstock record missing data", href: expect.stringContaining("feedstock=fs-1") },
      { entityCode: "FS-2", count: undefined, title: "Feedstock record missing data", href: expect.stringContaining("feedstock=fs-2") },
      {
        entityCode: "Credit batches",
        count: ATTENTION_PER_CHECK + 1,
        title: "Period ended · not submitted yet",
        href: `/credit-batches?facility=${FACILITY_ID}`,
      },
    ]);
    expect(batches).toEqual({ interrupted: 0, notSubmitted: ATTENTION_PER_CHECK + 1, awaitingVerification: 0 });
  });

  it("counts the card's rows as N open", async () => {
    mocks.union.mockResolvedValue([
      ...runIds.slice(0, ATTENTION_PER_CHECK).map((id, index) => runRow(id, index + 1)),
      feedstockRow(1),
      feedstockRow(2),
    ]);
    const overview = await getDashboardOverview(CTX, FACILITY_ID, "month");
    expect(overview.attention).toHaveLength(3);
    expect(overview.attentionTotal).toBe(overview.attention.length);
  });
});
