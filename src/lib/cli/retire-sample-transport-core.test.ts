import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
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
    expect(await runSampleTransportRetirement({ organizationId: "org", delete: false }, dependencies)).toEqual({ legCount: 1, documentCount: 1, deletedLegCount: 0, skippedLegIds: [] });
    expect(remove).not.toHaveBeenCalled();
    expect(await runSampleTransportRetirement({ organizationId: "org", delete: true }, dependencies)).toMatchObject({ deletedLegCount: 1 });
    expect(remove).toHaveBeenCalledWith(candidate.id, candidate.version);
    expect(log).toHaveBeenCalledWith({ deletedLegId: candidate.id });
    list.mockResolvedValue([]);
    expect(await runSampleTransportRetirement({ organizationId: "org", delete: true }, dependencies)).toEqual({ legCount: 0, documentCount: 0, deletedLegCount: 0, skippedLegIds: [] });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toEqual({ organizationId: "org", legIds: ["leg-a"], documentIds: ["document"], legCount: 1, documentCount: 1, deletedLegCount: 0, skippedLegIds: [] });
  });

  it("skips a sent-locked first leg and still deletes the next candidate", async () => {
    const remove = vi.fn().mockRejectedValueOnce(new DomainError("certification_locked", "Held by a Removal.")).mockResolvedValueOnce(true);
    const log = vi.fn();
    const result = await runSampleTransportRetirement({ organizationId: "org", delete: true }, {
      list: async () => [candidate, { ...candidate, id: "leg-b" }], remove, log,
    });
    expect(remove.mock.calls).toEqual([["leg-a", candidate.version], ["leg-b", candidate.version]]);
    expect(result).toEqual({ legCount: 2, documentCount: 1, deletedLegCount: 1, skippedLegIds: ["leg-a"] });
    expect(log).toHaveBeenCalledWith({ deletedLegId: "leg-b" });
    expect(log).toHaveBeenLastCalledWith({ organizationId: "org", legIds: ["leg-a", "leg-b"], documentIds: ["document"],
      legCount: 2, documentCount: 1, deletedLegCount: 1, skippedLegIds: ["leg-a"] });
  });

  it.each([new Error("unexpected failure"), new DomainError("conflict", "Try again."), { code: "certification_locked" }])(
    "keeps other failures fatal and logs prior deletions", async (error) => {
      const remove = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(error);
      const log = vi.fn();
      await expect(runSampleTransportRetirement({ organizationId: "org", delete: true }, {
        list: async () => [candidate, { ...candidate, id: "leg-b" }, { ...candidate, id: "leg-c" }], remove, log,
      })).rejects.toBe(error);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenLastCalledWith({ deletedLegId: "leg-a" });
    },
  );
});
