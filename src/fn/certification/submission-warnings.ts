import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";

// Group + blueprint + input keys for the volume-based fuel-usage component
// that carries the combined diesel litres (genset + startup/preprocessing —
// issue #319, energy-use-accounting v1.3 Eq 7). The mapping lives under the
// `pyrolysis` group in INPUT_MAPPING, so only a component declared there can
// carry the value; a `fuel_usage_by_volume` in another REMOVAL-scope group
// would not be served (`biochar-storage`'s is a PROJECT-scope tuple and never
// carries run diesel). The `volume_of_fuel` input must also be MONITORED:
// resolveTemplateInputs treats fixed inputs as prebound datapoints and never
// builds the run-derived litres for them, so a component whose volume input
// is fixed (or absent) silently drops the run diesel — warn in that case too.
const PYROLYSIS_GROUP_KEY = "pyrolysis";
const FUEL_USAGE_BY_VOLUME_BLUEPRINT = "fuel_usage_by_volume";
const VOLUME_OF_FUEL_INPUT_KEY = "volume_of_fuel";

const DIESEL_UNMAPPED_WARNING =
  "Diesel fuel (genset and/or startup/preprocessing) is recorded, but the active removal template declares no pyrolysis fuel-usage-by-volume component with a monitored volume-of-fuel input to carry it — removal submissions cannot include these fuel emissions (issue #319).";

function templateCarriesRunDiesel(
  template: IsometricGhgEntryTemplate,
): boolean {
  return template.groups.some(
    (group) =>
      group.key === PYROLYSIS_GROUP_KEY &&
      group.components.some(
        (component) =>
          component.blueprint_key === FUEL_USAGE_BY_VOLUME_BLUEPRINT &&
          component.inputs.some(
            (input) =>
              input.input_key === VOLUME_OF_FUEL_INPUT_KEY &&
              input.type === "monitored",
          ),
      ),
  );
}

// Non-blocking submission advisories surfaced at readiness AND logged at submit.
// Currently the only one: recorded diesel (genset or startup/preprocessing) with
// no monitored pyrolysis `fuel_usage_by_volume / volume_of_fuel` input to carry
// it (issue #319). Run-level presence is the right signal — attribution only
// scales the figure down, so "any run recorded diesel" captures "the operator
// entered a value that won't submit".
export function buildSubmissionWarnings(args: {
  defaultTemplate: IsometricGhgEntryTemplate | null;
  runs: ProductionRunWithSamples[];
}): string[] {
  const { defaultTemplate, runs } = args;
  if (!defaultTemplate) return [];
  if (templateCarriesRunDiesel(defaultTemplate)) return [];
  const hasDiesel = runs.some(
    (run) =>
      (run.dieselOperationLiters ?? 0) +
        (run.preprocessingFuelLiters ?? 0) +
        (run.dieselGensetLiters ?? 0) >
      0,
  );
  return hasDiesel ? [DIESEL_UNMAPPED_WARNING] : [];
}
