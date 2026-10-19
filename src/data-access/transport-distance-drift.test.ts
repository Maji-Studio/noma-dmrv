import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { getTransportDistanceDrift } from "./transport-distance-drift";

vi.mock("./certification-lineage-guards", () => ({ getCertifiedLineage: async () => [], isSubmittedLineageRow: () => false }));
vi.mock("./delivery-allocation-provenance", () => ({ deliveryProductAllocations: () => ({ deliveryId: "delivery", biocharProductId: "product" }) }));

it("reports drift for a legacy zero delivery override", async () => {
  const row = { distanceKmOverride: 0, recordedDistanceKm: 42, currentDistanceKm: 55 };
  const reads = [[row], []];
  const query = {
    from: () => query, innerJoin: () => query, leftJoin: () => query,
    where: async () => reads.shift(),
  };
  const tx = { select: () => query } as unknown as DbTransaction;
  const ctx = { organizationId: "org", userId: "actor", orgRole: "owner" as const, isPlatformAdmin: false };
  expect(await getTransportDistanceDrift(ctx, { entityType: "delivery", entityId: "delivery" }, tx))
    .toMatchObject({ isOverridden: false, hasDrift: true });
});
