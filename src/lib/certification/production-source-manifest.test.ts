import { expect, it } from "vitest";
import { readProductionSourceManifest, claimingFailedEmissionRuns, productionSourceManifestsEqual, PRODUCTION_SOURCE_MANIFEST_VERSION } from "./production-source-manifest";
import type { RemovalSubmissionContext } from "./certify-context-types";

it("keeps historical manifests unknown and rejects malformed recorded manifests", () => {
  expect(readProductionSourceManifest({ semantic: {} })).toBeNull();
  expect(() => readProductionSourceManifest({ productionSourceManifest: { version: 2, failedContributors: [] } })).toThrow("invalid production source manifest");
  const snapshot = { productionSourceManifest: { version: 1, failedContributors: [] } };
  const original = structuredClone(snapshot);
  expect(readProductionSourceManifest(snapshot)).toEqual(snapshot.productionSourceManifest);
  expect(snapshot).toEqual(original);
});

it("refuses failed inputs without an attachment manifest", () => {
  expect(() => claimingFailedEmissionRuns({ memberBatchClaims: [], failedEmissionRuns: [{ id: "failed", status: "failed" }] } as unknown as RemovalSubmissionContext, "removal")).toThrow("no source manifest");
});


it("compares source identity, versions, attachment and counted transport independently of totals", () => {
  const manifest = readProductionSourceManifest({ productionSourceManifest: {
    version: 1, failedContributors: [{ runId: "run", version: 1, facilityId: "facility",
      endDay: "2026-03-01", feedstockTypeId: "type", feedstockIds: ["stock-a", "stock-b"],
      creditBatchId: "batch", creditBatchCode: "CB-1", kind: "failed", unresolvedReason: null,
    }], countedTransportFeedstockIds: ["stock-a", "stock-b"],
  } })!;
  const reordered = structuredClone(manifest);
  reordered.failedContributors[0].feedstockIds.reverse();
  reordered.countedTransportFeedstockIds!.reverse();
  expect(productionSourceManifestsEqual(manifest, reordered)).toBe(true);
  for (const field of ["runId", "facilityId", "creditBatchId", "feedstockTypeId"] as const) {
    const changed = structuredClone(manifest);
    changed.failedContributors[0][field] = "changed";
    expect(productionSourceManifestsEqual(manifest, changed)).toBe(false);
  }
  const revision = structuredClone(manifest);
  revision.failedContributors[0].version += 1;
  expect(productionSourceManifestsEqual(manifest, revision)).toBe(false);
  expect(productionSourceManifestsEqual(manifest, { ...manifest, countedTransportFeedstockIds: ["stock-b"] })).toBe(false);
  expect(productionSourceManifestsEqual(null, manifest)).toBe(false);
});

it("uses the schema version and treats an empty manifest as absent", () => {
  const empty = readProductionSourceManifest({ productionSourceManifest: {
    version: PRODUCTION_SOURCE_MANIFEST_VERSION, failedContributors: [], countedTransportFeedstockIds: [],
  } });
  expect(empty?.version).toBe(PRODUCTION_SOURCE_MANIFEST_VERSION);
  expect(productionSourceManifestsEqual(null, empty)).toBe(true);
});
