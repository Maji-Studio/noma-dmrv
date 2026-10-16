/**
 * PROTOTYPE (throwaway): the view model behind the credit batch page variants.
 *
 * Real inputs come from HEAD (batch, health checks, member runs, sample count).
 * Everything marked PROTOTYPE below is a stub that the `?scenario=` key swaps:
 * lock levels, Removal slices, progress, the header button, Check and Waiting
 * items, and the emission lines (entries are not in HEAD yet).
 */
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
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

export const TABS = ["overview", "production", "emissions", "removals", "traceability", "activity"] as const;
export type TabKey = (typeof TABS)[number];
export const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  production: "Production",
  emissions: "Emissions",
  removals: "Removals",
  traceability: "Traceability",
  activity: "Activity",
};

export const PROGRESS_STEPS = ["Open", "Removal submitted", "Verified", "Credits issued"] as const;
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
  /** Real fix page for a real health check. */
  externalHref?: string;
  /** Which mass segment this item holds back (mass-first variant). */
  affects: MassSegmentKey;
  stub: boolean;
}

export type RemovalStatusKey = "draft" | "submitted" | "verified" | "issued";
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
  kind: "fix" | "start" | "ghg" | "none";
  label: string;
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
  progressIndex: number;
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
  ["D-0031 to Kanyama field", "Applied 2 Sep"],
  ["D-0031 to Kanyama field, second pass", "Applied 4 Sep"],
  ["D-0034 to Mwenda field", "Applied 11 Sep"],
  ["D-0034 to Mwenda field, east block", "Applied 12 Sep"],
] as const;

const R07: RemovalRef = { code: "R-07", status: "submitted", statusNote: "Sent 12 Oct, with the registry" };
const R08: RemovalRef = { code: "R-08", status: "draft", statusNote: "Draft, not sent" };
const R07_ISSUED: RemovalRef = { code: "R-07", status: "issued", statusNote: "Credits issued 3 Nov" };
const R09_ISSUED: RemovalRef = { code: "R-09", status: "issued", statusNote: "Credits issued 3 Nov" };

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
  labSamples: "production",
  productionRuns: "production",
  sourceData: "production",
  creditBatchTemplate: "overview",
  certificationTemplates: "overview",
  templateLineReview: "overview",
  batchDetails: "overview",
  feedstockTypes: "overview",
  biocharProducts: "overview",
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
      return {
        id: `health-${check.key}-${check.issueKey ?? index}`,
        group: "blocking" as const,
        title: check.requirementLabel,
        detail: check.detail?.replace(/^Missing:\s*/i, ""),
        tab: tabForCheck(check),
        actionLabel: fix.label,
        externalHref: fix.href.startsWith("/") ? fix.href : undefined,
        affects: "notIn" as const,
        stub: false,
      };
    });
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
        affects: "notIn",
        stub: true,
      });
    }
    if (samples < SAMPLES_REQUIRED) {
      items.push({
        id: "blk-samples",
        group: "blocking",
        title: `Lab samples: ${samples} of ${SAMPLES_REQUIRED}`,
        detail: "Method B needs at least three replicates.",
        tab: "production",
        rowId: "samples",
        actionLabel: "Add lab sample",
        affects: "notIn",
        stub: true,
      });
    }
  }
  if (scenario !== "issued") {
    items.push({
      id: "chk-sample-outlier",
      group: "check",
      title: "Sample 2 H/Corg sits well above samples 1 and 3",
      detail: "A possible outlier. Confirm it is a real measurement before submitting.",
      tab: "production",
      rowId: "sample-2",
      actionLabel: "Review sample",
      affects: "notIn",
      stub: true,
    });
  }
  const gridLine = emissionLines.find((line) => line.state === "needsReview");
  if (gridLine && scenario !== "issued") {
    items.push({
      id: "chk-grid",
      group: "check",
      title: `${gridLine.name} needs review`,
      detail: "The figure changed after the last review.",
      tab: "emissions",
      rowId: gridLine.id,
      actionLabel: "Review line",
      affects: scenario === "partly-sent" ? "inRemoval" : "notIn",
      stub: true,
    });
  }
  if (scenario === "partly-sent") {
    items.push(
      {
        id: "wait-r07",
        group: "waiting",
        title: "R-07 is with the registry",
        detail: "Review started 14 Oct. Nothing to do until it is verified.",
        tab: "removals",
        rowId: "slice-1",
        actionLabel: "See in Removals",
        affects: "sent",
        stub: true,
      },
      {
        id: "wait-ghg",
        group: "waiting",
        title: "GHG Statement for Q3 is with the verifier",
        detail: "Includes R-07. Submitted 15 Oct.",
        tab: "removals",
        rowId: "ghg",
        actionLabel: "See in Removals",
        affects: "sent",
        stub: true,
      },
    );
  }
  if (scenario !== "issued") {
    items.push({
      id: "wait-unapplied",
      group: "waiting",
      title: "Part of the biochar is not applied yet",
      detail: "It joins a Removal once a delivery records its application.",
      tab: "removals",
      rowId: "not-applied",
      actionLabel: "See in Removals",
      affects: "notApplied",
      stub: true,
    });
  }

  const blocking = items.filter((item) => item.group === "blocking");
  const check = items.filter((item) => item.group === "check");
  const waiting = items.filter((item) => item.group === "waiting");

  const locks: BatchModel["locks"] = {};
  if (scenario === "partly-sent") {
    const reason = "R-07 holds part of this mass.";
    const howTo = "To change it, ask the registry to amend R-07, or withdraw R-07 while it is still unverified.";
    locks.endDate = { reason, howTo, focus: "slice-1" };
    locks.appliedMass = { reason, howTo, focus: "slice-1" };
  }
  if (scenario === "issued") {
    const reason = "Credits are issued for all of this mass.";
    const howTo = "Issued credits cannot be changed here. Ask the registry about a correction.";
    for (const field of ["startDate", "endDate", "appliedMass", "feedstock", "template", "sampling"] as const) {
      locks[field] = { reason, howTo, focus: "slice-1" };
    }
  }

  let primary: PrimaryAction;
  if (blocking.length > 0) {
    primary = { kind: "fix", label: "Fix next item", hint: blocking[0].title };
  } else if (scenario === "issued") {
    // Design call: nothing left to start, so no primary button. The header shows the issued fact.
    primary = { kind: "none", label: "" };
  } else if (masses.notIn > 0) {
    primary = { kind: "start", label: "Start removal", hint: "Adds the mass that is not in a Removal yet." };
  } else {
    primary = { kind: "ghg", label: "Open GHG Statement" };
  }

  const preview = batch.co2eStoredPreview?.co2eStoredTonnes ?? null;
  const removals = [...new Map(slices.flatMap((slice) => (slice.removal ? [[slice.removal.code, slice.removal] as const] : []))).values()];

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
    progressIndex: scenario === "issued" ? 3 : scenario === "partly-sent" ? 1 : 0,
    lockLevel: scenario === "issued" ? "Fully sent" : scenario === "partly-sent" ? "Partly sent" : "Open",
    locks,
    primary,
    removals,
  };
}
