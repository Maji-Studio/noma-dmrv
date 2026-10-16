"use client";

/**
 * PROTOTYPE (throwaway): routed, tabbed credit batch page ("Work queue", variant A
 * of round 1). Horizontal tabs; on Overview the open items lead.
 *
 * URL keys: ?tab=overview|production|emissions|removals|traceability|activity
 *           ?scenario=blocking|clear|partly-sent|issued  ?focus=<rowId>
 * Real: batch, member runs, lab samples, health checks, activity, Removal template.
 * Stub (PROTOTYPE): lock levels, Removal slices, progress, header button, Check and
 * Waiting items, emission lines. See prototype-model.ts.
 */
import { useState } from "react";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { PrototypeSwitcher } from "@/components/ui/prototype-switcher";
import { Notice } from "@/components/ui/notice";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { useBatchDurabilitySummary, useBatchHealth } from "@/hooks/use-certification";
import { useCreditBatchProductionRunOptions } from "@/hooks/use-credit-batches";
import { cn } from "@/lib/utils";
import { ProtoProvider, useProto } from "./prototype-context";
import { BatchHeader, KeyNumbers } from "./prototype-header";
import { buildBatchModel, SCENARIOS, TAB_LABELS, TABS, type Scenario } from "./prototype-model";
import { DetailsPanel, FedPanel, OpenItemGroups, Panel } from "./prototype-parts";
import { TabBody } from "./prototype-tabs";

const SCENARIO_NOTES: Record<Scenario, string> = {
  blocking: "Open items present, nothing sent.",
  clear: "Ready. Applied mass waits for a Removal.",
  "partly-sent": "R-07 sent with part of the mass. End date and mass locked.",
  issued: "All mass in Removals, credits issued.",
};

/** The switcher cycles scenarios; there is one layout now. */
const SWITCHER_ITEMS = SCENARIOS.map((key) => ({ key, name: SCENARIO_NOTES[key] }));

function BatchTabs() {
  const { tab, go, model } = useProto();
  return (
    <div role="tablist" aria-label="Credit batch sections" className="-mx-20 flex overflow-x-auto border-b border-[var(--color-border-secondary)] px-20 sm:mx-0 sm:px-0">
      {TABS.map((key) => (
        <button
          key={key}
          role="tab"
          type="button"
          aria-selected={tab === key}
          onClick={() => go(key)}
          className={cn(
            "-mb-px inline-flex h-44 shrink-0 items-center gap-8 border-b-2 px-16 body-medium first:pl-0 sm:first:pl-16",
            tab === key ? "border-[var(--ink)] font-medium" : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
          )}
        >
          {TAB_LABELS[key]}
          {key === "overview" && model.openCount > 0 && (
            <span className={cn("inline-flex min-w-20 items-center justify-center rounded-full px-6 body-caption font-medium tabular-nums", model.blocking.length > 0 ? "bg-[var(--st-bad)] text-white" : "bg-[var(--sea)]")}>
              {model.openCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function Overview() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-24 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Open items">
        <OpenItemGroups />
      </Panel>
      <div className="flex flex-col gap-24">
        <FedPanel />
        <DetailsPanel />
      </div>
    </div>
  );
}

function Message() {
  const { message } = useProto();
  if (!message) return null;
  return <Notice tone="info">{message}</Notice>;
}

export function PrototypeBatchPage({ batch, canManage }: { batch: CreditBatchWithRelations; canManage: boolean }) {
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("overview").withOptions({ shallow: true, history: "replace" }));
  const [focus, setFocus] = useQueryState("focus", parseAsString.withOptions({ shallow: true, history: "replace" }));
  const [scenario] = useQueryState("scenario", parseAsStringLiteral(SCENARIOS).withDefault("blocking"));
  const [message, setMessage] = useState<string | null>(null);

  const health = useBatchHealth(batch.id);
  const durability = useBatchDurabilitySummary(batch.id);
  const runsQuery = useCreditBatchProductionRunOptions({
    facilityId: batch.facilityId,
    startDate: batch.startDate,
    endDate: batch.endDate,
    includeCreditBatchId: batch.id,
  });

  const model = buildBatchModel({ batch, health: health.data, realSampleCount: durability.data?.sampleCount, scenario });

  const value = {
    batch,
    model,
    canManage,
    tab,
    focus,
    go: (next: (typeof TABS)[number], row?: string | null) => {
      void setTab(next);
      void setFocus(row ?? null);
      setMessage(null);
    },
    runs: runsQuery.data ?? [],
    runsLoading: runsQuery.isLoading,
    message,
    say: setMessage,
  };

  return (
    <ProtoProvider value={value}>
      <div className="container-max page-shell min-w-0 pb-[240px] sm:pb-[160px]">
        <BatchHeader />
        <KeyNumbers />
        <div className="flex flex-col gap-24">
          <BatchTabs />
          <Message />
          {tab === "overview" ? <Overview /> : <TabBody tab={tab} />}
        </div>
      </div>
      <PrototypeSwitcher variants={SWITCHER_ITEMS} param="scenario" title="Batch page">
        <ul className="list-disc pl-16">
          <li>Lock level: {model.lockLevel}</li>
          <li>Header button: {model.primary.kind === "none" ? "none" : model.primary.label}</li>
          <li>Open: {model.blocking.length} blocking, {model.check.length} check, {model.waiting.length} waiting</li>
          <li>Real: batch, runs, samples, health, activity. Stub: locks, slices, progress, emissions.</li>
        </ul>
      </PrototypeSwitcher>
    </ProtoProvider>
  );
}
PrototypeBatchPage.displayName = "PrototypeBatchPage";
