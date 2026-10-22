import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { listStatementRemovalIdentities } from "@/data-access/removal-entry-correction";
import { loadRemovalEntryCorrection } from "./removal-correction-core";
import { assertStatementRemovalsCurrent } from "./statement-removal-correction-core";
import { deriveEntryCorrection } from "@/lib/certification/removal-entry-correction";
import { SafeError } from "@/lib/errors";

vi.mock("@/data-access/removal-entry-correction", () => ({ listStatementRemovalIdentities: vi.fn() }));
vi.mock("./removal-correction-core", () => ({ loadRemovalEntryCorrection: vi.fn() }));
const ctx = makeTestOrgContext();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listStatementRemovalIdentities).mockResolvedValue([{ id: "removal", code: "R-12" }]);
});
it("refuses with a safe domain message naming the changed Removal", async () => {
  vi.mocked(loadRemovalEntryCorrection).mockResolvedValue({ ...deriveEntryCorrection(true, [], []), correctionNeeded: true });
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toEqual(
    new SafeError("Resubmit Removal R-12 first. Its records changed since it was sent."));
  expect(listStatementRemovalIdentities).toHaveBeenCalledWith(ctx, "statement");
});
it("allows a statement after its member has been resubmitted and relocked", async () => {
  vi.mocked(loadRemovalEntryCorrection).mockResolvedValue(deriveEntryCorrection(false, [], []));
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).resolves.toBeUndefined();
});
it("lists every changed Removal, excluding unchanged members", async () => {
  vi.mocked(listStatementRemovalIdentities).mockResolvedValue([{ id: "a", code: "R-12" }, { id: "b", code: "R-13" }, { id: "c", code: "R-14" }]);
  vi.mocked(loadRemovalEntryCorrection).mockImplementation(async (_ctx, id) => ({ ...deriveEntryCorrection(true, [], []), correctionNeeded: id !== "b" }));
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toThrow("Resubmit Removals R-12, R-14 first.");
});
