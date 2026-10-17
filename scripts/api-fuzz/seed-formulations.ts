import type { OrgContext } from "@/lib/auth/server";
import { createFeedstockType } from "@/data-access/feedstock-types";
import { formulationEtag } from "@/lib/api/representation-etags";
import { archiveFormulation, createFormulation } from "@/lib/operations/formulations";
import { runOperation } from "@/lib/operations/runner";

const BIOCHAR_RATIO = 0.8;
const INGREDIENT_RATIO = 0.2;
const PURE_BIOCHAR_RATIO = 1;
const scriptOptions = { activitySource: "script" as const };

/** Separate, unreferenced targets keep every DELETE and transition example valid. */
export async function seedFormulations(ctx: OrgContext) {
  const create = async (name: string) => (await runOperation(createFormulation, ctx, { name, biocharRatio: PURE_BIOCHAR_RATIO }, scriptOptions)).data;
  const pure = await create("API fuzz pure biochar");
  const blendType = await createFeedstockType(ctx, {
    code: "FUZZ-BLEND", name: "API fuzz blend ingredient", category: "compost", usage: "blend",
  });
  const blend = (await runOperation(createFormulation, ctx, {
    name: "API fuzz blend", biocharRatio: BIOCHAR_RATIO,
    lines: [{ feedstockTypeId: blendType.id, ratio: INGREDIENT_RATIO }],
  }, scriptOptions)).data;
  const spare = await create("API fuzz delete spare");
  const archive = await create("API fuzz archive spare");
  const activeRestore = await create("API fuzz restore spare");
  const restore = (await runOperation(archiveFormulation, ctx, {
    formulationId: activeRestore.id, expectedVersion: activeRestore.version,
  }, scriptOptions)).data;
  return { pure, blend, fields: {
    blendFeedstockTypeId: blendType.id,
    pureFormulationId: pure.id, pureFormulationCode: pure.code, pureFormulationEtag: formulationEtag(pure),
    blendFormulationId: blend.id, blendFormulationCode: blend.code, blendFormulationEtag: formulationEtag(blend),
    deleteFormulationId: spare.id, deleteFormulationCode: spare.code, deleteFormulationEtag: formulationEtag(spare),
    archiveFormulationId: archive.id, archiveFormulationCode: archive.code, archiveFormulationEtag: formulationEtag(archive),
    restoreFormulationId: restore.id, restoreFormulationCode: restore.code, restoreFormulationEtag: formulationEtag(restore),
  } };
}
