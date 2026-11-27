import { beforeEach, expect, it, vi } from "vitest";
import type { EmissionContributor } from "./credit-batch-emission-contributors";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { buildProductionSourceManifest, loadProductionSourceManifest } from "./production-source-manifest";
import { loadBatchEmissionContributors } from "./credit-batch-emission-contributors";
import { getFeedstockTransportOwners } from "./feedstock-transport-ownership";
import { getTransportFeedstockCountedRemovals } from "./certification-lineage-guards";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./credit-batch-emission-contributors", () => ({ loadBatchEmissionContributors: vi.fn() }));
vi.mock("./feedstock-transport-ownership", () => ({ getFeedstockTransportOwners: vi.fn() }));
vi.mock("./certification-lineage-guards", () => ({ getTransportFeedstockCountedRemovals: vi.fn() }));
const ctx = makeTestOrgContext();
const contributor = (runId: string): EmissionContributor => ({ runId, version: 1, facilityId: "facility",
  endDay: "2026-03-01", feedstockTypeId: "type", feedstockIds: ["own", "counted", "other"],
  creditBatchId: "batch", creditBatchCode: "CB-1", kind: "failed", unresolvedReason: null });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFeedstockTransportOwners).mockResolvedValue(new Map([["own", "a"], ["counted", "z"], ["other", "material"]]));
  vi.mocked(getTransportFeedstockCountedRemovals).mockResolvedValue(new Map([["counted", new Set(["other-removal"])]]));
});

it("builds the same manifest from preloaded context contributors and batch IDs", async () => {
  const contributors = [contributor("z"), contributor("a")];
  vi.mocked(loadBatchEmissionContributors).mockResolvedValue({ batch: { materialMembers: [], failedContributors: contributors } });
  const reader = {} as Parameters<typeof loadProductionSourceManifest>[2];
  const context = await buildProductionSourceManifest(ctx, contributors, reader, "removal");
  expect(await loadProductionSourceManifest(ctx, ["batch"], reader, "removal")).toEqual(context);
  expect(context.failedContributors.map(run => run.runId)).toEqual(["a", "z"]);
  expect(context.countedTransportFeedstockIds).toEqual(["own"]);
  expect(contributors.map(run => run.runId)).toEqual(["z", "a"]);
  expect(loadBatchEmissionContributors).toHaveBeenCalledExactlyOnceWith(ctx, ["batch"], reader, { failedOnly: true });
  expect(getTransportFeedstockCountedRemovals).toHaveBeenCalledWith(ctx, ["own", "counted"], reader);
});
