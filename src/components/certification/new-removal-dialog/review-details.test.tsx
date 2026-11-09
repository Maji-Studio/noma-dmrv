import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { durabilityParts, FactsLine } from "./review-details";

describe("durabilityParts", () => {
  it("splits one tier from its method", () => {
    expect(durabilityParts(["1000-year (R₀ reflectance)"])).toEqual({ text: "1000-year durability", hint: "Measured by R₀ reflectance." });
  });

  it("calls two tiers a mix and lists them behind the (i)", () => {
    expect(durabilityParts(["1000-year (R₀ reflectance)", "200-year (H:Corg)"])).toEqual({
      text: "Mixed durability",
      hint: "1000-year (R₀ reflectance), 200-year (H:Corg)",
    });
  });
});

describe("FactsLine", () => {
  it("reads mixed durability and sampling plainly", () => {
    const html = renderToStaticMarkup(
      <FactsLine facts={{ durabilityTiers: ["1000-year (R₀ reflectance)", "200-year (H:Corg)"], samplingLabel: "Some credit batches sampled" }} />,
    );
    expect(html).toContain("Mixed durability");
    expect(html).toContain("Some credit batches sampled");
    expect(html).not.toContain("Not sampled");
  });
});
