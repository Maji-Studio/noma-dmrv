import type { RemovalAdvisory } from "@/lib/certification/removal-blockers";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { effectiveContract, type LineSources } from "@/lib/isometric/template-observations/line-sources";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { ProductionRunForCertification } from "@/lib/isometric/utils/aggregation";
import { catalogCandidates, type AutomaticSourceId } from "@/lib/isometric/template-observations/catalog-sources";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations/normalize";
import type { TransportLegsByCategory } from "./shared";
import { ownValue } from "@/lib/isometric/semantic-binding-catalog";

// Run masses exist on every run and sequestration is required on every Removal
// template. Warning for those would fire on nearly every template. Safety margin
// reuses dry biochar mass rather than an independently recorded emissions fact.
export const DELIBERATELY_EXCLUDED_SOURCES = {
  "feedstock-dry-mass": "Run mass is recorded on every run.",
  "biochar-dry-mass": "Run mass is recorded on every run.",
  sequestration: "Every Removal template requires sequestration.",
  "safety-margin": "Reuses biochar dry mass, not an independent recorded fact.",
} as const;
export const RECORDED_AUTOMATIC_SOURCES = [
  { id: "run-genset-diesel", label: "Genset diesel", recorded: (run: ProductionRunForCertification) => (run.dieselGensetLiters ?? 0) > 0 || (run.preprocessingFuelLiters ?? 0) > 0 },
  { id: "run-startup-diesel", label: "Startup diesel", recorded: (run: ProductionRunForCertification) => (run.dieselOperationLiters ?? 0) > 0 },
  { id: "run-electricity", label: "Electricity", recorded: (run: ProductionRunForCertification) => (run.electricityKwh ?? 0) > 0 },
] as const satisfies readonly { id: AutomaticSourceId; label: string; recorded: (run: ProductionRunForCertification) => boolean }[];

export const RECORDED_TRANSPORT_SOURCES = [
  { category: "feedstock", id: "feedstock-transport", label: "Feedstock transport" },
  { category: "biochar", id: "delivery-transport", label: "Delivery transport" },
  { category: "sample", id: "sample-transport", label: "Sample transport" },
] as const satisfies readonly { category: keyof TransportLegsByCategory; id: AutomaticSourceId; label: string }[];

function carriedAutomaticSources(template: IsometricGhgEntryTemplate, lineSources: LineSources): Set<AutomaticSourceId> {
  const carried = new Set<AutomaticSourceId>();
  for (const group of normalizeTemplateDefinition(template).groups) {
    for (const component of group.components) {
      const stored = ownValue(lineSources, component.id);
      const contract = stored && effectiveContract(stored);
      if (contract?.scope === "operating" && contract.automaticSource && catalogCandidates(component, group.key).includes(contract.automaticSource)) {
        carried.add(contract.automaticSource);
      }
    }
  }
  return carried;
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
  runs: ProductionRunForCertification[];
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
      "emissions to the period when they occur. Review the dates and split the Removal if needed.",
  ];
}

// Warn when a recorded fact has no effective automatic source in the live template.
export function buildSubmissionAdvisories(args: {
  removalTemplate: IsometricGhgEntryTemplate | null;
  lineSources: LineSources;
  runs: ProductionRunForCertification[];
  lineages: { application: { applicationDate: Date } }[];
  transportLegs?: TransportLegsByCategory;
}): RemovalAdvisory[] {
  const { removalTemplate, lineSources, runs } = args;
  if (!removalTemplate) return [];
  const carried = carriedAutomaticSources(removalTemplate, lineSources);
  const droppedFacts = [
    ...RECORDED_AUTOMATIC_SOURCES.filter((source) => runs.some(source.recorded) && !carried.has(source.id)),
    ...RECORDED_TRANSPORT_SOURCES.filter((source) => {
      const legs = args.transportLegs?.[source.category] ?? [];
      // Delivery legs are derived even for an unrecorded route; their mere
      // existence does not mean a transport fact was captured.
      const recorded = source.category === "biochar" ? legs.some((leg) => leg.distanceKm > 0) : legs.length > 0;
      return recorded && !carried.has(source.id);
    }),
  ];
  return droppedFacts.map((source) => ({
    code: "droppedRecordedFact", fixTarget: "templateLineReview",
    message: `${source.label} is recorded, but the active Removal template has no automatic source for it. ${REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview}`,
  }));
}

export function buildSubmissionWarnings(args: Parameters<typeof buildSubmissionAdvisories>[0]): string[] {
  return [...buildSubmissionAdvisories(args).map((advisory) => advisory.message), ...buildStraddleWarning(args)];
}
