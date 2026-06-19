import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";

// Blueprint key for the volume-based fuel-usage component that carries
// startup/plant diesel + preprocessing fuel. The live operator template
// (ADR 0014) declares none, so a recorded startup-diesel value has nothing to
// carry it and is not submitted.
const FUEL_USAGE_BY_VOLUME_BLUEPRINT = "fuel_usage_by_volume";

const STARTUP_DIESEL_UNMAPPED_WARNING =
  "Startup/plant diesel and preprocessing fuel are recorded, but the active removal template declares no fuel-usage component to carry them — these emissions are not submitted (ADR 0014).";

function templateDeclaresFuelUsageComponent(
  template: IsometricGhgEntryTemplate,
): boolean {
  return template.groups.some((group) =>
    group.components.some(
      (component) => component.blueprint_key === FUEL_USAGE_BY_VOLUME_BLUEPRINT,
    ),
  );
}

// Non-blocking submission advisories surfaced at readiness AND logged at submit.
// Currently the only one: a recorded startup/plant-diesel value with no template
// component to carry it (ADR 0014). Run-level presence is the right signal —
// attribution only scales the figure down, so "any run recorded startup or
// preprocessing fuel" captures "the operator entered a value that won't submit".
export function buildSubmissionWarnings(args: {
  defaultTemplate: IsometricGhgEntryTemplate | null;
  runs: ProductionRunWithSamples[];
}): string[] {
  const { defaultTemplate, runs } = args;
  if (!defaultTemplate) return [];
  if (templateDeclaresFuelUsageComponent(defaultTemplate)) return [];
  const hasStartupDiesel = runs.some(
    (run) =>
      (run.dieselOperationLiters ?? 0) + (run.preprocessingFuelLiters ?? 0) > 0,
  );
  return hasStartupDiesel ? [STARTUP_DIESEL_UNMAPPED_WARNING] : [];
}
