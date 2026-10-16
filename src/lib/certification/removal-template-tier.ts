import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { expectedSequestrationBlueprintKeys, isSequestrationBlueprintFamily, type DurabilityTier } from "@/lib/isometric/storage-blueprints";

export function removalTemplateTierCompatibilityBlocker(
  ctx: { batchesWithSamples: ReadonlyArray<{ durabilityOption: DurabilityTier | null }> },
  template: IsometricGhgEntryTemplate,
): string | null {
  const facilityTier = ctx.batchesWithSamples[0]?.durabilityOption ?? null;
  if (!facilityTier) return null;
  const expectedKeys = expectedSequestrationBlueprintKeys(facilityTier);
  const mismatched = template.groups
    .flatMap((group) => group.components)
    .map((component) => component.blueprint_key)
    .filter(isSequestrationBlueprintFamily)
    .find((key) => !expectedKeys.has(key));
  if (!mismatched) return null;

  const tierLabel = facilityTier === "1000_year" ? "1000-year" : "200-year";
  return (
    `This facility uses ${tierLabel} durability, but the credit batch's Removal ` +
    `template uses an incompatible storage component (${mismatched}). ` +
    `Switch the credit batch to a ${tierLabel} template or change the facility's durability tier.`
  );
}

