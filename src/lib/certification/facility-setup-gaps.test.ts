import { describe, expect, it } from "vitest";
import { deriveFacilitySetupGaps } from "./facility-setup-gaps";

const COMPLETE = {
  hasOrgCredentials: true,
  mapping: { id: "map_1" },
  defaultTemplate: { id: "rvt_1" },
  missingDefaultTemplateId: null,
  unresolvedBlueprintKeys: [] as string[],
};

describe("deriveFacilitySetupGaps", () => {
  it("returns no gaps for a fully configured facility", () => {
    expect(deriveFacilitySetupGaps(COMPLETE)).toEqual([]);
  });

  it("reports only the project link when the facility is unlinked", () => {
    expect(
      deriveFacilitySetupGaps({
        ...COMPLETE,
        mapping: null,
        defaultTemplate: null,
      }),
    ).toEqual([{ kind: "project_link" }]);
  });

  it("reports missing credentials on a linked facility without org credentials", () => {
    expect(
      deriveFacilitySetupGaps({
        ...COMPLETE,
        hasOrgCredentials: false,
        defaultTemplate: null,
      }),
    ).toEqual([{ kind: "credentials" }]);
  });

  it("reports an unset default template", () => {
    expect(
      deriveFacilitySetupGaps({ ...COMPLETE, defaultTemplate: null }),
    ).toEqual([{ kind: "default_template" }]);
  });

  it("reports a configured template that no longer resolves, with its id", () => {
    expect(
      deriveFacilitySetupGaps({
        ...COMPLETE,
        defaultTemplate: null,
        missingDefaultTemplateId: "rvt_gone",
      }),
    ).toEqual([{ kind: "template_resolution", templateId: "rvt_gone" }]);
  });

  it("reports unresolved blueprint keys on an otherwise-linked facility — never the link/template instruction", () => {
    const gaps = deriveFacilitySetupGaps({
      ...COMPLETE,
      unresolvedBlueprintKeys: ["biochar_soil", "transport_leg"],
    });
    expect(gaps).toEqual([
      { kind: "blueprint_keys", keys: ["biochar_soil", "transport_leg"] },
    ]);
  });
});
