import { DomainError } from "@/lib/domain-errors";
import { ownValue } from "@/lib/isometric/semantic-binding-catalog";
import type { AutomaticSourceId } from "@/lib/isometric/template-observations/catalog-sources";
import { effectiveContract, validateLineSources, type LineSources, type LineSourceProblem } from "@/lib/isometric/template-observations/line-sources";
import type { TemplateDefinition } from "@/lib/isometric/template-observations/types";
import { canonicalDecimal } from "@/lib/isometric/template-observations/units";
import { emissionLineBindingDecision } from "./emission-line-binding";
import type { RemovalBlocker } from "./removal-blockers";

const UNIT_MISMATCH_MESSAGE = "Emissions values use different units. Use the same unit before adding them.";

export const EMISSION_LINE_STATE_LABELS = {
  filled: "Recorded", empty: "Not recorded", missingEvidence: "File missing",
  needsReview: "Needs review", needsSetup: "Needs setup", confirmedZero: "Nothing to record",
} as const;
export type EmissionLineState = keyof typeof EMISSION_LINE_STATE_LABELS;
export interface EmissionFigure { magnitude: string; unit: string }
export type EmissionRecordSource = "productionRuns" | "transportLegs" | "deliveries" | "applications";
export interface EmissionLineRecords {
  source: EmissionRecordSource;
  count: number;
  figure: EmissionFigure | null;
}
const RECORD_SOURCES: Record<AutomaticSourceId, EmissionRecordSource> = {
  "run-genset-diesel": "productionRuns", "run-startup-diesel": "productionRuns",
  "run-electricity": "productionRuns", "feedstock-dry-mass": "productionRuns",
  "biochar-dry-mass": "deliveries", "safety-margin": "applications",
  "feedstock-transport": "transportLegs", "sample-transport": "transportLegs",
  "delivery-transport": "deliveries", sequestration: "applications",
};
export interface EmissionLineEntryFact {
  componentId: string; kind: "value" | "zero"; hasEvidence: boolean;
  confirmedForRemovalId?: string | null;
  total: EmissionFigure | null; counts: boolean; reason?: string | null; unitMismatch?: boolean;
}
export interface BatchEmissionLineFacts {
  definition: TemplateDefinition; lineSources: LineSources; problems: readonly LineSourceProblem[];
  enrichmentComplete: boolean;
  automaticFigures: Partial<Record<AutomaticSourceId, EmissionFigure | null>>;
  automaticRecordCounts?: Partial<Record<AutomaticSourceId, number>>;
  entries: readonly EmissionLineEntryFact[];
}

/** Decimal strings use the observation canonicalizer and integer arithmetic.
 * Unit conversion belongs at the fact boundary; never sum unlike units.
 */
export function sumFigures(figures: EmissionFigure[]): EmissionFigure | null {
  if (!figures.length) return null;
  const unit = figures[0].unit;
  if (figures.some((figure) => figure.unit !== unit)) throw new DomainError("validation_failed", UNIT_MISMATCH_MESSAGE);
  const values = figures.map(({ magnitude }) => {
    const value = canonicalDecimal(magnitude);
    if (value === undefined) throw new DomainError("validation_failed", "An emissions value could not be read. Check the recorded values.");
    return value;
  });
  const scale = Math.max(...values.map((value) => value.split(".")[1]?.length ?? 0));
  const sum = values.reduce((total, value) => {
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    return total + BigInt(`${whole}${fraction.padEnd(scale, "0")}`) * (value.startsWith("-") ? BigInt(-1) : BigInt(1));
  }, BigInt(0));
  const digits = (sum < BigInt(0) ? -sum : sum).toString().padStart(scale + 1, "0");
  const magnitude = `${sum < BigInt(0) ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
  return { magnitude: canonicalDecimal(magnitude)!, unit };
}

export function deriveBatchEmissionLines(facts: BatchEmissionLineFacts) {
  // Revalidate as well as accepting observation problems: callers cannot hide an invalid contract.
  const problems = [...facts.problems, ...validateLineSources(facts.definition, facts.lineSources)];
  const fallbackGroupOffset = Math.max(-1, ...Object.values(facts.lineSources).map((source) => source.templateOrder?.groupPosition ?? -1)) + 1;
  return facts.definition.groups.flatMap((group, groupIndex) => group.components.map((component, componentIndex) => {
    const stored = ownValue(facts.lineSources, component.id);
    const contract = stored ? effectiveContract(stored) : undefined;
    const decision = emissionLineBindingDecision({ component, groupKey: group.key, contract: stored, problems, enrichmentComplete: facts.enrichmentComplete });
    const entries = facts.entries.filter((entry) => entry.componentId === component.id);
    const counting = entries.filter((entry) => entry.counts);
    const operatorZero = counting.some((entry) => entry.kind === "zero" && entry.confirmedForRemovalId === null);
    const values = counting.filter((entry) => entry.kind === "value");
    const automaticFigure = contract?.automaticSource ? ownValue(facts.automaticFigures, contract.automaticSource) ?? null : null;
    const records: EmissionLineRecords | null = contract?.automaticSource ? {
      source: RECORD_SOURCES[contract.automaticSource],
      count: facts.automaticRecordCounts?.[contract.automaticSource] ?? 0,
      figure: automaticFigure,
    } : null;
    let state: EmissionLineState;
    let blocker: RemovalBlocker | undefined = decision?.blocker;
    if (decision && decision.state !== "empty") { state = decision.state; blocker = decision.blocker; }
    else if (values.some((entry) => !entry.hasEvidence)) {
      state = "missingEvidence";
      blocker = { code: "entryMissingEvidence", message: "Add a file for each emissions entry with a value.", fixTarget: "emissions", lineRef: { componentId: component.id, displayName: component.displayName } };
    } else if (!values.length && counting.some((entry) => entry.kind === "zero") &&
      (!automaticFigure || (operatorZero && Number(automaticFigure.magnitude) === 0))) state = "confirmedZero";
    else if (automaticFigure || values.length) state = "filled";
    else { state = "empty"; blocker = decision?.blocker; }
    if (state === "confirmedZero" && operatorZero && blocker?.code === "lineHasNoSource") blocker = undefined;
    // A paired-input value has no scalar total. Do not show a partial sum.
    const figures = [
      ...(automaticFigure ? [automaticFigure] : []), ...values.flatMap((entry) => entry.total ? [entry.total] : []),
    ];
    const unitMismatch = entries.some((entry) => entry.unitMismatch) || figures.some((figure) => figure.unit !== figures[0]?.unit);
    if (unitMismatch) {
      state = "needsReview";
      blocker = { code: "lineNeedsReview", message: UNIT_MISMATCH_MESSAGE, fixTarget: "emissions", lineRef: { componentId: component.id, displayName: component.displayName } };
    }
    const stale = entries.find((entry) => !entry.counts);
    if (stale) {
      state = "needsReview";
      blocker = { code: "lineNeedsReview", message: stale.reason ?? "Enter the values again for the current template line.", fixTarget: "emissions", lineRef: { componentId: component.id, displayName: component.displayName } };
    }
    const total = unitMismatch || values.some((entry) => entry.total === null) ? null : sumFigures(figures);
    return { componentId: component.id, displayName: component.displayName, groupKey: group.key,
      groupName: group.displayName,
      groupPosition: stored?.templateOrder?.groupPosition ?? fallbackGroupOffset + groupIndex,
      position: stored?.templateOrder?.position ?? componentIndex,
      blueprintKey: component.blueprintKey, description: component.description,
      entryPolicy: contract?.entryPolicy ?? "none", records, contract, state, automaticFigure, entries, total, ...(blocker ? { blocker } : {}) };
  })).sort((a, b) => a.groupPosition - b.groupPosition || a.position - b.position);
}
export type BatchEmissionLine = ReturnType<typeof deriveBatchEmissionLines>[number];
