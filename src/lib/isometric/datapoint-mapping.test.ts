import { describe, expect, it } from "vitest";
import { componentRenameGuidance, lookupInputMapping, resolveDatapointSource } from "./datapoint-mapping";

const diesel = lookupInputMapping("pyrolysis", "fuel_usage_by_volume", "volume_of_fuel")!;
const safety = lookupInputMapping("miscellaneous", "mass_based_ci_emissions", "mass")!;

describe("component rename guidance", () => {
  it("uses the same canonical names and copy in the builder", () => {
    const guidance = componentRenameGuidance(diesel);
    expect(guidance).toBe('Rename it in Isometric to one of these names: "Generator diesel usage", "Startup diesel usage".');
    expect(() => resolveDatapointSource(diesel, "Unknown component")).toThrow(`The pyrolysis diesel component is not recognized. ${guidance}`);
  });

  it("handles singular names, plurals and exhausted names", () => {
    expect(componentRenameGuidance(safety)).toBe('Rename it in Isometric to "Safety margin".');
    expect(componentRenameGuidance(diesel, { count: 2 })).toBe('Rename each one in Isometric to one of these names: "Generator diesel usage", "Startup diesel usage".');
    expect(componentRenameGuidance(safety, { count: 2 })).toBeUndefined();
    expect(componentRenameGuidance(safety, { takenNames: [" SAFETY MARGIN "] })).toBeUndefined();
    expect(componentRenameGuidance(diesel, { takenNames: ["Startup diesel usage"] })).toBe('Rename it in Isometric to "Generator diesel usage".');
  });
});
