/** Formulation side-sheet view mode: the sections config for EntitySideSheet. */
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { FormulationWithIngredients } from "@/data-access/formulations";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { PERCENT_SCALE } from "@/lib/mass-moisture";
import { PURE_BIOCHAR_CUE } from "./formulation-form";

/** A 0 to 1 share as a whole percentage. */
export function formatRatio(ratio: number | null): string {
  if (ratio === null || ratio === undefined) return MISSING_VALUE.notRecorded;
  return `${(ratio * PERCENT_SCALE).toFixed(0)}%`;
}

export function formulationSheetSections(formulation: FormulationWithIngredients): DetailPanelSection[] {
  const ingredientCount = formulation.ingredients?.length ?? 0;
  const ingredientFields = ingredientCount > 0
    ? formulation.ingredients.flatMap((ingredient, index) => {
        const prefix = ingredientCount > 1 ? `Ingredient ${index + 1}` : "Ingredient";
        return [
          {
            label: `${prefix} · Blend material`,
            value: ingredient.feedstockType.name,
          },
          {
            label: `${prefix} · volume share (%)`,
            value: formatRatio(ingredient.ratio),
          },
        ];
      })
    : [];

  return [
    {
      title: "Required information",
      fields: [
        { label: "Formulation name", value: formulation.name },
      ],
    },
    {
      title: "Blend composition by volume",
      fields: [
        {
          label: "Biochar · volume share (%)",
          value: formatRatio(formulation.biocharRatio),
        },
        ...ingredientFields,
      ],
      content: ingredientCount === 0 ? (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {PURE_BIOCHAR_CUE}
        </p>
      ) : undefined,
    },
    {
      title: "Additional information",
      fields: [{ label: "Description", value: formulation.description }],
    },
  ];
}
