"use client";

/** PROTOTYPE (throwaway): Variant A, "Work queue". Horizontal tabs, open items lead. */
import { cn } from "@/lib/utils";
import { BatchHeader } from "./prototype-header";
import { useProto } from "./prototype-context";
import { DetailsPanel, FedPanel, KeyNumbers, OpenItemGroups, Panel } from "./prototype-parts";
import { TAB_LABELS, TABS } from "./prototype-model";
import { TabBody } from "./prototype-tabs";

export function VariantA() {
  const { tab, go, model } = useProto();
  return (
    <div className="flex flex-col gap-20">
      <BatchHeader />
      <KeyNumbers />
      <div role="tablist" aria-label="Credit batch sections" className="-mx-24 flex overflow-x-auto border-b border-[var(--clr-dark-purple-40)] px-24 sm:mx-0 sm:px-0">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => go(key)}
            className={cn(
              "-mb-px h-44 shrink-0 border-b-2 px-16 body-medium",
              tab === key ? "border-[var(--color-interaction)] font-medium" : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
          >
            {TAB_LABELS[key]}
            {key === "overview" && model.openCount > 0 && <span className="ml-8 inline-flex min-w-20 items-center justify-center bg-[var(--sea)] px-6 body-caption tabular-nums">{model.openCount}</span>}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-20 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="What is still open">
            <OpenItemGroups />
          </Panel>
          <div className="flex flex-col gap-20">
            <FedPanel />
            <DetailsPanel />
          </div>
        </div>
      ) : (
        <TabBody tab={tab} />
      )}
    </div>
  );
}
VariantA.displayName = "VariantA";
