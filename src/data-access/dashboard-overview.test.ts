import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { OrgContext } from "@/lib/auth/server";
import { getDashboardOverview, KPI_HINTS } from "./dashboard-overview";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  previews: vi.fn(),
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
  unionAll: async () => [],
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
