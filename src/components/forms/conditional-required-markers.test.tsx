/**
 * Fields required only in a certain state carry the star in that state: the five
 * nutrient shares once nutrient claims are enabled, and the over-allocation
 * justification, which appears only when a delivery is over-allocated.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { IngredientMoistureField } from "@/components/biochar-products/ingredient-moisture-field";
import { ChoiceCardGroup } from "./choice-card-group";
import { SegmentedControl } from "./segmented-control";
import { SampleNutrientFields } from "@/components/samples/sample-nutrient-fields";
import { WetMassWarning } from "@/components/feedstocks/wet-mass-warning";

vi.mock("@/hooks/use-entities", () => ({ useEntityById: () => ({ data: undefined }) }));

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

function Ingredient({ massKg, frozen }: { massKg: number; frozen: boolean }) {
  const { control } = useForm({ defaultValues: { ingredientBins: [{ storageLocationId: "bin", massKg, moistureContentPercent: null }], placedAt: "" } });
  return <IngredientMoistureField control={control as never} index={0} frozen={frozen} disabled={false} />;
}

describe("ingredient moisture marker", () => {
  it("is starred for an open ingredient with mass, not for a frozen one or one with no mass", () => {
    expect(renderToStaticMarkup(<Ingredient massKg={300} frozen={false} />)).toContain(REQUIRED_MARKER);
    expect(renderToStaticMarkup(<Ingredient massKg={300} frozen />)).not.toContain(REQUIRED_MARKER);
    expect(renderToStaticMarkup(<Ingredient massKg={0} frozen={false} />)).not.toContain(REQUIRED_MARKER);
  });
});

describe("fieldset controls carry Required in the legend", () => {
  const options = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  it("adds the screen reader text to the legend of a required control only", () => {
    for (const markup of [
      renderToStaticMarkup(<SegmentedControl legend="Severity" options={options} required />),
      renderToStaticMarkup(<ChoiceCardGroup legend="Stock mode" options={options.map(({ value, label }) => ({ value, title: label }))} required />),
    ]) {
      expect(markup).toMatch(/<legend class="sr-only">[A-Za-z ]+<span class="sr-only">Required<\/span><\/legend>/);
      expect(markup).not.toContain("*");
    }
    expect(renderToStaticMarkup(<SegmentedControl legend="Severity" options={options} />)).not.toContain("Required");
  });
});
