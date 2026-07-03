import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";

// Group + blueprint key for the volume-based fuel-usage component that carries
// the combined diesel litres (genset + startup/preprocessing — issue #319,
// energy-use-accounting v1.3 Eq 7). The mapping lives under the `pyrolysis`
// group in INPUT_MAPPING, so only a component declared there can carry the
// value; a `fuel_usage_by_volume` in another REMOVAL-scope group would not be
// served (`biochar-storage`'s is a PROJECT-scope tuple and never carries run
// diesel).
const PYROLYSIS_GROUP_KEY = "pyrolysis";
const FUEL_USAGE_BY_VOLUME_BLUEPRINT = "fuel_usage_by_volume";

const DIESEL_UNMAPPED_WARNING =
  "Diesel fuel (genset and/or startup/preprocessing) is recorded, but the active removal template declares no pyrolysis fuel-usage-by-volume component to carry it — removal submissions cannot include these fuel emissions (issue #319).";

function templateDeclaresFuelUsageComponent(
  template: IsometricGhgEntryTemplate,
): boolean {
  return template.groups.some(
    (group) =>
      group.key === PYROLYSIS_GROUP_KEY &&
      group.components.some(
        (component) =>
          component.blueprint_key === FUEL_USAGE_BY_VOLUME_BLUEPRINT,
      ),
  );
}

// Non-blocking submission advisories surfaced at readiness AND logged at submit.
// Currently the only one: recorded diesel (genset or startup/preprocessing) with
// no pyrolysis `fuel_usage_by_volume` component to carry it (issue #319). Run-
// level presence is the right signal — attribution only scales the figure down,
// so "any run recorded diesel" captures "the operator entered a value that won't
// submit".
export function buildSubmissionWarnings(args: {
  defaultTemplate: IsometricGhgEntryTemplate | null;
  runs: ProductionRunWithSamples[];
}): string[] {
  const { defaultTemplate, runs } = args;
  if (!defaultTemplate) return [];
  if (templateDeclaresFuelUsageComponent(defaultTemplate)) return [];
  const hasDiesel = runs.some(
    (run) =>
      (run.dieselOperationLiters ?? 0) +
        (run.preprocessingFuelLiters ?? 0) +
        (run.dieselGensetLiters ?? 0) >
      0,
  );
  return hasDiesel ? [DIESEL_UNMAPPED_WARNING] : [];
}
