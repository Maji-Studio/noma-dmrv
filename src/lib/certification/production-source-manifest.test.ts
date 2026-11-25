import { expect, it } from "vitest";
import { readProductionSourceManifest, claimingFailedEmissionRuns } from "./production-source-manifest";
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
