import { z } from "zod";
import { API_FORMULATION_MAX_LINES } from "@/config/api-formulations";
import { exceedsFormulationRatioSum, isExactFormulationRatio, FORMULATION_RATIO_STEP, RATIO_SUM_EXCEEDED_MESSAGE } from "@/lib/formulation-ratios";
import { expectedVersionSchema, uuidSchema } from "./helpers";
import { DUPLICATE_BLEND_MATERIAL_MESSAGE, updateFormulationSchema } from "./formulations";

const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 1000;
const ratio = z.number().min(0).max(1).multipleOf(FORMULATION_RATIO_STEP).refine(isExactFormulationRatio).nullable().optional();
const fields = {
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  biocharRatio: ratio,
  description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
  lines: z.array(z.strictObject({ feedstockTypeId: uuidSchema(), ratio })).max(API_FORMULATION_MAX_LINES).optional(),
};
function refine(data: { biocharRatio?: number | null; lines?: { feedstockTypeId: string; ratio?: number | null }[] }, ctx: z.RefinementCtx) {
  if (exceedsFormulationRatioSum(data.biocharRatio, data.lines)) {
    ctx.addIssue({ code: "custom", path: ["biocharRatio"], message: RATIO_SUM_EXCEEDED_MESSAGE });
  }
  const seen = new Set<string>();
  data.lines?.forEach((line, index) => {
    if (seen.has(line.feedstockTypeId)) ctx.addIssue({ code: "custom", path: ["lines", index, "feedstockTypeId"], message: DUPLICATE_BLEND_MATERIAL_MESSAGE });
    seen.add(line.feedstockTypeId);
  });
}
export const createFormulationInput = z.strictObject(fields).superRefine(refine);
export const updateFormulationInput = z.strictObject({
  ...z.object(fields).partial().shape,
  formulationId: uuidSchema(), expectedVersion: expectedVersionSchema,
  code: updateFormulationSchema.shape.code,
}).superRefine(refine);
export const formulationVersionInput = z.strictObject({ formulationId: uuidSchema(), expectedVersion: expectedVersionSchema });
export type CreateFormulationInput = z.output<typeof createFormulationInput>;
export type UpdateFormulationInput = z.output<typeof updateFormulationInput>;
export type FormulationVersionInput = z.output<typeof formulationVersionInput>;
