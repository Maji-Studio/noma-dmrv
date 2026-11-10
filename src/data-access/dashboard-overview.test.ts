import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { OrgContext } from "@/lib/auth/server";
import { getDashboardAttentionItems, getDashboardOverview, KPI_HINTS } from "./dashboard-overview";
import { ATTENTION_PER_CHECK } from "./dashboard-attention";
import { EXACT_ID_FILTER_MAX } from "@/lib/exact-id-filter";
import type { RemovalAttentionRows } from "@/lib/certification/removal-attention";
import { REMOVAL_INTERRUPTED_ATTENTION_TITLE } from "@/lib/certification/removal-attention";
import { CHANGED_SINCE_REVIEW_LABEL } from "@/lib/certification/interrupted-removal-copy";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  previews: vi.fn(),
  union: vi.fn(async (): Promise<unknown[]> => []),
  returned: vi.fn(async (): Promise<Set<string>> => new Set()),
  changedAttempts: vi.fn(async (): Promise<Set<string>> => new Set()),
}));
vi.mock("./removal-latest-attempt", () => ({ getRemovalIdsWithChangedLatestAttempt: mocks.changedAttempts }));
vi.mock("./dashboard-returned-removals", () => ({ loadReturnedRemovalIds: mocks.returned }));
// Batch rows carry already-derived Removal displays in these tests.
vi.mock("./credit-batch-removal-display", () => ({
  batchRemovalDisplayFactsSql: () => sql`'[]'::jsonb`,
  removalDisplayFromFacts: (removal: unknown) => removal,
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
  mocks.changedAttempts.mockClear();
  mocks.changedAttempts.mockResolvedValue(new Set());
  mocks.union.mockResolvedValue([]);
  mocks.returned.mockResolvedValue(new Set());
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

// #1532 F5: a check past its cap folds into one grouped row, and "N open"
// counts records, so every counted record is reachable from a row.
describe("needs attention rows", () => {
  const TODAY = "2026-11-03";
  const idsOf = (n: number) => Array.from({ length: n }, (_, index) => `run-${index}`);
  const runRows = (ids: string[]) => ids.slice(0, ATTENTION_PER_CHECK).map((id, index) => ({
    kind: "run-mass", id, code: `PR-${index}`, dateDay: DAY, dateMs: null, ord: index + 1,
    // The branch is capped in SQL; its window count and id list carry the rest.
    total: ids.length, allIds: ids, removals: [],
  }));
  const feedstockRows = Array.from({ length: ATTENTION_PER_CHECK }, (_, index) => ({
    kind: "feedstock-missing", id: `fs-${index}`, code: `FS-${index}`, dateDay: null, dateMs: 0, ord: index + 1,
    total: ATTENTION_PER_CHECK, allIds: [], removals: [],
  }));
  const batchRows = (n: number) => Array.from({ length: n }, (_, index) => ({
    kind: "batch-pending", id: `cb-${index}`, code: `CB-${index}`, dateDay: "2026-09-30", dateMs: null, ord: index + 1,
    total: n, allIds: [], removals: [],
  }));

  it("groups an over-cap check into one row linking to its filtered list", async () => {
    const runIds = idsOf(ATTENTION_PER_CHECK + 1);
    mocks.union.mockResolvedValue([...runRows(runIds), ...feedstockRows, ...batchRows(ATTENTION_PER_CHECK + 1)]);

    const { items, batches } = await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY);

    const runs = new URLSearchParams({ facility: FACILITY_ID, ids: runIds.join(",") });
    expect(items.map(({ entityCode, count, title, href }) => ({ entityCode, count, title, href }))).toEqual([
      { entityCode: "Production runs", count: runIds.length, title: "Complete runs missing mass data", href: `/production-runs?${runs.toString()}` },
      ...feedstockRows.map((row) => ({
        entityCode: row.code, count: undefined, title: "Feedstock record missing data", href: expect.stringContaining(`feedstock=${row.id}`),
      })),
      {
        entityCode: "Credit batches",
        count: ATTENTION_PER_CHECK + 1,
        title: "Period ended, not submitted yet",
        href: `/credit-batches?facility=${FACILITY_ID}`,
      },
    ]);
    expect(items.find((item) => item.id === "run-mass-group")?.recordIds).toEqual(runIds);
    expect(items.find((item) => item.id === "run-mass-group")?.recordItems?.map((item) => item.recordIds?.[0])).toEqual(runIds.slice(0, ATTENTION_PER_CHECK));
    expect(items.find((item) => item.id === "batch-not-submitted-group")?.recordIds).toEqual(batchRows(ATTENTION_PER_CHECK + 1).map((row) => row.id));
    expect(batches).toEqual({ interrupted: 0, notSubmitted: ATTENTION_PER_CHECK + 1, returned: 0 });
  });

  it.each(["run-mass", "feedstock-missing", "application-evidence"])("carries every %s id even beyond the SQL row cap", async (kind) => {
    const ids = idsOf(ATTENTION_PER_CHECK + 2);
    mocks.union.mockResolvedValue(runRows(ids).map((row) => ({ ...row, kind })));
    const { items } = await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY);
    expect(items).toHaveLength(1);
    expect(items[0].recordIds).toEqual(ids);
    expect(items[0].count).toBe(ids.length);
  });

  it("carries ids for grouped interrupted Removals and returned credit batches", async () => {
    const records = batchRows(ATTENTION_PER_CHECK + 1);
    const interrupted = records.map((row, index) => ({
      ...row, id: `interrupted-${index}`,
      removals: [{ id: `rm-${index}`, code: `RM-${index}`, ghgStatementId: null, status: { kind: "interrupted" }, phase: "draft" }],
    }));
    const returned = records.map((row, index) => ({
      ...row, removals: [{ id: `back-${index}`, code: `RM-BACK-${index}`, ghgStatementId: "gs", status: { kind: "submitted" }, phase: "submitted" }],
    }));
    mocks.union.mockResolvedValue([...interrupted, ...returned]);
    mocks.returned.mockResolvedValue(new Set(returned.map((row) => row.removals[0].id)));
    const { items } = await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY);
    expect(mocks.changedAttempts).toHaveBeenCalledExactlyOnceWith(CTX, interrupted.map((row) => row.removals[0].id));
    expect(items.find((item) => item.id === "removal-interrupted-group")?.recordIds).toEqual(interrupted.map((row) => row.removals[0].id));
    expect(items.find((item) => item.id === "batch-returned-group")?.recordIds).toEqual(returned.map((row) => row.id));
  });

  it("keeps a batch whose submitted Removal came back, and leaves out one awaiting verification", async () => {
    const submittedBatch = (id: string, removalId: string) => ({
      kind: "batch-pending", id, code: id.toUpperCase(), dateDay: "2026-09-30", dateMs: null, ord: 1, total: 2, allIds: [],
      removals: [{ id: removalId, code: `RM-${removalId}`, ghgStatementId: `gs-${removalId}`, status: { kind: "submitted" }, phase: "submitted" }],
    });
    mocks.union.mockResolvedValue([submittedBatch("cb-back", "rm-back"), submittedBatch("cb-wait", "rm-wait")]);
    mocks.returned.mockResolvedValue(new Set(["rm-back"]));

    const { items, batches } = await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY);

    // The Removals the attention query read go straight to the lineage read.
    expect(mocks.returned).toHaveBeenCalledWith(CTX, [
      { removalId: "rm-back", ghgStatementId: "gs-rm-back" },
      { removalId: "rm-wait", ghgStatementId: "gs-rm-wait" },
    ]);
    expect(items.map(({ entityCode, title }) => ({ entityCode, title }))).toEqual([
      { entityCode: "CB-BACK", title: "Returned by Isometric" },
    ]);
    expect(batches).toEqual({ interrupted: 0, notSubmitted: 0, returned: 1 });
  });

  it("opens the plain list when the group has more records than the id filter takes", async () => {
    mocks.union.mockResolvedValue(runRows(idsOf(EXACT_ID_FILTER_MAX + 1)));
    const { items } = await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY);
    expect(items).toEqual([expect.objectContaining({ recordIds: idsOf(EXACT_ID_FILTER_MAX + 1), count: EXACT_ID_FILTER_MAX + 1, href: `/production-runs?facility=${FACILITY_ID}` })]);
  });

  it("counts records as N open: single rows, grouped counts and GPS gaps", async () => {
    const runIds = idsOf(ATTENTION_PER_CHECK + 3);
    mocks.union.mockResolvedValue([...runRows(runIds), ...feedstockRows]);
    const overview = await getDashboardOverview(CTX, FACILITY_ID, "month");
    expect(overview.attention).toHaveLength(1 + ATTENTION_PER_CHECK);
    expect(overview.attentionTotal).toBe(runIds.length + ATTENTION_PER_CHECK);
  });

  describe("Removal rows from the read model", () => {
    const row = (removalId: string, title: string) => ({ id: `removal-draft-${removalId}`, recordIds: [removalId], entityCode: `RM-${removalId}`, date: null, title, href: `/removals?removal=${removalId}` });
    const rows = (over: Partial<RemovalAttentionRows>): Promise<RemovalAttentionRows> =>
      Promise.resolve({ drafts: [], rejected: [], returned: [], covered: new Set<string>(), ...over });
    const interruptedBatch = {
      kind: "batch-pending", id: "cb-i", code: "CB-I", dateDay: "2026-09-30", dateMs: null, ord: 1, total: 1, allIds: [],
      removals: [{ id: "rm-i", code: "RM-I", ghgStatementId: null, status: { kind: "interrupted" }, phase: "draft" }],
    };

    it.each([
      { outcome: "latest changed summary", changed: true },
      { outcome: "later failure superseding changed", changed: false },
      { outcome: "no attempt summary", changed: false },
    ])("routes the interrupted outcome: $outcome", async ({ changed }) => {
      mocks.changedAttempts.mockResolvedValue(new Set(changed ? ["rm-i"] : []));
      mocks.union.mockResolvedValue([interruptedBatch, { ...interruptedBatch, id: "cb-2", code: "CB-2" }]);
      const { items } = await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY);
      expect(mocks.changedAttempts).toHaveBeenCalledExactlyOnceWith(CTX, ["rm-i"]);
      expect(items).toContainEqual(expect.objectContaining({
        id: "removal-interrupted-rm-i", entityCode: "RM-I · CB-I · CB-2",
        title: changed ? CHANGED_SINCE_REVIEW_LABEL : REMOVAL_INTERRUPTED_ATTENTION_TITLE,
        href: `/removals?facility=${FACILITY_ID}&${changed ? "removal" : "resume"}=rm-i`,
      }));
    });

    it("passes no ids to the attempt lookup when no Removal is interrupted", async () => {
      mocks.union.mockResolvedValue([{
        ...interruptedBatch,
        removals: [{ ...interruptedBatch.removals[0], status: { kind: "submitted" }, phase: "submitted" }],
      }]);
      await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY);
      expect(mocks.changedAttempts).toHaveBeenCalledExactlyOnceWith(CTX, []);
    });

    it("puts draft rows after the interrupted rows, groups them past the cap, and counts every Removal", async () => {
      mocks.union.mockResolvedValue([interruptedBatch, ...runRows(["run-0"])]);
      const drafts = Array.from({ length: ATTENTION_PER_CHECK + 1 }, (_, index) => row(`d${index}`, "Ready to submit"));
      const overview = await getDashboardOverview(CTX, FACILITY_ID, "month", rows({ drafts }));
      expect(overview.attention.map((item) => item.id)).toEqual(["removal-interrupted-rm-i", "removal-draft-group", "run-mass-run-0"]);
      expect(overview.attention[1]).toMatchObject({ count: ATTENTION_PER_CHECK + 1, title: "Draft Removals", recordIds: drafts.flatMap((row) => row.recordIds) });
      expect(overview.attentionTotal).toBe(1 + ATTENTION_PER_CHECK + 1 + 1);
    });

    it("carries every id for grouped rejected and returned Removal rows", async () => {
      const rejected = Array.from({ length: ATTENTION_PER_CHECK + 1 }, (_, index) => row(`x${index}`, "Submission failed"));
      const returned = rejected.map((item, index) => ({ removalId: `back${index}`, item: { ...item, recordIds: [`back${index}`] } }));
      const { items } = await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY, rows({ rejected, returned }));
      expect(items.find((item) => item.id === "removal-rejected-group")?.recordIds).toEqual(rejected.flatMap((item) => item.recordIds));
      expect(items.find((item) => item.id === "removal-returned-group")?.recordIds).toEqual(returned.map((item) => item.removalId));
    });

    it("lists a few draft and rejected Removals one row each", async () => {
      const overview = await getDashboardOverview(CTX, FACILITY_ID, "month", rows({ drafts: [row("d", "2 to fix")], rejected: [row("x", "Submission failed")] }));
      expect(overview.attention.map((item) => item.title)).toEqual(["2 to fix", "Submission failed"]);
      expect(overview.attentionTotal).toBe(2);
    });

    it("drops the not-submitted credit batch row a draft Removal row already covers, and still counts the batch", async () => {
      const closedBatch = {
        kind: "batch-pending", id: "cb-d", code: "CB-D", dateDay: "2026-09-30", dateMs: null, ord: 1, total: 1, allIds: [],
        removals: [{ id: "rm-d", code: "RM-D", ghgStatementId: null, status: { kind: "not-submitted" }, phase: "draft" }],
      };
      mocks.union.mockResolvedValue([closedBatch]);
      const { items, batches } = await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY, rows({ drafts: [row("d", "2 to fix")], covered: new Set(["rm-d"]) }));
      expect(items.map((item) => item.title)).toEqual(["2 to fix"]);
      expect(batches.notSubmitted).toBe(1);
    });

    it("shows a returned Removal as one row and drops the credit batch rows it replaces", async () => {
      const submittedBatch = (id: string) => ({
        kind: "batch-pending", id, code: id.toUpperCase(), dateDay: "2026-09-30", dateMs: null, ord: 1, total: 2, allIds: [],
        removals: [{ id: "rm-back", code: "RM-BACK", ghgStatementId: "gs", status: { kind: "submitted" }, phase: "submitted" }],
      });
      mocks.union.mockResolvedValue([submittedBatch("cb-1"), submittedBatch("cb-2")]);
      mocks.returned.mockResolvedValue(new Set(["rm-back"]));
      const returned = [{ removalId: "rm-back", item: { ...row("back", "Resubmit needed"), id: "removal-returned-rm-back" } }];
      const { items, batches } = await getDashboardAttentionItems(CTX, FACILITY_ID, TODAY, rows({ returned }));
      expect(items.map((item) => item.title)).toEqual(["Resubmit needed"]);
      // The Production station still counts the batches that came back.
      expect(batches.returned).toBe(2);
    });
  });
});
