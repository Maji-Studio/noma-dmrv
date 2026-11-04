/**
 * The Flow view: one quantity at a time (Feedstock, Delivery, Diesel,
 * Electricity), the chart, and under it the numbers of the lit node as an
 * aligned list. Hint A marks a delivery a page carries only partly used, and
 * "Counted on" rows list the deliveries a page drew from but does not carry.
 */
"use client";

import { useState } from "react";
import { ChartBarIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { AllocationRecord, EmissionAllocation } from "@/types/emission-allocation";
import { HintMarker } from "./allocation-hint";
import { STREAMS, buildGraph, firstStreamWithData, type Graph, type GraphNode, type Stream, type StreamKey } from "./allocation-flow-graph";
import { FlowChart } from "./allocation-flow-chart";
import { formatKg, formatNumber, recordLine, recordName } from "./allocation-format";
import {
  NOT_YET_LABEL,
  NOT_YET_OWNER,
  batchCodesOf,
  basisFor,
  batchOwners,
  feedstockHint,
  fractionFor,
  percentFor,
  removalNotYet,
  removalOwners,
  type FeedstockHint,
  type Focus,
  type Owner,
} from "./allocation-model";
import { MUTED, SegmentGroup } from "./allocation-parts";

const EMPTY_ICON_PX = 32;

interface DetailRow {
  key: string;
  name: string;
  sub?: string;
  percent?: number;
  /** Null when the record has no recorded figure in this quantity. */
  value: number | null;
  hint?: FeedstockHint;
}

function basisText(record: AllocationRecord, owner: Owner): string {
  return basisFor(record, owner).map((basis) => basis.label).join(", ");
}

function detailRows(graph: Graph, node: GraphNode, stream: Stream, codes: ReadonlyMap<string, string>): DetailRow[] {
  const batchColumn = [...graph.batches, NOT_YET_OWNER];
  if (node.kind === "record" && node.record) {
    const record = node.record;
    const carried = batchColumn
      .map((owner) => ({ owner, fraction: fractionFor(record, owner) }))
      .filter((row) => row.fraction > 0)
      .map(({ owner, fraction }) => ({
        key: owner.key,
        name: owner.notYet ? NOT_YET_LABEL : owner.label,
        sub: basisText(record, owner),
        percent: percentFor(record, owner, batchColumn),
        value: node.value * fraction,
      }));
    // Batches whose runs drew from the delivery but carry none of it.
    const counted = graph.batches.flatMap((owner) => {
      const hint = feedstockHint(record, owner, graph.batches, codes);
      return hint?.kind === "countedOn" ? [{ key: owner.key, name: owner.label, sub: `Used ${formatKg(hint.usedKg)}`, percent: 0, value: 0, hint }] : [];
    });
    return [...carried, ...counted];
  }
  const owner = node.kind === "notYet" ? NOT_YET_OWNER : node.owner;
  if (!owner) return [];
  const labelOwners = node.kind === "removal" ? graph.removals : graph.batches;
  const columnOwners = node.kind === "removal" ? [...graph.removals, NOT_YET_OWNER] : batchColumn;
  const records = graph.nodes.flatMap((candidate) => (candidate.kind === "record" && candidate.record ? [candidate.record] : []));
  const carried = records
    .filter((record) => fractionFor(record, owner) > 0)
    .map((record) => ({
      key: record.id,
      name: recordName(record),
      sub: recordLine(record),
      percent: percentFor(record, owner, columnOwners),
      value: (stream.pick(record) ?? 0) * fractionFor(record, owner),
      hint: feedstockHint(record, owner, labelOwners, codes) ?? undefined,
    }));
  const counted = records.flatMap((record) => {
    const hint = feedstockHint(record, owner, labelOwners, codes);
    return hint?.kind === "countedOn" ? [{ key: record.id, name: recordName(record), sub: recordLine(record), percent: 0, value: 0, hint }] : [];
  });
  return [...carried, ...counted];
}

function DetailList({ graph, node, stream, codes, onOpenTable }: { graph: Graph; node: GraphNode; stream: Stream; codes: ReadonlyMap<string, string>; onOpenTable: () => void }) {
  const rows = detailRows(graph, node, stream, codes);
  const viewer = node.owner && node.kind !== "notYet" ? node.owner : undefined;
  const removal = node.kind === "batch" ? graph.removals.find((candidate) => candidate.members.includes(node.key)) : undefined;
  const sub =
    node.kind === "record" && node.record ? recordLine(node.record) :
    node.kind === "removal" ? `From ${node.owner?.sub}` :
    node.kind === "batch" ? (removal ? `In ${removal.label}` : "Not in a Removal yet") :
    "Nothing used it yet";
  return (
    <div className="flex min-w-0 flex-col gap-8" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-x-16 gap-y-4">
        <span className="flex min-w-0 flex-col">
          <span className="body-medium font-medium">{node.label}</span>
          <span className={cn("body-caption", MUTED)}>{sub}</span>
        </span>
        <button type="button" onClick={onOpenTable} className="min-h-44 body-small underline underline-offset-2">
          Open table
        </button>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left">
            <th scope="col" className={cn("py-6 pr-12 body-caption font-medium", MUTED)}>{node.kind === "record" ? "Goes to" : "Record"}</th>
            <th scope="col" className={cn("w-[56px] py-6 pr-12 text-right body-caption font-medium sm:w-[72px]", MUTED)}>Share</th>
            <th scope="col" className={cn("w-[64px] py-6 text-right body-caption font-medium sm:w-[112px]", MUTED)}>{stream.unit}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="[border-top:var(--row-divider)] align-top">
              <th scope="row" className="py-6 pr-12 text-left font-normal">
                <span className="block body-small">{row.name}</span>
                {row.sub && <span className={cn("block body-caption", MUTED)}>{row.sub}</span>}
                {row.hint && viewer && node.kind !== "record" && <HintMarker hint={row.hint} viewer={viewer} className="pt-2" />}
              </th>
              <td className="py-6 pr-12 text-right align-top body-small tabular-nums">
                {row.percent != null ? `${row.percent}%` : ""}
                {row.hint?.kind === "countedOn" && <span className={cn("block whitespace-nowrap body-caption", MUTED)}>Counted on</span>}
                {row.hint?.kind === "countedOn" && <span className="block whitespace-nowrap body-caption font-mono">{row.hint.ownerLabel}</span>}
              </td>
              <td className="py-6 text-right body-small tabular-nums">{formatNumber(row.value)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="[border-top:var(--hair-2)]">
            <th scope="row" className="py-6 pr-12 text-left body-small font-medium">Total</th>
            <td />
            <td className="py-6 text-right body-small font-medium tabular-nums">{formatNumber(node.value)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function FlowView({ allocation, focus, onOpenTable }: { allocation: EmissionAllocation; focus: Focus; onOpenTable: () => void }) {
  const [chosen, setChosen] = useState<StreamKey | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const streamKey = chosen ?? firstStreamWithData(allocation.records);
  const stream = STREAMS.find((candidate) => candidate.key === streamKey) ?? STREAMS[0];
  const batches = batchOwners(allocation);
  const graph = buildGraph(stream, allocation.records, batches, removalOwners(allocation));
  const codes = batchCodesOf(allocation);
  const exists = (key: string | null) => !!key && graph.nodes.some((node) => node.key === key);
  const focusKey = focus.owner.key;
  const activeKey = exists(hovered) ? hovered : exists(pinned) ? pinned : exists(focusKey) ? focusKey : null;
  const activeNode = graph.nodes.find((node) => node.key === activeKey);
  return (
    <div data-allocation-flow-panel className="flex min-w-0 flex-col gap-20 border border-[var(--color-border-secondary)] bg-[var(--paper)] p-16 sm:p-24">
      <SegmentGroup
        label="Quantity"
        options={STREAMS.map((candidate) => ({ value: candidate.key, label: candidate.label }))}
        value={streamKey}
        onChange={(next) => {
          setChosen(next);
          setPinned(null);
        }}
        stretch
        className="w-full sm:w-max"
      />
      {graph.nodes.length === 0 ? (
        <EmptyState padding="sm" icon={<ChartBarIcon size={EMPTY_ICON_PX} aria-hidden />} title={`No ${stream.label.toLowerCase()} figures recorded`} description="Nothing to draw for this quantity yet." />
      ) : (
        <FlowChart
          graph={graph}
          stream={stream}
          focusKey={focusKey}
          activeKey={activeKey}
          removalNotYet={removalNotYet(allocation)}
          onHover={setHovered}
          onToggle={(key) => setPinned(pinned === key || key === focusKey ? null : key)}
        />
      )}
      {graph.undrawn > 0 && (
        <p className={cn("body-caption", MUTED)}>
          {graph.undrawn} {graph.undrawn === 1 ? "record has" : "records have"} no recorded {stream.unit} and {graph.undrawn === 1 ? "is" : "are"} not drawn. The table lists {graph.undrawn === 1 ? "it" : "them"}.
        </p>
      )}
      {activeNode && (
        <div className="border-t border-[var(--clr-dark-purple-10)] pt-16 lg:max-w-[640px]">
          <DetailList graph={graph} node={activeNode} stream={stream} codes={codes} onOpenTable={onOpenTable} />
        </div>
      )}
    </div>
  );
}
