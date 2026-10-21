import { expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { loadRemovalEntryCorrection } from "./removal-entry-correction";
import { getCreditBatchesByRemovalId } from "./certifier-removals";
import { listEmissionEntryDraftContenders } from "./emission-entry-contenders";
vi.mock("./certifier-removals", () => ({ getCreditBatchesByRemovalId: vi.fn() }));
vi.mock("./emission-entry-contenders", () => ({ listEmissionEntryDraftContenders: vi.fn(), loadEmissionEntryReservations: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: () => {
  const query = { from: () => query, where: () => query, orderBy: () => query, limit: async () => [] };
  return query;
} } }));
it("returns before batch, template or statement reads for a Removal that was never submitted", async () => {
  expect(await loadRemovalEntryCorrection(makeTestOrgContext(), "draft")).toMatchObject({ correctionNeeded: false });
  expect(getCreditBatchesByRemovalId).not.toHaveBeenCalled();
  expect(listEmissionEntryDraftContenders).not.toHaveBeenCalled();
});
