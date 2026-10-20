import { describe, expect, it, vi } from "vitest";
import { parseRetirementOptions, runSampleTransportRetirement, selectSampleTransportRetirementCandidates } from "./retire-sample-transport-core";

const candidate = { id: "leg-a", organizationId: "org", entityType: "sample", version: 2, documentIds: ["document"] };

describe("sample transport retirement", () => {
  it("requires an explicit organization, defaults to dry-run and rejects unknown flags", () => {
    expect(parseRetirementOptions(["--organization-id", "org"])).toEqual({ organizationId: "org", delete: false });
    expect(parseRetirementOptions(["--organization-id", "org", "--delete"]).delete).toBe(true);
    expect(() => parseRetirementOptions([])).toThrow();
    expect(() => parseRetirementOptions(["--organization-id", "org", "--force"])).toThrow();
  });
  it("selects only this org's sample legs, including derived legs, in unique id order", () => {
    expect(selectSampleTransportRetirementCandidates("org", [
      { ...candidate, id: "leg-b" }, candidate, candidate,
      { ...candidate, organizationId: "other" },
      { ...candidate, entityType: "feedstock" }, { ...candidate, entityType: "biochar" },
    ])).toEqual([candidate, { ...candidate, id: "leg-b" }]);
  });
  it("never deletes on dry-run and can repeat deletion after the selection is empty", async () => {
    const list = vi.fn().mockResolvedValue([candidate]);
    const remove = vi.fn().mockResolvedValue(true);
    const log = vi.fn();
    const dependencies = { list, remove, log };
    expect(await runSampleTransportRetirement({ organizationId: "org", delete: false }, dependencies)).toEqual({ legCount: 1, documentCount: 1, deletedLegCount: 0 });
    expect(remove).not.toHaveBeenCalled();
    expect(await runSampleTransportRetirement({ organizationId: "org", delete: true }, dependencies)).toMatchObject({ deletedLegCount: 1 });
    expect(remove).toHaveBeenCalledWith(candidate.id, candidate.version);
    list.mockResolvedValue([]);
    expect(await runSampleTransportRetirement({ organizationId: "org", delete: true }, dependencies)).toEqual({ legCount: 0, documentCount: 0, deletedLegCount: 0 });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toEqual({ organizationId: "org", legIds: ["leg-a"], documentIds: ["document"], legCount: 1, documentCount: 1, deletedLegCount: 0 });
  });
});
