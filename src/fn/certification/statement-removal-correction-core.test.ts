import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { getSentRemovalForComparison, listStatementRemovalExternalIds, listStatementRemovalIdentities } from "@/data-access/removal-entry-correction";
import { getCreditBatchesByRemovalId } from "@/data-access/certifier-removals";
import { getLatestTemplateObservation, getTemplateObservationById } from "@/data-access/removal-template-observations";
import { compileRemovalCorrectionContent } from "./removal-correction-core";
import { assertStatementRemovalsCurrent } from "./statement-removal-correction-core";
import { SafeError } from "@/lib/errors";

vi.mock("@/data-access/removal-entry-correction", () => ({ getSentRemovalForComparison: vi.fn(), listStatementRemovalExternalIds: vi.fn(), listStatementRemovalIdentities: vi.fn() }));
vi.mock("@/data-access/certifier-removals", () => ({ getCreditBatchesByRemovalId: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ getLatestTemplateObservation: vi.fn(), getTemplateObservationById: vi.fn() }));
vi.mock("./removal-correction-core", () => ({ compileRemovalCorrectionContent: vi.fn(),
  loadRemovalEntryCorrection: vi.fn(() => { throw new Error("Display eligibility must not authorize submission"); }) }));
const ctx = makeTestOrgContext();
const semantic = { inputs: [{ rtcId: "energy", value: 12 }] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listStatementRemovalIdentities).mockResolvedValue([{ id: "removal", code: "R-12" }]);
  vi.mocked(listStatementRemovalExternalIds).mockResolvedValue([{ externalId: "remote" }]);
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { templateObservationId: "observation", semantic } } as never);
  vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([{ id: "batch", removalTemplateId: "template" }] as never);
  const observation = { definition: { groups: [{ components: [{ id: "energy" }] }] } };
  vi.mocked(getLatestTemplateObservation).mockResolvedValue(observation as never);
  vi.mocked(getTemplateObservationById).mockResolvedValue(observation as never);
  vi.mocked(compileRemovalCorrectionContent).mockResolvedValue(semantic);
});
it("compares sent content independently of a missing or failed correction contender", async () => {
  vi.mocked(compileRemovalCorrectionContent).mockResolvedValue({ inputs: [{ rtcId: "energy", value: 23 }] });
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toEqual(
    new SafeError("Resubmit Removal R-12 first. Its records changed since it was sent."));
  expect(compileRemovalCorrectionContent).toHaveBeenCalledWith(ctx, "removal", expect.any(Object), true);
});
it("allows unchanged content after resubmission even when the window is closed", async () => {
  await expect(assertStatementRemovalsCurrent(ctx, "statement", ["remote"])).resolves.toBeUndefined();
});
it.each(["missing-attempt", "missing-snapshot", "missing-observation", "missing-sent-observation", "invalid-compile", "failed-compile"])("refuses an unverifiable member: %s", async reason => {
  if (reason === "missing-attempt") vi.mocked(getSentRemovalForComparison).mockResolvedValue(null);
  if (reason === "missing-snapshot") vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: null } as never);
  if (reason === "missing-observation") vi.mocked(getLatestTemplateObservation).mockResolvedValue(null);
  if (reason === "missing-sent-observation") vi.mocked(getTemplateObservationById).mockResolvedValue(null);
  if (reason === "invalid-compile") vi.mocked(compileRemovalCorrectionContent).mockResolvedValue(null);
  if (reason === "failed-compile") vi.mocked(compileRemovalCorrectionContent).mockRejectedValue(new Error("Compile failed"));
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toEqual(
    new SafeError("Check Removal R-12 again before resubmitting the GHG Statement."));
});
it("refuses unknown remote membership before compiling or mutating", async () => {
  await expect(assertStatementRemovalsCurrent(ctx, "statement", ["remote", "unknown"])).rejects.toThrow(
    "This GHG Statement has Removals noma does not know about. Sync it, then try again.");
  expect(compileRemovalCorrectionContent).not.toHaveBeenCalled();
});
it("skips remote membership checking when no remote statement exists", async () => {
  await assertStatementRemovalsCurrent(ctx, "statement");
  expect(listStatementRemovalExternalIds).not.toHaveBeenCalled();
});
it("lists every changed Removal, excluding unchanged members", async () => {
  vi.mocked(listStatementRemovalIdentities).mockResolvedValue([{ id: "a", code: "R-12" }, { id: "b", code: "R-13" }, { id: "c", code: "R-14" }]);
  vi.mocked(compileRemovalCorrectionContent).mockImplementation(async (_ctx, id) => id === "b" ? semantic : { inputs: [{ rtcId: "energy", value: 23 }] });
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toThrow("Resubmit Removals R-12, R-14 first.");
});
