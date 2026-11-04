import { describe, expect, it } from "vitest";
import { automaticSourceAvailable, catalogSourceForRole } from "./catalog-sources";

describe("catalogSourceForRole", () => {
  it.each([
    ["Generator diesel usage", "run-genset-diesel"],
    ["Startup diesel usage", "run-startup-diesel"],
    ["Other diesel usage", undefined],
    [undefined, undefined],
  ])("resolves the declared diesel component %s", (name, expected) => {
    expect(catalogSourceForRole("fuel_usage_by_volume", "volume_of_fuel", "pyrolysis", name)).toBe(expected);
  });

  it("limits the safety-margin carve-out to its declared display name", () => {
    expect(catalogSourceForRole("mass_based_ci_emissions", "mass", "miscellaneous", "Safety margin")).toBe("safety-margin");
    expect(catalogSourceForRole("mass_based_ci_emissions", "mass", "miscellaneous", "Other overhead")).toBeUndefined();
    expect(catalogSourceForRole("mass_based_ci_emissions", "mass", "miscellaneous")).toBeUndefined();
  });

  it("does not turn an ordinary named transport component into safety margin", () => {
    expect(catalogSourceForRole("mass_distance_based_ci_emissions", "mass_distance", "biomass-feedstock-transport", "Truck")).toBe("feedstock-transport");
    expect(catalogSourceForRole("fuel_usage_by_volume", "volume_of_fuel", "biochar-storage")).toBeUndefined();
    expect(catalogSourceForRole("unknown", "mass_distance", "biomass-feedstock-transport")).toBeUndefined();
  });

  it("preserves the retired source ID so runtime availability can exclude it", () => {
    const source = catalogSourceForRole("mass_distance_based_ci_emissions", "mass_distance", "sampling-required-for-mrv");
    expect(source).toBe("sample-transport");
    expect(automaticSourceAvailable(source!)).toBe(false);
    expect(automaticSourceAvailable("feedstock-transport")).toBe(true);
  });
});
