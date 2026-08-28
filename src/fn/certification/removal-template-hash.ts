import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { isSequestrationBlueprintFamily } from "@/lib/isometric/transformers/measurement-sample";

/** Stable, order-independent template surface included in Removal review hashes. */
export function normalizeSequestrationTemplateForHash(
  template: IsometricGhgEntryTemplate,
) {
  return template.groups
    .flatMap((group) =>
      group.components
        .filter((component) =>
          isSequestrationBlueprintFamily(component.blueprint_key),
        )
        .map((component) => ({
          groupKey: group.key,
          rtcId: component.id,
          blueprintKey: component.blueprint_key,
          inputs: component.inputs
            .map((input) => ({
              inputKey: input.input_key,
              type: input.type,
              quantityKind: input.quantity_kind,
              datapointId: input.datapoint_id,
            }))
            .sort((a, b) => a.inputKey.localeCompare(b.inputKey)),
        })),
    )
    .sort((a, b) =>
      `${a.groupKey}::${a.rtcId}::${a.blueprintKey}`.localeCompare(
        `${b.groupKey}::${b.rtcId}::${b.blueprintKey}`,
      ),
    );
}
