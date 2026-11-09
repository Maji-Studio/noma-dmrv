import { beforeEach, expect, it, vi } from "vitest";
import { loadRemovalRecords } from "./removal-records";
import { getCreditBatchesByRemovalId } from "./certifier-removals";
import { getCreditBatchChainData } from "./chain-of-custody-batch";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

vi.mock("./certifier-removals", () => ({ getCreditBatchesByRemovalId: vi.fn() }));
vi.mock("./chain-of-custody-batch", () => ({ getCreditBatchChainData: vi.fn() }));

const ctx = makeTestOrgContext();
const lineage = (code: string) => ({
  applicationId: code,
  chain: {
    application: { id: code, code, applicationDate: "2026-03-01", fieldIdentifier: "Field", biocharAppliedDryTons: 1 },
    delivery: { id: `d-${code}`, code: `D-${code}`, deliveryDate: "2026-02-20", massDryKg: 1000, deliveredWetMassKg: null },
  },
});
const chainFor = (removalId?: string) => ({
  batch: { id: "cb-1", code: "CB-1", startDate: "2026-01-01", endDate: "2026-03-31" },
  lineages: [lineage(removalId === "rem-a" ? "APP-A" : "APP-B")],
  rollForwards: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([{ id: "cb-1" }] as never);
  vi.mocked(getCreditBatchChainData).mockImplementation((async (_ctx: unknown, _id: string, options?: { removalId?: string }) => chainFor(options?.removalId)) as never);
});

it("lists only this Removal's slice of a batch split across two Removals", async () => {
  const [a] = await loadRemovalRecords(ctx, "rem-a");
  const [b] = await loadRemovalRecords(ctx, "rem-b");
  expect(a?.applications.map((r) => r.code)).toEqual(["APP-A"]);
  expect(b?.applications.map((r) => r.code)).toEqual(["APP-B"]);
  expect(getCreditBatchChainData).toHaveBeenCalledWith(ctx, "cb-1", { removalId: "rem-a" });
});
