import { renderToStaticMarkup } from "react-dom/server";
import { useForm, type Control, type FieldValues } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { FormDetailProvider } from "@/components/forms/form-detail-context";
import { IngredientMassSplit } from "./ingredient-mass-split";

function Harness({ frozen = false, massDryKg }: { frozen?: boolean; massDryKg?: number }) {
  const form = useForm({
    defaultValues: {
      ingredientBins: [{ massKg: 240, moistureContentPercent: 20.8333333333, massDryKg, storageLocationId: "bin-compost" }],
    },
  });
  return (
    <IngredientMassSplit
      control={form.control as unknown as Control<FieldValues>}
      index={0}
      feedstockTypeName="Compost"
      frozen={frozen}
    />
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("IngredientMassSplit", () => {
  it("splits the ingredient into its solids and water at the entered moisture", () => {
    const html = renderToStaticMarkup(<Harness />);
    expect(text(html)).toContain("Compost solids 190 kg");
    expect(text(html)).toContain("Water 50 kg");
  });

  it("splits a frozen allocation against its saved dry snapshot", () => {
    const html = renderToStaticMarkup(<Harness frozen massDryKg={200} />);
    expect(text(html)).toContain("Compost solids 200 kg");
    expect(text(html)).toContain("Water 40 kg");
  });

  it("offers the bin history in Detailed only", () => {
    const simple = renderToStaticMarkup(<FormDetailProvider scope="s"><Harness /></FormDetailProvider>);
    expect(simple).not.toContain("Stock history");
    const detailed = renderToStaticMarkup(<Harness />);
    expect(detailed).toContain('aria-label="Stock history, Compost bin"');
  });
});
