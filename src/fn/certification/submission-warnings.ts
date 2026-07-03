import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";

// Blueprint key for the volume-based fuel-usage component that carries
// startup/plant diesel + preprocessing fuel. The live operator template
// (ADR 0015) declares none, so a recorded startup-diesel value has nothing to
// carry it and is not submitted.
const FUEL_USAGE_BY_VOLUME_BLUEPRINT = "fuel_usage_by_volume";

const STARTUP_DIESEL_UNMAPPED_WARNING =
  "Startup/plant diesel and preprocessing fuel are recorded, but the active removal template declares no fuel-usage component to carry them — these emissions are not submitted (ADR 0015).";

function templateDeclaresFuelUsageComponent(
  template: IsometricGhgEntryTemplate,
): boolean {
  return template.groups.some((group) =>
    group.components.some(
      (component) => component.blueprint_key === FUEL_USAGE_BY_VOLUME_BLUEPRINT,
    ),
  );
}

// UTC year-month key ("YYYY-MM") — the reporting window is compared at month
// grain because a noma Removal defaults to a one-RP-month batch (ADR 0016).
function utcMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

// §8.6.2 anchors the removal's period end to the latest biochar application
// (issue #320), so a batch produced in one month but applied in a later one
// stretches the window across months — operations emissions "must be
// attributed to the Reporting Period in which they occur", so surface the
// straddle as an advisory (non-blocking; splitting is the operator's call).
function buildStraddleWarning(args: {
  runs: ProductionRunWithSamples[];
  lineages: { application: { applicationDate: Date } }[];
}): string[] {
  const { runs, lineages } = args;
  if (runs.length === 0 || lineages.length === 0) return [];
  const earliestStart = runs.reduce(
    (earliest, run) => (run.startTime < earliest ? run.startTime : earliest),
    runs[0].startTime,
  );
  const latestApplication = lineages.reduce(
    (latest, lineage) =>
      lineage.application.applicationDate > latest
        ? lineage.application.applicationDate
        : latest,
    lineages[0].application.applicationDate,
  );
  const startMonth = utcMonth(earliestStart);
  const applicationMonth = utcMonth(latestApplication);
  if (startMonth === applicationMonth) return [];
  return [
    `Reporting window spans multiple months (production started ${startMonth}, ` +
      `latest application ${applicationMonth}); §8.6.2 attributes operations ` +
      "emissions to the period they occur in — consider splitting the removal.",
  ];
}

// Non-blocking submission advisories surfaced at readiness AND logged at submit:
//   1. A recorded startup/plant-diesel value with no template component to
//      carry it (ADR 0015). Run-level presence is the right signal —
//      attribution only scales the figure down, so "any run recorded startup
//      or preprocessing fuel" captures "the operator entered a value that
//      won't submit".
//   2. A reporting window straddling a month boundary (issue #320) —
//      independent of the template, since it is a property of the lineage
//      dates alone.
export function buildSubmissionWarnings(args: {
  defaultTemplate: IsometricGhgEntryTemplate | null;
  runs: ProductionRunWithSamples[];
  lineages: { application: { applicationDate: Date } }[];
}): string[] {
  const { defaultTemplate, runs, lineages } = args;
  const warnings = buildStraddleWarning({ runs, lineages });
  if (!defaultTemplate || templateDeclaresFuelUsageComponent(defaultTemplate)) {
    return warnings;
  }
  const hasStartupDiesel = runs.some(
    (run) =>
      (run.dieselOperationLiters ?? 0) + (run.preprocessingFuelLiters ?? 0) > 0,
  );
  return hasStartupDiesel
    ? [STARTUP_DIESEL_UNMAPPED_WARNING, ...warnings]
    : warnings;
}
