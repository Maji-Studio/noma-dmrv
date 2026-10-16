"use client";

/**
 * PROTOTYPE (throwaway): routed, tabbed credit batch page, three layout variants.
 *
 * URL keys: ?variant=A|B|C  ?tab=overview|production|emissions|removals|traceability|activity
 *           ?scenario=blocking|clear|partly-sent|issued  ?focus=<rowId>
 * Real: batch, member runs, lab samples, health checks, activity, Removal template.
 * Stub (PROTOTYPE): lock levels, Removal slices, progress, header button, Check and
 * Waiting items, emission lines. See prototype-model.ts.
 */
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { PrototypeSwitcher, resolveVariant } from "@/components/ui/prototype-switcher";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { useBatchDurabilitySummary, useBatchHealth } from "@/hooks/use-certification";
import { useCreditBatchProductionRunOptions } from "@/hooks/use-credit-batches";
import { cn } from "@/lib/utils";
import { ProtoProvider } from "./prototype-context";
import { buildBatchModel, SCENARIOS, TABS, type Scenario } from "./prototype-model";
import { VariantA } from "./prototype-variant-a";
import { VariantB } from "./prototype-variant-b";
import { VariantC } from "./prototype-variant-c";

const VARIANTS = [
  { key: "A", name: "Work queue" },
  { key: "B", name: "Rail" },
  { key: "C", name: "Mass first" },
] as const;

const SCENARIO_NOTES: Record<Scenario, string> = {
  blocking: "Open items present, nothing sent.",
  clear: "Ready. Applied mass waits for a Removal.",
  "partly-sent": "R-07 sent with part of the mass. End date and mass locked.",
  issued: "All mass in Removals, credits issued.",
};

export function PrototypeBatchPage({ batch, canManage }: { batch: CreditBatchWithRelations; canManage: boolean }) {
  const searchParams = useSearchParams();
  const variant = resolveVariant(VARIANTS, searchParams.get("variant"));
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("overview").withOptions({ shallow: true, history: "replace" }));
  const [focus, setFocus] = useQueryState("focus", parseAsString.withOptions({ shallow: true, history: "replace" }));
  const [scenario, setScenario] = useQueryState("scenario", parseAsStringLiteral(SCENARIOS).withDefault("blocking").withOptions({ shallow: true, history: "replace" }));
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
    say: setMessage,
  };

  return (
    <ProtoProvider value={value}>
      <div className="container-max page-shell min-w-0 pb-[240px] sm:pb-[160px]">
        {message && (
          <p role="status" className="border border-[var(--st-run)] bg-[var(--st-run-bg)] px-16 py-10 body-small">
            {message}
          </p>
        )}
        {variant.key === "A" && <VariantA />}
        {variant.key === "B" && <VariantB />}
        {variant.key === "C" && <VariantC />}
      </div>
      <PrototypeSwitcher variants={VARIANTS} title="Batch page">
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap gap-4" role="group" aria-label="Scenario">
            {SCENARIOS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={scenario === key}
                onClick={() => void setScenario(key)}
                className={cn("border border-[var(--paper)] px-8 py-4", scenario === key ? "bg-[var(--paper)] text-[var(--ink)]" : "hover:bg-[var(--clr-dark-purple-80)]")}
              >
                {key}
              </button>
            ))}
          </div>
          <p>{SCENARIO_NOTES[scenario]}</p>
          <ul className="list-disc pl-16">
            <li>Lock level: {model.lockLevel}</li>
            <li>Header button: {model.primary.kind === "none" ? "none" : model.primary.label}</li>
            <li>Open: {model.blocking.length} blocking, {model.check.length} check, {model.waiting.length} waiting</li>
            <li>Real: batch, runs, samples, health, activity. Stub: locks, slices, progress, emissions.</li>
          </ul>
        </div>
      </PrototypeSwitcher>
    </ProtoProvider>
  );
}
PrototypeBatchPage.displayName = "PrototypeBatchPage";
