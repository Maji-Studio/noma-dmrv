import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { loadRemovalEntryCorrection } from "@/fn/certification/removal-correction-core";
import { compareRemovalCurrentContent } from "@/fn/certification/removal-content-comparison-core";
import { deriveRemovalSemanticCorrection } from "@/lib/certification/removal-semantic-correction";
import { getCreditBatchesByRemovalId } from "./certifier-removals";
import { listEmissionEntryDraftContenders } from "./emission-entry-contenders";
vi.mock("@/fn/certification/removal-content-comparison-core", () => ({ compareRemovalCurrentContent: vi.fn() }));
vi.mock("./certifier-removals", () => ({ getCreditBatchesByRemovalId: vi.fn() }));
vi.mock("./emission-entry-contenders", () => ({ listEmissionEntryDraftContenders: vi.fn() }));
const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/data-access/emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: vi.fn() }));
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
    vi.mocked(compareRemovalCurrentContent).mockResolvedValue({ kind: "unavailable", reason: "compile_refused", unavailableMessages: [], components: [],
      state: deriveRemovalSemanticCorrection({ windowOpen: true, previous: {}, current: null,
        previousEntries: [], currentEntries: [], componentIds: [], batchIds: ["batch"] }) });
    const result = await loadRemovalEntryCorrection(makeTestOrgContext(), "removal", [{
      removalId: "removal", contenderKind: "correction", createdAt: "2026-04-01", creditBatchIds: ["batch"],
      window: { start: "2026-04-01", end: "2026-06-30" }, returnedStatement: { id: "statement", status: "FAILED_VERIFICATION" },
    }]);
    expect(compareRemovalCurrentContent).toHaveBeenCalledExactlyOnceWith(makeTestOrgContext(), "removal", expect.objectContaining({
      submitted: { payloadSnapshot: { semantic: { entryContributions: [] } } },
      batches: [{ id: "batch", code: "CB-001", removalTemplateId: "template" }],
    }));
    expect(result.correctionNeeded).toBe(true);
    expect(result.correction?.statement).toEqual({ id: "statement", status: "FAILED_VERIFICATION",
      reportingPeriodStartOn: "2026-04-01", reportingPeriodEndOn: "2026-06-30" });
  },
);
