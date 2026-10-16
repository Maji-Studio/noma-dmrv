/**
 * PROTOTYPE (throwaway): the view model behind the credit batch page.
 *
 * Real inputs come from HEAD (batch, health checks, member runs, sample count).
 * Everything marked PROTOTYPE below is a stub that the `?scenario=` key swaps:
 * lock levels, Removal slices, progress, the header button, Check and Waiting
 * items, and the emission lines (entries are not in HEAD yet).
 */
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { formatTonnes } from "@/lib/format-utils";
import type { BatchHealth, BatchHealthCheck } from "@/lib/certification/batch-health";
import {
  batchHealthFixLinkFor,
  resolveBatchHealthFixTarget,
} from "@/lib/certification/batch-health-links";
import {
  EMISSION_LINE_STATE_LABELS,
  type EmissionLineState,
} from "@/lib/certification/emission-lines";

export const SCENARIOS = ["blocking", "clear", "partly-sent", "issued"] as const;
export type Scenario = (typeof SCENARIOS)[number];

// Traceability is a link out, not a tab: the Traceability page already opens on a credit batch (round 2).
export const TABS = ["overview", "production", "samples", "emissions", "removals", "activities"] as const;
export type TabKey = (typeof TABS)[number];
export const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  production: "Production",
  samples: "Samples",
  emissions: "Emissions",
  removals: "Removals",
  activities: "Activities",
};

export interface ProgressStep {
  label: string;
  state: "done" | "current" | "todo";
  /** A date, a record or what is holding the step. Empty for later steps. */
  caption: string;
  /** Blocking items holding this step, shown as a count badge. */
  count?: number;
}
export const SAMPLES_REQUIRED = 3;

export type ItemGroup = "blocking" | "check" | "waiting";
export type MassSegmentKey = "sent" | "inRemoval" | "notIn" | "notApplied";

export interface OpenItem {
  id: string;
  group: ItemGroup;
  title: string;
  detail?: string;
  tab: TabKey;
  /** Row to highlight in the target tab (?focus=). */
  rowId?: string;
  actionLabel: string;
  /** Repair page for a real health check fixed elsewhere; the row opens it instead of a tab. */
  externalHref?: string;
  stub: boolean;
}

export type RemovalStatusKey = "draft" | "submitted";
export interface RemovalRef {
  code: string;
  status: RemovalStatusKey;
  statusNote: string;
}
export interface MassSlice {
  id: string;
  /** Delivery and application the mass came from (PROTOTYPE codes). */
  label: string;
  meta: string;
  tons: number;
  removal: RemovalRef | null;
}
export interface EmissionLineStub {
  id: string;
  name: string;
  state: EmissionLineState;
  figure: string | null;
}
export interface LockInfo {
  reason: string;
  howTo: string;
  focus: string;
}
export type LockableField = "startDate" | "endDate" | "appliedMass" | "feedstock" | "template" | "sampling";

export interface PrimaryAction {
  kind: "fix" | "start" | "draft" | "ghg" | "none";
  label: string;
  /** Quieter button: a Removal is already submitted, so this is a follow-up, not the main step. */
  secondary?: boolean;
  hint?: string;
}

export interface BatchModel {
  scenario: Scenario;
  items: OpenItem[];
  blocking: OpenItem[];
  check: OpenItem[];
  waiting: OpenItem[];
  openCount: number;
  appliedTons: number;
  co2eTons: number | null;
  co2eIsStub: boolean;
  samples: number;
  slices: MassSlice[];
  masses: Record<MassSegmentKey, number>;
  emissionLines: EmissionLineStub[];
  progress: ProgressStep[];
  /** Mass per Removal plus the part in none, for the overview Removals panel. */
  removalMass: { removal: RemovalRef | null; tons: number }[];
  /** Show the Removals panel: the batch has a Removal or is ready for one. */
  showRemovals: boolean;
  lockLevel: "Open" | "Partly sent" | "Fully sent";
  locks: Partial<Record<LockableField, LockInfo>>;
  primary: PrimaryAction;
  removals: RemovalRef[];
}

const STUB_APPLIED_TONS = 18.6;
const NOT_APPLIED_SHARE = 0.18;
const STUB_CO2E_PER_TON = 0.78;

/** Shares of the applied mass per slice, in slice order. */
const SLICE_SHARES = [0.35, 0.25, 0.15, 0.25] as const;
const SLICE_LABELS = [
  ["DL-26-031 to Kanyama field", "Applied Sep 2, 2026"],
  ["DL-26-031 to Kanyama field, second pass", "Applied Sep 4, 2026"],
  ["DL-26-034 to Mwenda field", "Applied Sep 11, 2026"],
  ["DL-26-034 to Mwenda field, east block", "Applied Sep 12, 2026"],
] as const;

const R07: RemovalRef = { code: "R-07", status: "submitted", statusNote: "Submitted Oct 12, 2026" };
const R08: RemovalRef = { code: "R-08", status: "draft", statusNote: "Created Oct 14, 2026" };
const R07_ISSUED: RemovalRef = { code: "R-07", status: "submitted", statusNote: "Submitted Oct 12, 2026. In GHG Statement Q3" };
const R09_ISSUED: RemovalRef = { code: "R-09", status: "submitted", statusNote: "Submitted Oct 20, 2026. In GHG Statement Q3" };

function sliceRemovals(scenario: Scenario): (RemovalRef | null)[] {
  if (scenario === "partly-sent") return [R07, R07, R08, null];
  if (scenario === "issued") return [R07_ISSUED, R07_ISSUED, R09_ISSUED, R09_ISSUED];
  return [null, null, null, null];
}

function segmentOf(removal: RemovalRef | null): MassSegmentKey {
  if (!removal) return "notIn";
  return removal.status === "draft" ? "inRemoval" : "sent";
}

function emissionLinesFor(scenario: Scenario): EmissionLineStub[] {
  const lines: EmissionLineStub[] = [
    { id: "em-feedstock-transport", name: "Feedstock transport", state: "filled", figure: "0.84 t CO₂e" },
    { id: "em-diesel", name: "Diesel for kiln start", state: "missingEvidence", figure: "310 L" },
    { id: "em-grid", name: "Grid electricity", state: "needsReview", figure: "1,420 kWh" },
    { id: "em-delivery", name: "Biochar delivery transport", state: "needsSetup", figure: null },
    { id: "em-water", name: "Water use", state: "empty", figure: null },
    { id: "em-gas", name: "Natural gas", state: "confirmedZero", figure: "0 m³" },
  ];
  if (scenario === "blocking") return lines;
  return lines.map((line) => {
    if (line.state === "needsReview" && scenario === "partly-sent") return line;
    if (line.state === "confirmedZero") return line;
    return { ...line, state: "filled" as const, figure: line.figure ?? "Recorded" };
  });
}

const BLOCKING_EMISSION_STATES: readonly EmissionLineState[] = ["empty", "missingEvidence", "needsSetup"];

const CHECK_TAB: Record<string, TabKey> = {
  emissions: "emissions",
  certificationEmissions: "emissions",
  labSamples: "samples",
  productionRuns: "production",
  sourceData: "production",
  creditBatchTemplate: "overview",
  certificationTemplates: "overview",
  templateLineReview: "overview",
  batchDetails: "overview",
  feedstockTypes: "overview",
  biocharProducts: "overview",
};

/** Health fix targets that live on this page, mapped to the row they focus. */
const IN_PAGE_FIX: Record<string, string> = {
  creditBatchTemplate: "template",
  batchDetails: "details",
};

function tabForCheck(check: BatchHealthCheck): TabKey {
  return CHECK_TAB[resolveBatchHealthFixTarget(check)] ?? "removals";
}

function realBlockingItems(health: BatchHealth | undefined, batch: CreditBatchWithRelations): OpenItem[] {
  if (!health) return [];
  return health.checks
    .filter((check) => check.status === "unmet")
    // PROTOTYPE: emission checks are replaced by the stubbed emission lines below.
    .filter((check) => check.key !== "emissions" && check.key !== "facilityEmissions")
    .map((check, index) => {
      const fix = batchHealthFixLinkFor(check, batch.facilityId, batch.id);
      // Fixed on this page (template, details): jump in-page. Anything else opens its repair page.
      const inPage = IN_PAGE_FIX[resolveBatchHealthFixTarget(check)];
      return {
        id: `health-${check.key}-${check.issueKey ?? index}`,
        group: "blocking" as const,
        title: check.requirementLabel,
        detail: check.detail?.replace(/^Missing:\s*/i, ""),
        tab: tabForCheck(check),
        rowId: inPage,
        actionLabel: fix.label,
        externalHref: !inPage && fix.href.startsWith("/") ? fix.href : undefined,
        stub: false,
      };
    });
}

/** PROTOTYPE: the four lifecycle steps with stub captions per scenario. */
function progressFor(scenario: Scenario, blockingCount: number, masses: Record<MassSegmentKey, number>): ProgressStep[] {
  // Milestones, each named for what has happened, so a current step never reads as reached.
  const steps = ["Data complete", "Removal submitted", "Verified", "Credits issued"];
  const plan: Record<Scenario, [ProgressStep["state"], string][]> = {
    blocking: [["current", ""], ["todo", ""], ["todo", ""], ["todo", ""]],
    clear: [["done", "Nothing blocking"], ["current", "Not started"], ["todo", ""], ["todo", ""]],
    "partly-sent": [["done", "Oct 10, 2026"], ["done", "R-07, Oct 12, 2026"], ["current", "GHG Statement Q3 in verification"], ["todo", ""]],
    issued: [["done", "Oct 10, 2026"], ["done", "R-07 and R-09"], ["done", "Nov 1, 2026"], ["done", "Nov 3, 2026"]],
  };
  // A partly sent batch says how much is in the submitted Removal.
  if (scenario === "partly-sent") {
    const submitted = masses.sent;
    plan[scenario][1][1] = `R-07, ${submitted.toFixed(2)} of ${(masses.sent + masses.inRemoval + masses.notIn + masses.notApplied).toFixed(2)} t`;
  }
  return steps.map((stepLabel, index) => ({
    // While blocking items hold the first step it reads "Missing data"; once done it is "Data complete".
    label: index === 0 && plan[scenario][0][0] === "current" && blockingCount > 0 ? "Missing data" : stepLabel,
    state: plan[scenario][index][0],
    caption: plan[scenario][index][1],
    count: scenario === "blocking" && index === 0 ? blockingCount : undefined,
  }));
}

export interface ModelInput {
  batch: CreditBatchWithRelations;
  health: BatchHealth | undefined;
  realSampleCount: number | undefined;
  scenario: Scenario;
}

export function buildBatchModel({ batch, health, realSampleCount, scenario }: ModelInput): BatchModel {
  const real = batch.appliedWeightTons;
  const appliedTons = real > 0 ? real : STUB_APPLIED_TONS;
  const emissionLines = emissionLinesFor(scenario);
  const removalsByIndex = sliceRemovals(scenario);
  const slices: MassSlice[] = SLICE_SHARES.map((share, index) => ({
    id: `slice-${index + 1}`,
    label: SLICE_LABELS[index][0],
    meta: SLICE_LABELS[index][1],
    tons: appliedTons * share,
    removal: removalsByIndex[index],
  }));
  const masses: Record<MassSegmentKey, number> = {
    sent: 0,
    inRemoval: 0,
    notIn: 0,
    notApplied: scenario === "issued" ? 0 : appliedTons * NOT_APPLIED_SHARE,
  };
  for (const slice of slices) masses[segmentOf(slice.removal)] += slice.tons;

  const samples = scenario === "blocking" ? Math.min(realSampleCount ?? 2, SAMPLES_REQUIRED - 1) : (realSampleCount ?? SAMPLES_REQUIRED);

  const items: OpenItem[] = [];
  if (scenario === "blocking") {
    items.push(...realBlockingItems(health, batch));
    for (const line of emissionLines) {
      if (!BLOCKING_EMISSION_STATES.includes(line.state)) continue;
      items.push({
        id: `blk-${line.id}`,
        group: "blocking",
        title: `${line.name}: ${EMISSION_LINE_STATE_LABELS[line.state]}`,
        detail: line.state === "missingEvidence" ? "Add a file for the emissions entry with a value." : "Record this line or confirm it as zero.",
        tab: "emissions",
        rowId: line.id,
        actionLabel: "Fix in Emissions",
        stub: true,
      });
    }
    if (samples < SAMPLES_REQUIRED) {
      items.push({
        id: "blk-samples",
        group: "blocking",
        title: `Samples: ${samples} of ${SAMPLES_REQUIRED}`,
        detail: "A sampled credit batch needs at least three Samples.",
        tab: "samples",
        rowId: "samples",
        actionLabel: "Add Sample",
        stub: true,
      });
    }
  }
  if (scenario !== "issued") {
    items.push({
      id: "chk-sample-outlier",
      group: "check",
      title: "SAM-26-002 H/Corg is well above the other Samples",
      detail: "It may be an outlier. Check the lab report before the next Removal.",
      tab: "samples",
      rowId: "samples",
      actionLabel: "Review sample",
      stub: true,
    });
  }
  const gridLine = emissionLines.find((line) => line.state === "needsReview");
  if (gridLine && scenario !== "issued") {
    items.push({
      id: "chk-grid",
      group: "check",
      title: `${gridLine.name}: Needs review`,
      detail: "The figure changed after the last review.",
      tab: "emissions",
      rowId: gridLine.id,
      actionLabel: "Review line",
      stub: true,
    });
  }
  if (scenario === "partly-sent") {
    items.push(
      {
        id: "wait-ghg",
        group: "waiting",
        title: "GHG Statement Q3: In verification",
        detail: "It includes R-07. Submitted Oct 15, 2026.",
        tab: "removals",
        rowId: "ghg",
        actionLabel: "See in Removals",
        stub: true,
      },
    );
  }
  if (scenario !== "issued") {
    items.push({
      id: "wait-unapplied",
      group: "waiting",
      title: `${formatTonnes(masses.notApplied)} of biochar not applied yet`,
      detail: "It can join a Removal once its application is recorded.",
      tab: "removals",
      rowId: "not-applied",
      actionLabel: "See in Removals",
      stub: true,
    });
  }

  const blocking = items.filter((item) => item.group === "blocking");
  const check = items.filter((item) => item.group === "check");
  const waiting = items.filter((item) => item.group === "waiting");

  const locks: BatchModel["locks"] = {};
  if (scenario === "partly-sent") {
    const reason = "R-07 is submitted with part of this biochar.";
    const howTo = "This field reopens only if Isometric returns R-07 to draft or the GHG Statement fails verification.";
    locks.endDate = { reason, howTo, focus: "slice-1" };
    locks.appliedMass = { reason, howTo, focus: "slice-1" };
  }
  if (scenario === "issued") {
    const reason = "Credits are issued for all of this biochar.";
    const howTo = "Issued credits cannot change in noma. Ask Isometric about a correction.";
    for (const field of ["startDate", "endDate", "appliedMass", "feedstock", "template", "sampling"] as const) {
      locks[field] = { reason, howTo, focus: "slice-1" };
    }
  }

  const removals = [...new Map(slices.flatMap((slice) => (slice.removal ? [[slice.removal.code, slice.removal] as const] : []))).values()];
  let primary: PrimaryAction;
  if (blocking.length > 0) {
    primary = { kind: "fix", label: "Fix next item", hint: blocking[0].title };
  } else if (scenario === "issued") {
    // Design call: nothing left to start, so no primary button. The header shows the issued fact.
    primary = { kind: "none", label: "" };
  } else if (masses.notIn > 0) {
    const draft = removals.find((removal) => removal.status === "draft");
    const hasSubmitted = removals.some((removal) => removal.status === "submitted");
    if (draft) {
      primary = { kind: "draft", label: `Open ${draft.code}`, hint: `Add the ${formatTonnes(masses.notIn)} not in a Removal to this draft`, secondary: hasSubmitted };
    } else {
      primary = { kind: "start", label: "Start Removal", hint: "Adds the applied biochar that is not in a Removal yet.", secondary: hasSubmitted };
    }
  } else {
    primary = { kind: "ghg", label: "Open GHG Statement" };
  }

  const preview = batch.co2eStoredPreview?.co2eStoredTonnes ?? null;

  return {
    scenario,
    items,
    blocking,
    check,
    waiting,
    openCount: blocking.length + check.length,
    appliedTons,
    co2eTons: preview ?? appliedTons * STUB_CO2E_PER_TON,
    co2eIsStub: preview == null,
    samples,
    slices,
    masses,
    emissionLines,
    progress: progressFor(scenario, blocking.length, masses),
    removalMass: [
      ...removals.map((removal) => ({ removal, tons: slices.filter((slice) => slice.removal?.code === removal.code).reduce((sum, slice) => sum + slice.tons, 0) })),
      ...(masses.notIn > 0 ? [{ removal: null, tons: masses.notIn }] : []),
    ],
    showRemovals: removals.length > 0 || blocking.length === 0,
    lockLevel: scenario === "issued" ? "Fully sent" : scenario === "partly-sent" ? "Partly sent" : "Open",
    locks,
    primary,
    removals,
  };
}
