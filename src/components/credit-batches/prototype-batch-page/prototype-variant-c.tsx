"use client";

/** PROTOTYPE (throwaway): Variant C, "Mass first". Overview is one bar of applied mass. */
import { cn } from "@/lib/utils";
import { BatchHeader } from "./prototype-header";
import { useProto } from "./prototype-context";
import { DetailsPanel, FedPanel, KeyNumbers, OpenItemRow, Panel, tonnes } from "./prototype-parts";
import { TAB_LABELS, TABS, type MassSegmentKey } from "./prototype-model";
import { TabBody } from "./prototype-tabs";

const SEGMENTS: { key: MassSegmentKey; label: string; fill: string; hint: string }[] = [
  { key: "sent", label: "In a sent Removal", fill: "bg-[var(--st-ok)]", hint: "With the registry or issued" },
  { key: "inRemoval", label: "In a Removal, not sent", fill: "bg-[var(--st-run)]", hint: "Draft Removals" },
  { key: "notIn", label: "Not in a Removal", fill: "bg-[var(--st-wait)]", hint: "Applied, waiting for a Removal" },
  { key: "notApplied", label: "Not yet applied", fill: "bg-[var(--st-off-bg)]", hint: "Produced, no application yet" },
];

export function VariantC() {
  const { tab, go, model } = useProto();
  const total = SEGMENTS.reduce((sum, s) => sum + model.masses[s.key], 0) || 1;
  return (
    <div className="flex flex-col gap-20">
      <BatchHeader />
      <div role="tablist" aria-label="Credit batch sections" className="flex self-start overflow-x-auto border border-[var(--clr-dark-purple-40)] bg-[var(--paper)] max-w-full">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => go(key)}
            className={cn(
              "h-40 shrink-0 border-l border-[var(--color-border-tertiary)] px-16 body-small first:border-l-0",
              tab === key ? "bg-[var(--ink)] font-medium text-[var(--paper)]" : "hover:bg-[var(--sea)]",
            )}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <>
          <KeyNumbers />
          <Panel title={`${tonnes(model.appliedTons)} applied`}>
            <div className="flex flex-col gap-4">
              <div role="img" aria-label={SEGMENTS.map((s) => `${s.label} ${tonnes(model.masses[s.key])}`).join(", ")} className="flex h-40 w-full overflow-hidden border border-[var(--clr-dark-purple-40)]">
                {SEGMENTS.filter((s) => model.masses[s.key] > 0).map((s) => (
                  <div key={s.key} className={cn("h-full border-l border-[var(--paper)] first:border-l-0", s.fill)} style={{ width: `${(model.masses[s.key] / total) * 100}%` }} />
                ))}
              </div>
            </div>
            <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-4">
              {SEGMENTS.map((s) => {
                const items = model.items.filter((item) => item.affects === s.key);
                return (
                  <div key={s.key} className="flex flex-col gap-8 border-t border-[var(--color-border-tertiary)] py-16 md:border-l md:px-16 md:first:border-l-0 xl:border-t-0 xl:py-0 xl:first:pl-0 md:odd:border-l-0 xl:odd:border-l">
                    <div className="flex items-start gap-8">
                      <span className={cn("mt-4 size-12 shrink-0 border border-[var(--color-border-secondary)]", s.fill)} aria-hidden />
                      <div className="flex flex-col">
                        <span className="body-small font-medium">{s.label}</span>
                        <span className="title-heading-3 tabular-nums">{tonnes(model.masses[s.key])}</span>
                        <span className="body-caption text-[var(--color-text-secondary)]">{s.hint}</span>
                      </div>
                    </div>
                    {items.length === 0 ? (
                      <p className="body-caption text-[var(--color-text-secondary)]">Nothing holds this back.</p>
                    ) : (
                      <ul className="flex flex-col">
                        {items.map((item) => (
                          <OpenItemRow key={item.id} item={item} compact />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
          <div className="grid gap-20 lg:grid-cols-[minmax(0,1fr)_340px]">
            <DetailsPanel />
            <div className="flex flex-col gap-20">
              <FedPanel />
            </div>
          </div>
        </>
      ) : (
        <TabBody tab={tab} />
      )}
    </div>
  );
}
VariantC.displayName = "VariantC";
