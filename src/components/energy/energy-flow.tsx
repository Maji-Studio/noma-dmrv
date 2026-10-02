/**
 * EnergyFlow: the Sankey over the period, with credit batches capped so long
 * histories stay readable, beside the activity panel for the selection.
 * Without emission factors there are no CO2e bands to draw, so the chart
 * gives way to a notice and the panel still shows recorded activity.
 */
"use client";

import { useState } from "react";
import { FlowArrowIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, Notice } from "@/components/ui";
import { formatCount } from "@/lib/copy-utils";
import {
  OTHER_BATCHES_KEY,
  UNASSIGNED_BATCH_KEY,
  groupSankeyBatches,
  layoutSankey,
  sankeyScale,
} from "@/lib/energy/sankey";
import { totalsBySource } from "@/lib/energy/selection";
import type {
  EnergyCreditBatchInput,
  EnergyFlow as EnergyFlowItem,
  EnergyGap,
} from "@/lib/energy/types";
import { formatDateRange } from "@/lib/format-utils";
import { EnergyActivityPanel } from "./energy-activity-panel";
import { EnergySankey } from "./energy-sankey";

const UNASSIGNED_LABEL = "Not in a credit batch";
const READOUT_HINT = "Hover or focus a flow or a bar to read its estimated CO₂e.";
const CHART_MIN_WIDTH_CLASS = "min-w-[640px]";

interface EnergyFlowProps {
  /** Every flow in the period, all credit batches. */
  flows: EnergyFlowItem[];
  /** The same, narrowed to the selected credit batch. */
  scopedFlows: EnergyFlowItem[];
  scopedGaps: EnergyGap[];
  creditBatches: EnergyCreditBatchInput[];
  selectedBatch: EnergyCreditBatchInput | null;
  periodText: string;
  hasFactors: boolean;
  onSelectBatch: (batchId: string | null) => void;
}

export function EnergyFlow({
  flows,
  scopedFlows,
  scopedGaps,
  creditBatches,
  selectedBatch,
  periodText,
  hasFactors,
  onSelectBatch,
}: EnergyFlowProps) {
  const [readout, setReadout] = useState<string | null>(null);
  const selectedId = selectedBatch?.id ?? null;
  const grouped = groupSankeyBatches(flows, creditBatches, selectedId);
  const keys = grouped.nodes.map((node) => node.key);
  const layout = layoutSankey(grouped.flows, keys, sankeyScale(grouped.flows, keys));
  const batchLabel = (key: string) => {
    if (key === UNASSIGNED_BATCH_KEY) return UNASSIGNED_LABEL;
    const node = grouped.nodes.find((n) => n.key === key);
    if (key === OTHER_BATCHES_KEY) {
      return `${formatCount(node?.groupedCount ?? 0, "other credit batch", "other credit batches")}`;
    }
    return node?.code ?? key;
  };
  const isGrouped = grouped.nodes.some((node) => node.key === OTHER_BATCHES_KEY);

  return (
    <div className="flex flex-col gap-24 lg:flex-row lg:items-start">
      <section
        aria-label="Energy flow"
        className="flex min-w-0 flex-1 flex-col gap-12 bg-[var(--panel-bg)] p-20 [border:var(--panel-border)]"
      >
        <div className="flex flex-col gap-4">
          <h2 className="title-heading-3">Where the energy goes</h2>
          {hasFactors && (
            <p className="body-caption text-[var(--color-text-secondary)]">
              {isGrouped
                ? "The five largest credit batches are named; the rest are grouped. "
                : ""}
              Select a credit batch to focus the totals.
            </p>
          )}
        </div>
        {!hasFactors ? (
          <Notice tone="info">
            The flow is drawn in estimated CO₂e, so it needs this facility&apos;s
            emission factors. The activity totals beside it are recorded values.
          </Notice>
        ) : grouped.flows.length === 0 ? (
          <EmptyState
            icon={<FlowArrowIcon size={32} />}
            title="No estimated emissions in this period"
            description="Choose a longer period to see where the energy goes."
            padding="sm"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className={CHART_MIN_WIDTH_CLASS}>
                <EnergySankey
                  layout={layout}
                  selectedBatchKey={selectedId}
                  batchLabel={batchLabel}
                  onHover={setReadout}
                  onSelectBatch={(key) => onSelectBatch(key === selectedId ? null : key)}
                />
              </div>
            </div>
            <p
              aria-live="polite"
              className="body-caption min-h-[20px] text-[var(--color-text-secondary)]"
            >
              {readout ?? READOUT_HINT}
            </p>
          </>
        )}
      </section>
      <div className="lg:w-[320px] lg:shrink-0">
        <EnergyActivityPanel
          title={selectedBatch ? selectedBatch.code : "Whole facility"}
          caption={
            selectedBatch
              ? `Produced ${formatDateRange(selectedBatch.startDate, selectedBatch.endDate)}. Counted within ${periodText}.`
              : periodText
          }
          totals={totalsBySource(scopedFlows, scopedGaps, hasFactors)}
          hasFactors={hasFactors}
        />
      </div>
    </div>
  );
}
