import {
  classifySequestration1000YearComponent,
  CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
  DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
} from "@/lib/isometric/transformers/measurement-sample";

export interface RemovalDurabilityComponentDisplay {
  key: string;
  label: string;
  deprecated: boolean;
}

/** Classify the hash-covered template identity retained on historical drafts. */
export function readRemovalDurabilityComponent(
  payloadSnapshot: unknown,
): RemovalDurabilityComponentDisplay | null {
  const snapshot = payloadSnapshot as {
    semantic?: {
      sequestrationTemplate?: Array<{ blueprintKey?: unknown }>;
    };
  } | null;
  const components = snapshot?.semantic?.sequestrationTemplate;
  if (!Array.isArray(components)) return null;
  for (const component of components) {
    if (typeof component.blueprintKey !== "string") continue;
    const classification = classifySequestration1000YearComponent(
      component.blueprintKey,
    );
    if (classification === "deprecated") {
      return {
        key: DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
        label:
          "Legacy 1,000-year calculation: total-carbon basis, uncapped durability",
        deprecated: true,
      };
    }
    if (classification === "current") {
      return {
        key: CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
        label:
          "Current 1,000-year calculation: organic-carbon basis, 0.95 durability cap",
        deprecated: false,
      };
    }
  }
  return null;
}
