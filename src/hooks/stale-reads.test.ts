import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { activityKeys } from "./activity-query-keys";
import { certificationKeys } from "./certification-query-keys";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { recordLockKeys } from "./record-lock-query-keys";
import { invalidateCertificationReadiness, invalidateEmissionEntryReads } from "./stale-reads";
import { dashboardOverviewKeys } from "./use-dashboard-overview";
import { energyKeys } from "./use-energy";

const scope = { facilityId: "facility", creditBatchId: "batch" };

const readinessReads: QueryKey[] = [
  creditBatchKeys.emissionAllocation({ creditBatchId: "batch" }),
  creditBatchKeys.details(),
  creditBatchKeys.timelineFacts("facility", ["batch"]),
  activityKeys.creditBatchSummary("batch"),
  certificationKeys.overview("facility"),
  certificationKeys.removalPreflight("facility", "removal"),
  dashboardOverviewKeys.overview("facility", "30d" as never),
];
const previews = creditBatchKeys.previews(["batch"]);
const unrelated: QueryKey[] = [
  creditBatchKeys.list({ facilityId: "facility" }),
  recordLockKeys.all,
  ["suppliers", "list"],
];

let client: QueryClient;

function seed(keys: QueryKey[]) {
  for (const key of keys) client.setQueryData(key, { cached: true });
}
const invalidated = (key: QueryKey) => client.getQueryState(key)?.isInvalidated === true;

beforeEach(() => {
  client = new QueryClient();
});

describe("invalidateCertificationReadiness", () => {
  it("refreshes readiness reads and leaves unrelated reads and previews alone", async () => {
    seed([...readinessReads, previews, ...unrelated]);
    await invalidateCertificationReadiness(client);
    for (const key of readinessReads) expect(invalidated(key)).toBe(true);
    for (const key of [previews, ...unrelated]) expect(invalidated(key)).toBe(false);
  });

  it("also refreshes CO2e previews when asked", async () => {
    seed([...readinessReads, previews, ...unrelated]);
    await invalidateCertificationReadiness(client, { creditBatchPreviews: true });
    for (const key of [...readinessReads, previews]) expect(invalidated(key)).toBe(true);
    for (const key of unrelated) expect(invalidated(key)).toBe(false);
  });
});

describe("invalidateEmissionEntryReads", () => {
  it("refreshes the lines, overview, energy page and readiness reads only", async () => {
    const entryReads = [
      creditBatchKeys.emissionLines("facility", "batch"),
      creditBatchKeys.emissionsOverview("facility"),
      energyKeys.breakdown({ facilityId: "facility", from: "2026-01-01", to: "2026-01-31" } as never),
      ...readinessReads,
    ];
    const otherBatchLines = creditBatchKeys.emissionLines("facility", "other-batch");
    seed([...entryReads, otherBatchLines, previews, ...unrelated]);
    await invalidateEmissionEntryReads(client, scope);
    for (const key of entryReads) expect(invalidated(key)).toBe(true);
    for (const key of [otherBatchLines, previews, ...unrelated]) expect(invalidated(key)).toBe(false);
  });
});
