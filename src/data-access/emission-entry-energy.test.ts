import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { loadFacilityEmissionEntryFlows } from "./emission-entry-energy";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { requireOrgFacility } from "./utils";

const mocks = vi.hoisted(() => ({ where: vi.fn(), select: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("./utils", () => ({ requireOrgScope: vi.fn(), requireOrgFacility: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getLatestTemplateObservation: vi.fn() }));
vi.mock("./emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: vi.fn() }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: vi.fn(() => true) }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(true);
  mocks.where.mockResolvedValue([]);
  mocks.select.mockReturnValue({ from: () => ({ where: mocks.where }) });
});
it("performs no entry query with the flag off", async () => {
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(false);
  expect(await loadFacilityEmissionEntryFlows(makeTestOrgContext(), "facility")).toEqual([]);
  expect(mocks.select).not.toHaveBeenCalled();
});
it("filters the facility's batches by organization and archive state", async () => {
  const ctx = makeTestOrgContext();
  expect(await loadFacilityEmissionEntryFlows(ctx, "facility")).toEqual([]);
  expect(requireOrgFacility).toHaveBeenCalledWith(ctx, "facility");
  const predicate = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
  expect(predicate.sql).toContain('"credit_batches"."organization_id" =');
  expect(predicate.sql).toContain('"credit_batches"."facility_id" =');
  expect(predicate.sql).toContain('"credit_batches"."archived_at" is null');
  expect(predicate.params).toEqual([ctx.organizationId, "facility"]);
});
