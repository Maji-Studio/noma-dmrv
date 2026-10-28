import { describe, expect, it } from "vitest";
import { templateLineSection, type ComponentType } from "./template-sections";

describe("templateLineSection", () => {
  it.each(["SEQUESTRATION", "REDUCTION"] as ComponentType[])("places %s in Mitigated", (type) => {
    expect(templateLineSection(type, "unknown")).toBe("mitigated");
  });
  it.each(["ACTIVITY", "COUNTERFACTUAL", "LOSS", "ADJUSTMENT", "UNCERTAINTY_DISCOUNT"] as ComponentType[])("places %s in Emitted even for a storage key", (type) => {
    expect(templateLineSection(type, "biochar_sequestration_future")).toBe("emitted");
  });
  it("falls back to the sequestration family only without a blueprint", () => {
    expect(templateLineSection(null, "biochar_sequestration_future")).toBe("mitigated");
    expect(templateLineSection(null, "unknown")).toBe("emitted");
  });
});
