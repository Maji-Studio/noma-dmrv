/**
 * Fields required only in a certain state carry the star in that state: the five
 * nutrient shares once nutrient claims are enabled, and the over-allocation
 * justification, which appears only when a delivery is over-allocated.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SampleNutrientFields } from "@/components/samples/sample-nutrient-fields";
import { WetMassWarning } from "@/components/feedstocks/wet-mass-warning";

const REQUIRED_MARKER = '<span class="sr-only">Required</span>';
const registration = { name: "n", onChange: async () => undefined, onBlur: async () => undefined, ref: () => undefined };
const nutrient = { registration };

describe("conditionally required markers", () => {
  const render = (enabled: boolean) => renderToStaticMarkup(
    <SampleNutrientFields enabled={enabled} isSubmitting={false} enabledRegistration={registration}
      phosphorus={nutrient} potassium={nutrient} magnesium={nutrient} calcium={nutrient} iron={nutrient} />,
  );

  it("stars the five nutrient shares only while nutrient claims are enabled", () => {
    expect(render(false)).not.toContain(REQUIRED_MARKER);
    expect(render(true).split(REQUIRED_MARKER)).toHaveLength(6);
  });

  it("stars the over-allocation justification", () => {
    const markup = renderToStaticMarkup(<WetMassWarning allocatedKg={120} deliveredKg={100} justificationRegister={registration} />);
    expect(markup).toContain(REQUIRED_MARKER);
  });
});
