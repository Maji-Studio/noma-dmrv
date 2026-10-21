import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { loadRemovalEntryCorrection } from "./removal-entry-correction";
import { getCreditBatchesByRemovalId } from "./certifier-removals";
import { getLatestTemplateObservation } from "./removal-template-observations";
import { loadBatchEmissionEntryFacts } from "./emission-entry-facts";
import { listEmissionEntryDraftContenders, loadEmissionEntryReservations } from "./emission-entry-contenders";
vi.mock("./certifier-removals", () => ({ getCreditBatchesByRemovalId: vi.fn() }));
vi.mock("./emission-entry-contenders", () => ({ listEmissionEntryDraftContenders: vi.fn(), loadEmissionEntryReservations: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getLatestTemplateObservation: vi.fn(), getTemplateObservationById: vi.fn() }));
vi.mock("./emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: vi.fn() }));
const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
function query(rows: object[]) {
  const builder = { from: () => builder, where: () => builder, orderBy: () => builder,
    innerJoin: () => builder, limit: () => builder,
    then: (resolve: (rows: object[]) => unknown) => Promise.resolve(rows).then(resolve) };
  return builder;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockImplementation(() => query([]));
});
it("returns before batch, template or statement reads for a Removal that was never submitted", async () => {
  expect(await loadRemovalEntryCorrection(makeTestOrgContext(), "draft")).toMatchObject({ correctionNeeded: false });
  expect(getCreditBatchesByRemovalId).not.toHaveBeenCalled();
  expect(listEmissionEntryDraftContenders).not.toHaveBeenCalled();
});

it.each([null, { remotePeriodEndOn: "2026-06-30", remotePeriodEndIsSynthetic: true }])(
  "uses the effective statement period in correction data (metadata=%j)", async (metadata) => {
    mocks.select.mockReturnValueOnce(query([{ payloadSnapshot: { semantic: { entryContributions: [] } } }]))
      .mockReturnValueOnce(query([{ code: "RM-001", reportingPeriodStartOn: "2026-04-01",
        reportingPeriodEndOn: metadata ? "9999-12-31" : "2026-06-30", metadata }]));
    vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([{ id: "batch", code: "CB-001", removalTemplateId: "template" }] as never);
    vi.mocked(getLatestTemplateObservation).mockResolvedValue({ definition: { groups: [] }, lineSources: {}, enrichment: {} } as never);
    vi.mocked(loadBatchEmissionEntryFacts).mockResolvedValue({ entries: [], previousObservations: new Map() });
    vi.mocked(loadEmissionEntryReservations).mockResolvedValue([]);
    const result = await loadRemovalEntryCorrection(makeTestOrgContext(), "removal", [{
      removalId: "removal", contenderKind: "correction", createdAt: "2026-04-01", creditBatchIds: ["batch"],
      window: { start: "2026-04-01", end: "2026-06-30" }, returnedStatement: { id: "statement", status: "FAILED_VERIFICATION" },
    }]);
    expect(result.correction?.statement).toEqual({ id: "statement", status: "FAILED_VERIFICATION",
      reportingPeriodStartOn: "2026-04-01", reportingPeriodEndOn: "2026-06-30" });
  },
);
