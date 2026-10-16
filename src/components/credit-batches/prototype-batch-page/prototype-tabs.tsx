"use client";

/** PROTOTYPE (throwaway): the four non-overview tab bodies, shared by all variants. */
import Link from "next/link";
import { FlaskIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { computeCohortInputTotals } from "@/components/credit-batches/cohort-input-ledger";
import { CreditBatchDurabilityPanel } from "@/components/credit-batches/credit-batch-durability-panel";
import { CreditBatchActivityView } from "@/components/activity";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { EMISSION_LINE_STATE_LABELS, type EmissionLineState } from "@/lib/certification/emission-lines";
import { productionRunDeepLinkHref } from "@/lib/certification/links";
import { useProto } from "./prototype-context";
import { RemovalMassBar, SEGMENTS, SEGMENT_BY_KEY, Swatch, segmentOfRemoval } from "./prototype-mass-bar";
import { FocusRow, PANEL, Panel, RemovalChip, tonnes } from "./prototype-parts";

const MUTED = "text-[var(--color-text-secondary)]";

const KG_PER_TONNE = 1000;
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_88px_88px] gap-x-12 sm:grid-cols-[minmax(0,1fr)_140px_140px] sm:gap-x-16";

function kgAsTonnes(kg: number | null): string {
  return kg == null ? MISSING_VALUE.notRecorded : tonnes(kg / KG_PER_TONNE);
}

export function ProductionTab() {
  const { batch, runs, runsLoading } = useProto();
  const memberIds = new Set(batch.productionRunIds);
  const members = runs.filter((run) => memberIds.has(run.id));
  const totals = computeCohortInputTotals(members);
  return (
    <Panel title="Production runs" action={<span className={cn("body-small", MUTED)}>{batch.productionRunCount} in this batch</span>}>
      {runsLoading ? (
        <p className={cn("body-small", MUTED)} aria-busy>Loading production runs...</p>
      ) : members.length === 0 ? (
        <EmptyState padding="sm" icon={<FlaskIcon size={32} weight="thin" />} title="No production runs linked" description="Completed runs in this credit batch's window join automatically." />
      ) : (
        <div className="relative">
          <div className={cn(COLUMNS, "border-b border-[var(--color-border-secondary)] pb-8 body-caption", MUTED)}>
            <span>Run</span>
            <span className="text-right">Feedstock dry mass</span>
            <span className="text-right">Dry biochar</span>
          </div>
          <ul className="flex flex-col">
            {members.map((run) => (
              <li key={run.id} className={cn(COLUMNS, "items-center border-t border-[var(--color-border-tertiary)] py-10 first:border-t-0")}>
                <Link href={productionRunDeepLinkHref(run.id, batch.facilityId)} className="flex min-w-0 flex-col underline-offset-2 hover:underline">
                  <span className="body-medium font-medium">{run.code} on {formatDate(run.date)}</span>
                  <span className={cn("body-caption", MUTED)}>{run.biocharStorageName ?? MISSING_VALUE.notRecorded}</span>
                </Link>
                <span className="body-small text-right tabular-nums">{kgAsTonnes(run.feedstockMassDryKg)}</span>
                <span className="body-small text-right tabular-nums">{kgAsTonnes(run.biocharDryMassKg)}</span>
              </li>
            ))}
          </ul>
          <div className={cn(COLUMNS, "border-t border-[var(--color-border-secondary)] pt-10 body-medium font-medium")}>
            <span>Total</span>
            <span className="text-right tabular-nums">{kgAsTonnes(totals.feedstockDryKg)}</span>
            <span className="text-right tabular-nums">{kgAsTonnes(totals.dryOutputKg)}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function SamplesTab() {
  const { batch } = useProto();
  // The real Samples block brings its own heading and one add action.
  return (
    <FocusRow rowId="samples" className={cn(PANEL, "p-20 sm:p-24 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0")}>
      <CreditBatchDurabilityPanel creditBatchId={batch.id} facilityId={batch.facilityId} />
    </FocusRow>
  );
}

const LINE_TONE: Record<EmissionLineState, string> = {
  filled: "text-[var(--st-ok)]",
  confirmedZero: "text-[var(--st-ok)]",
  empty: "text-[var(--st-bad)]",
  missingEvidence: "text-[var(--st-bad)]",
  needsSetup: "text-[var(--st-bad)]",
  needsReview: "text-[var(--st-wait)]",
};

export function EmissionsTab() {
  const { model, say, batch, runs } = useProto();
  // Diesel and electricity come from the real production runs; the stub figure is the fallback.
  const memberIds = new Set(batch.productionRunIds);
  const members = runs.filter((run) => memberIds.has(run.id));
  const totals = computeCohortInputTotals(members);
  const fromRuns = `From ${members.length} production ${members.length === 1 ? "run" : "runs"}`;
  const realFigures: Record<string, { figure: string; caption: string } | null> = {
    "em-diesel": totals.dieselLiters == null ? null : { figure: `${Math.round(totals.dieselLiters).toLocaleString()} L`, caption: fromRuns },
    "em-grid": totals.electricityKwh == null ? null : { figure: `${Math.round(totals.electricityKwh).toLocaleString()} kWh`, caption: fromRuns },
  };
  return (
    <Panel
      title="Emission lines"
      action={
        <Button variant="weak" size="small" onClick={() => say("Prototype: opens the emission entry form.")}>
          <PlusIcon size={14} aria-hidden />
          Add emission entry
        </Button>
      }
    >
      <p className={cn("body-small", MUTED)}>One line per component of the Removal template. Entries are stubbed in this prototype.</p>
      <ul className="flex flex-col">
        {model.emissionLines.map((rawLine) => {
          const real = realFigures[rawLine.id];
          const line = real ? { ...rawLine, figure: real.figure } : rawLine;
          return (
          <li key={line.id} className="border-t border-[var(--color-border-tertiary)] first:border-t-0">
            <FocusRow rowId={line.id} className="flex flex-col gap-4 py-12 sm:flex-row sm:items-center sm:justify-between sm:gap-16">
              <div className="flex min-w-0 flex-col">
                <span className="body-medium font-medium">{line.name}</span>
                <span className={cn("body-caption", MUTED)}>{line.figure ?? "No figure yet"}{real ? `. ${real.caption}` : ""}</span>
              </div>
              <div className="flex items-center gap-12">
                <span className={cn("body-small font-medium", LINE_TONE[line.state])}>{EMISSION_LINE_STATE_LABELS[line.state]}</span>
                {line.state !== "filled" && line.state !== "confirmedZero" && (
                  <Button variant="weak" size="small" onClick={() => say("Prototype: opens this line.")}>
                    {line.state === "needsReview" ? "Review" : line.state === "needsSetup" ? "Set up" : "Fix"}
                  </Button>
                )}
              </div>
            </FocusRow>
          </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function MassSplit() {
  const { model, go } = useProto();
  const { masses } = model;
  const total = SEGMENTS.reduce((sum, segment) => sum + masses[segment.key], 0);
  return (
    <Panel title="Biochar in Removals" action={<span className="body-medium tabular-nums">{tonnes(total)} <span className={MUTED}>total</span></span>}>
      <RemovalMassBar />
      {model.blocking.length > 0 && (
        <button type="button" onClick={() => go("overview")} className="self-start body-small underline underline-offset-2">
          See blocking items ({model.blocking.length})
        </button>
      )}
    </Panel>
  );
}

export function RemovalsTab() {
  const { model } = useProto();
  const { masses } = model;
  const orderedSlices = [...model.slices].sort((a, b) => SEGMENT_BY_KEY[segmentOfRemoval(a.removal)].order - SEGMENT_BY_KEY[segmentOfRemoval(b.removal)].order);
  return (
    <div className="flex flex-col gap-20">
      <MassSplit />
      <Panel title="Applied biochar by delivery">
        <ul className="flex flex-col">
          {orderedSlices.map((slice) => (
            <li key={slice.id} className="border-t border-[var(--color-border-tertiary)] first:border-t-0">
              <FocusRow rowId={slice.id} className="grid grid-cols-[12px_minmax(0,1fr)_auto] gap-x-12 gap-y-4 py-12 sm:grid-cols-[12px_1fr_auto_220px] sm:items-center sm:gap-x-16">
                <Swatch segment={segmentOfRemoval(slice.removal)} />
                <div className="flex min-w-0 flex-col">
                  <span className="body-medium font-medium">{slice.label}</span>
                  <span className={cn("body-caption", MUTED)}>{slice.meta}</span>
                </div>
                <span className="body-medium tabular-nums">{tonnes(slice.tons)}</span>
                <div className="col-start-2 col-end-4 flex flex-col gap-2 sm:col-auto">
                  <RemovalChip removal={slice.removal} />
                  {slice.removal && <span className={cn("body-caption", MUTED)}>{slice.removal.statusNote}</span>}
                </div>
              </FocusRow>
            </li>
          ))}
        </ul>
        <FocusRow rowId="not-applied" className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-12 border-t border-[var(--color-border-tertiary)] pt-12 sm:gap-x-16">
          <Swatch segment="notApplied" />
          <span className="flex flex-col">
            <span className="body-medium font-medium">Not applied yet</span>
            <span className={cn("body-caption", MUTED)}>Produced in this credit batch, no application recorded</span>
          </span>
          <span className="body-medium tabular-nums">{tonnes(masses.notApplied)}</span>
        </FocusRow>
      </Panel>
      <FocusRow rowId="ghg">
        <Panel title="GHG Statement">
          {model.scenario === "blocking" || model.scenario === "clear" ? (
            <p className={cn("body-small", MUTED)}>No Removal is submitted yet, so no GHG Statement includes this credit batch.</p>
          ) : (
            <div className="flex items-center justify-between gap-12">
              <div className="flex flex-col">
                <span className="body-medium font-medium">GHG Statement Q3</span>
                <span className={cn("body-caption", MUTED)}>Includes {model.removals.filter((r) => r.status === "submitted").map((r) => r.code).join(" and ")}</span>
              </div>
              <StatusBadge status={model.scenario === "issued" ? "issued" : "pending"} label={model.scenario === "issued" ? "Issued" : "In verification"} />
            </div>
          )}
        </Panel>
      </FocusRow>
    </div>
  );
}

export function ActivityTab() {
  const { batch } = useProto();
  return <CreditBatchActivityView creditBatchId={batch.id} batchCode={batch.code} inline />;
}

export function TabBody({ tab }: { tab: string }) {
  switch (tab) {
    case "production": return <ProductionTab />;
    case "samples": return <SamplesTab />;
    case "emissions": return <EmissionsTab />;
    case "removals": return <RemovalsTab />;
    case "activities": return <ActivityTab />;
    default: return null;
  }
}
