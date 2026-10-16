"use client";

/** PROTOTYPE (throwaway): the four non-overview tab bodies, shared by all variants. */
import Link from "next/link";
import { FlaskIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { CohortInputLedger } from "@/components/credit-batches/cohort-input-ledger";
import { CreditBatchDurabilityPanel } from "@/components/credit-batches/credit-batch-durability-panel";
import { CreditBatchActivityView } from "@/components/activity";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatTonnes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { EMISSION_LINE_STATE_LABELS, type EmissionLineState } from "@/lib/certification/emission-lines";
import { productionRunDeepLinkHref } from "@/lib/certification/links";
import { useProto } from "./prototype-context";
import { FocusRow, PANEL, Panel, RemovalChip, tonnes } from "./prototype-parts";

const MUTED = "text-[var(--color-text-secondary)]";

export function ProductionTab() {
  const { batch, runs, runsLoading, model } = useProto();
  const memberIds = new Set(batch.productionRunIds);
  const members = runs.filter((run) => memberIds.has(run.id));
  return (
    <div className="flex flex-col gap-20">
      <Panel title="Production runs" action={<span className={cn("body-small", MUTED)}>{batch.productionRunCount} in this batch</span>}>
        {runsLoading ? (
          <p className={cn("body-small", MUTED)} aria-busy>Loading production runs...</p>
        ) : members.length === 0 ? (
          <EmptyState padding="sm" icon={<FlaskIcon size={32} weight="thin" />} title="No production runs linked" description="Completed runs in this credit batch's window join automatically." />
        ) : (
          <ul className="flex flex-col">
            {members.map((run) => (
              <li key={run.id} className="flex items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] py-10 first:border-t-0">
                <Link href={productionRunDeepLinkHref(run.id, batch.facilityId)} className="flex min-w-0 flex-col underline-offset-2 hover:underline">
                  <span className="body-medium font-medium">{run.code} on {formatDate(run.date)}</span>
                  <span className={cn("body-caption", MUTED)}>{run.biocharStorageName ?? "Not recorded"}</span>
                </Link>
                <span className="body-small tabular-nums">{run.biocharDryMassKg != null ? `${tonnes(run.biocharDryMassKg / 1000)} dry` : "Not recorded"}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Mass balance and inputs">
        <CohortInputLedger runs={members} />
        <p className={cn("body-small", MUTED)}>
          Carbon estimate before project emissions: <span className="font-medium text-[var(--color-text-primary)]">{"≈"} {formatTonnes(model.co2eTons ?? 0, { unit: "t CO₂e" })}</span>
        </p>
      </Panel>
      {/* The real Samples block brings its own heading and one add action; the sheet's top rule is dropped here. */}
      <FocusRow rowId="samples" className={cn(PANEL, "p-20 sm:p-24 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0")}>
        <CreditBatchDurabilityPanel creditBatchId={batch.id} facilityId={batch.facilityId} />
      </FocusRow>
    </div>
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
  const { model, say } = useProto();
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
        {model.emissionLines.map((line) => (
          <li key={line.id} className="border-t border-[var(--color-border-tertiary)] first:border-t-0">
            <FocusRow rowId={line.id} className="flex flex-col gap-4 py-12 sm:flex-row sm:items-center sm:justify-between sm:gap-16">
              <div className="flex min-w-0 flex-col">
                <span className="body-medium font-medium">{line.name}</span>
                <span className={cn("body-caption", MUTED)}>{line.figure ?? "No figure yet"}</span>
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
        ))}
      </ul>
    </Panel>
  );
}

export function RemovalsTab() {
  const { model, go } = useProto();
  const { masses } = model;
  return (
    <div className="flex flex-col gap-20">
      <Panel title="Applied biochar by delivery">
        <ul className="flex flex-col">
          {model.slices.map((slice) => (
            <li key={slice.id} className="border-t border-[var(--color-border-tertiary)] first:border-t-0">
              <FocusRow rowId={slice.id} className="grid gap-4 py-12 sm:grid-cols-[1fr_auto_220px] sm:items-center sm:gap-16">
                <div className="flex min-w-0 flex-col">
                  <span className="body-medium font-medium">{slice.label}</span>
                  <span className={cn("body-caption", MUTED)}>{slice.meta}</span>
                </div>
                <span className="body-medium tabular-nums">{tonnes(slice.tons)}</span>
                <div className="flex flex-col gap-2">
                  <RemovalChip removal={slice.removal} />
                  {slice.removal && <span className={cn("body-caption", MUTED)}>{slice.removal.statusNote}</span>}
                </div>
              </FocusRow>
            </li>
          ))}
        </ul>
        <FocusRow rowId="not-applied" className="flex items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] pt-12">
          <span className="flex flex-col">
            <span className="body-medium font-medium">Not applied yet</span>
            <span className={cn("body-caption", MUTED)}>Produced in this credit batch, no application recorded</span>
          </span>
          <span className="body-medium tabular-nums">{tonnes(masses.notApplied)}</span>
        </FocusRow>
      </Panel>
      <Panel title="Not in a Removal">
        <p className="body-medium">
          <span className="font-medium tabular-nums">{tonnes(masses.notIn)}</span> of applied biochar is not in a Removal.
        </p>
        <p className={cn("body-small", MUTED)}>
          {model.blocking.length > 0
            ? `${model.blocking.length} blocking ${model.blocking.length === 1 ? "item holds" : "items hold"} it back.`
            : masses.notIn > 0
              ? "Nothing blocks it. Select Start Removal."
              : "Every applied tonne is in a Removal."}
        </p>
        {model.blocking.length > 0 && (
          <Button variant="default" size="small" className="self-start" onClick={() => go("overview")}>See blocking items</Button>
        )}
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
    case "emissions": return <EmissionsTab />;
    case "removals": return <RemovalsTab />;
    case "activity": return <ActivityTab />;
    default: return null;
  }
}
