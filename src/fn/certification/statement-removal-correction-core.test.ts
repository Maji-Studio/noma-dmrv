import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { getSentRemovalForComparison, listNomaSentRemovalsForRemoteEntries, listStatementRemovalIdentities } from "@/data-access/removal-entry-correction";
import { getCreditBatchesByRemovalId } from "@/data-access/certifier-removals";
import { getLatestTemplateObservation, getTemplateObservationById } from "@/data-access/removal-template-observations";
import { compileRemovalCorrectionContent } from "./removal-correction-compile-core";
import { assertStatementRemovalsCurrent } from "./statement-removal-correction-core";
import { loadBatchEmissionEntryFacts } from "@/data-access/emission-entry-facts";
import { logger } from "@/lib/log";
import { SafeError } from "@/lib/errors";

vi.mock("@/data-access/removal-entry-correction", () => ({ getSentRemovalForComparison: vi.fn(), listNomaSentRemovalsForRemoteEntries: vi.fn(), listStatementRemovalIdentities: vi.fn() }));
vi.mock("@/data-access/certifier-removals", () => ({ getCreditBatchesByRemovalId: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ getLatestTemplateObservation: vi.fn(), getTemplateObservationById: vi.fn() }));
vi.mock("@/data-access/emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: vi.fn(async () => ({ previousObservations: new Map() })) }));
vi.mock("./removal-correction-compile-core", () => ({ compileRemovalCorrectionContent: vi.fn() }));
vi.mock("./removal-correction-core", () => ({
  loadRemovalEntryCorrection: vi.fn(() => { throw new Error("Display eligibility must not authorize submission"); }) }));
vi.mock("@/lib/log", () => ({ logger: { warn: vi.fn() } }));
const ctx = makeTestOrgContext();
const semantic = { inputs: [{ rtcId: "energy", value: 12 }] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listStatementRemovalIdentities).mockResolvedValue([{ id: "removal", code: "R-12" }]);
  vi.mocked(listNomaSentRemovalsForRemoteEntries).mockResolvedValue([{ id: "removal", code: "R-12", ghgStatementId: "statement" }]);
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
  expect(compileRemovalCorrectionContent).toHaveBeenCalledWith(ctx, "removal", expect.any(Object));
});
it("allows unchanged content after resubmission even when the window is closed", async () => {
  vi.mocked(loadBatchEmissionEntryFacts).mockRejectedValue(new SafeError("Presentation facts unavailable"));
  await expect(assertStatementRemovalsCurrent(ctx, "statement", ["remote"])).resolves.toBeUndefined();
  expect(loadBatchEmissionEntryFacts).not.toHaveBeenCalled();
});
it.each(["missing-attempt", "missing-snapshot", "missing-observation", "invalid-compile", "failed-compile"])("refuses an unverifiable member: %s", async reason => {
  if (reason === "missing-attempt") vi.mocked(getSentRemovalForComparison).mockResolvedValue(null);
  if (reason === "missing-snapshot") vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: null } as never);
  if (reason === "missing-observation") vi.mocked(getTemplateObservationById).mockResolvedValue(null);
  if (reason === "invalid-compile") vi.mocked(compileRemovalCorrectionContent).mockResolvedValue(null);
  if (reason === "failed-compile") vi.mocked(compileRemovalCorrectionContent).mockRejectedValue(new SafeError("Compile failed"));
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toEqual(
    new SafeError("noma could not compare Removal R-12 with what it sent, so the GHG Statement was not sent. Open Removal R-12, then try again."));
});
it.each(["elsewhere", null])("refuses a noma-sent Removal linked to %s before compiling", async ghgStatementId => {
  vi.mocked(listNomaSentRemovalsForRemoteEntries).mockResolvedValue([{ id: "removal", code: "R-12", ghgStatementId }]);
  await expect(assertStatementRemovalsCurrent(ctx, "statement", ["remote"])).rejects.toThrow(
    "Removal R-12 is in this GHG Statement at Isometric but not in noma yet. Use Sync from registry on the GHG Statements page, then try again.");
  expect(compileRemovalCorrectionContent).not.toHaveBeenCalled();
});
it("ignores registry-only entries alongside correctly linked local members", async () => {
  await expect(assertStatementRemovalsCurrent(ctx, "statement", ["remote", "rmv_registry_only"])).resolves.toBeUndefined();
  expect(listNomaSentRemovalsForRemoteEntries).toHaveBeenCalledWith(ctx, "statement", ["remote", "rmv_registry_only"]);
});
it("allows a statement containing only registry-only entries", async () => {
  vi.mocked(listNomaSentRemovalsForRemoteEntries).mockResolvedValue([]);
  vi.mocked(listStatementRemovalIdentities).mockResolvedValue([]);
  await expect(assertStatementRemovalsCurrent(ctx, "statement", ["rmv_registry_only"])).resolves.toBeUndefined();
});
it("lists all noma-sent Removals missing from the local statement", async () => {
  vi.mocked(listNomaSentRemovalsForRemoteEntries).mockResolvedValue([
    { id: "b", code: "R-13", ghgStatementId: null }, { id: "a", code: "R-12", ghgStatementId: "elsewhere" },
  ]);
  await expect(assertStatementRemovalsCurrent(ctx, "statement", ["a", "b"])).rejects.toThrow(
    "Removals R-12, R-13 are in this GHG Statement at Isometric but not in noma yet. Use Sync from registry on the GHG Statements page, then try again.");
});
it("skips remote membership checking when no remote statement exists", async () => {
  await assertStatementRemovalsCurrent(ctx, "statement");
  expect(listNomaSentRemovalsForRemoteEntries).not.toHaveBeenCalled();
});
it("lists every changed Removal, excluding unchanged members", async () => {
  vi.mocked(listStatementRemovalIdentities).mockResolvedValue([{ id: "a", code: "R-12" }, { id: "b", code: "R-13" }, { id: "c", code: "R-14" }]);
  vi.mocked(compileRemovalCorrectionContent).mockImplementation(async (_ctx, id) => id === "b" ? semantic : { inputs: [{ rtcId: "energy", value: 23 }] });
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toThrow("Resubmit Removals R-12, R-14 first.");
});

it("checks membership but skips member compilation on a first submission", async () => {
  await assertStatementRemovalsCurrent(ctx, "statement", ["remote"], false);
  expect(listNomaSentRemovalsForRemoteEntries).toHaveBeenCalledWith(ctx, "statement", ["remote"]);
  expect(listStatementRemovalIdentities).not.toHaveBeenCalled();
  expect(compileRemovalCorrectionContent).not.toHaveBeenCalled();
});
it("still refuses an unlinked noma-sent Removal on a first submission", async () => {
  vi.mocked(listNomaSentRemovalsForRemoteEntries).mockResolvedValue([{ id: "removal", code: "R-12", ghgStatementId: null }]);
  await expect(assertStatementRemovalsCurrent(ctx, "statement", ["unknown"], false)).rejects.toThrow("Use Sync from registry");
  expect(compileRemovalCorrectionContent).not.toHaveBeenCalled();
});
it("compares a legacy sent snapshot without a template observation id", async () => {
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic } } as never);
  await expect(assertStatementRemovalsCurrent(ctx, "statement", ["remote"], true)).resolves.toBeUndefined();
  expect(compileRemovalCorrectionContent).toHaveBeenCalled();
});
it.each(["database", "compiler"])("logs and rethrows an unexpected %s error without exposing its contents", async source => {
  const cause = new Error("Sensitive infrastructure details");
  if (source === "database") vi.mocked(getSentRemovalForComparison).mockRejectedValue(cause);
  else vi.mocked(compileRemovalCorrectionContent).mockRejectedValue(cause);
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toBe(cause);
  expect(logger.warn).toHaveBeenCalledWith({ removalId: "removal", statementId: "statement", reason: "unexpected_error" },
    "GHG Statement member comparison failed");
});
it("logs expected comparison failures and names all affected Removals", async () => {
  vi.mocked(listStatementRemovalIdentities).mockResolvedValue([{ id: "a", code: "R-12" }, { id: "b", code: "R-13" }]);
  vi.mocked(getTemplateObservationById).mockResolvedValue(null);
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toThrow(
    "noma could not compare Removals R-12, R-13 with what it sent, so the GHG Statement was not sent. Open Removals R-12, R-13, then try again.");
  expect(logger.warn).toHaveBeenCalledWith({ removalId: "a", statementId: "statement", reason: "missing_observation" },
    "GHG Statement member comparison failed");
});
