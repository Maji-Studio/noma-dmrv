import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { FormSection, FormSpine } from "@/components/forms";
import { SampleNutrientFields } from "./sample-nutrient-fields";

function NutrientSpineHarness() {
  const { control, register } = useForm();

  return (
    <FormSpine control={control}>
      <FormSection title="Stability ratios">
        <span>Previous section</span>
      </FormSection>
      <SampleNutrientFields
        enabled={false}
        isSubmitting={false}
        enabledRegistration={register("nutrientClaimEnabled")}
        phosphorus={{ registration: register("phosphorusPercent") }}
        potassium={{ registration: register("potassiumPercent") }}
        magnesium={{ registration: register("magnesiumPercent") }}
        calcium={{ registration: register("calciumPercent") }}
        iron={{ registration: register("ironPercent") }}
      />
    </FormSpine>
  );
}

describe("SampleNutrientFields spine integration", () => {
  it("joins the numbered spine without a standalone divider", () => {
    const html = renderToStaticMarkup(<NutrientSpineHarness />);

    expect(html).toContain(">2</span>");
    expect(html).not.toContain(
      "border-t border-[var(--color-border-tertiary)] pt-16",
    );
  });
});
