import { describe, expect, it } from "vitest";
import { lookupInputMapping, lookupPeriodInputTuple, resolveDatapointSource } from "./datapoint-mapping";
import type { LineContract } from "./template-observations/line-sources";

const diesel = lookupInputMapping("pyrolysis", "fuel_usage_by_volume", "volume_of_fuel")!;
const operating: LineContract = { scope: "operating", entryPolicy: "additive", origin: "reviewed" };
describe("contract source lookup", () => {
  it("selects each diesel source by contract and fails closed without one", () => {
    expect(resolveDatapointSource(diesel, { ...operating, automaticSource: "run-genset-diesel" })).toBe("totalGensetDieselLitres");
    expect(resolveDatapointSource(diesel, { ...operating, automaticSource: "run-startup-diesel" })).toBe("totalStartupDieselLitres");
    expect(() => resolveDatapointSource(diesel)).toThrow("Review the Removal template lines in Certification settings.");
    expect(() => resolveDatapointSource(diesel, { ...operating, automaticSource: "run-genset-diesel", origin: "proposed" })).toThrow();
  });
  it("releases the safety-margin tuple only with an effective automatic contract", () => {
    const contract: LineContract = { ...operating, automaticSource: "safety-margin" };
    expect(lookupPeriodInputTuple("miscellaneous", "mass_based_ci_emissions", "mass", contract)).toBeUndefined();
    expect(lookupPeriodInputTuple("miscellaneous", "mass_based_ci_emissions", "mass", { ...contract, origin: "proposed" })).toBeDefined();
  });
  it("keeps sequestration's per-input facts", () => {
    const contract: LineContract = { ...operating, entryPolicy: "none", automaticSource: "sequestration" };
    const productMass = lookupInputMapping("co2-stored", "carbon_rich_substance_sequestration", "product_mass", contract)!;
    const carbon = lookupInputMapping("co2-stored", "carbon_rich_substance_sequestration", "carbon_content", contract)!;
    expect(resolveDatapointSource(productMass, contract)).toBe("totalBiocharDryMassKg");
    expect(resolveDatapointSource(carbon, contract)).toBe("weightedOrganicCarbonPercent");
  });
});
