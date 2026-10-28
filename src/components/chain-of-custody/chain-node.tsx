"use client";

import { Button } from "@/components/ui/button";
import type { Icon } from "@phosphor-icons/react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import {
  FLOW_HEADER_WIDTH,
  FLOW_ICON_SIZE,
  FLOW_NODE_BOX_HEIGHT,
  FLOW_NODE_BOX_WIDTH,
  FLOW_NODE_SIZE,
  type LineageNodeKind,
} from "./chain-constants";
import type { LineageDetailRow } from "./use-chain-graph";

/** Lighting the Flow chart stamps on at render. */
export interface FlowLighting {
  /** Outside the focused record's lineage: fade back. */
  dimmed?: boolean;
  /** On the focused record's lineage. */
  lit?: boolean;
  /** The hovered record, or the group holding the focused record. */
  current?: boolean;
}

export interface ChainNodeData extends FlowLighting {
  kind: LineageNodeKind;
  /** Kind label ("Feedstock", "Production run"). */
  label: string;
  /** Sheet heading. */
  code: string;
  /** The record's own code, shown under its node. */
  shortCode: string;
  icon: Icon;
  /** Display fill for the node square. */
  accent: string;
  /** Ink variant: kind label text in the sheet (always passes contrast). */
  accentInk: string;
  href: string | null;
  status?: string | null;
  date: string | null;
  details: LineageDetailRow[];
  /** The shared selection (map marker, rail, chip or a click here). */
  highlighted?: boolean;
  /** Batch Flow application record: its sheet offers "Trace rollback". */
  drillable?: boolean;
  [key: string]: unknown;
}

export interface FlowGroupNodeData extends FlowLighting {
  kind: LineageNodeKind;
  /** "34 feedstocks" */
  title: string;
  memberIds: string[];
  icon: Icon;
  accent: string;
  [key: string]: unknown;
}

export interface FlowColumnNodeData {
  kind: LineageNodeKind;
  title: string;
  count: number;
  /** Expanded past the group threshold: offers to collapse again. */
  onCollapse?: () => void;
  [key: string]: unknown;
}

const DIMMED_OPACITY = 0.18;
const SQUARE_INSET = (FLOW_NODE_BOX_WIDTH - FLOW_NODE_SIZE) / 2;
const STACK_OFFSETS = [4, 2] as const;
const RING_OFFSET = 3;
/** Keyboard focus on the node wrapper rings the square, like a selection. */
const FOCUS_RING_CLASS =
  "in-focus-visible:[outline:1.5px_solid_var(--ink)] in-focus-visible:[outline-offset:3px]";

// Edges meet the square's sides, not the wider label box.
const TARGET_HANDLE_STYLE: CSSProperties = { left: SQUARE_INSET, top: FLOW_NODE_SIZE / 2 };
const SOURCE_HANDLE_STYLE: CSSProperties = { right: SQUARE_INSET, top: FLOW_NODE_SIZE / 2 };
const HANDLE_CLASS = "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

function ringStyle(on: boolean, strong: boolean): CSSProperties {
  if (!on) return {};
  return {
    outline: `1.5px solid ${strong ? "var(--ink)" : "var(--clr-dark-purple-40)"}`,
    outlineOffset: RING_OFFSET,
  };
}

function labelClass(lit: boolean | undefined) {
  return `mt-6 block max-w-full truncate text-center font-mono text-[10px] font-medium leading-none tracking-[0.04em] ${
    lit ? "text-[var(--ink)]" : "text-[var(--color-text-secondary)]"
  }`;
}

function NodeShell({
  dimmed,
  ariaLabel,
  children,
}: {
  dimmed?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="relative flex cursor-pointer flex-col items-center transition-opacity duration-150"
      style={{
        width: FLOW_NODE_BOX_WIDTH,
        height: FLOW_NODE_BOX_HEIGHT,
        opacity: dimmed ? DIMMED_OPACITY : 1,
      }}
    >
      <Handle type="target" position={Position.Left} className={HANDLE_CLASS} style={TARGET_HANDLE_STYLE} />
      {children}
      <Handle type="source" position={Position.Right} className={HANDLE_CLASS} style={SOURCE_HANDLE_STYLE} />
    </div>
  );
}

/** One record: a square in its kind's colour with the kind's icon, code below. */
export function ChainNode({ data }: NodeProps) {
  const { label, shortCode, icon: KindIcon, accent, highlighted, dimmed, lit, current } =
    data as unknown as ChainNodeData;
  return (
    <NodeShell dimmed={dimmed} ariaLabel={`${label} ${shortCode}`}>
      <div
        data-highlighted={highlighted ? "true" : undefined}
        className={`grid shrink-0 place-items-center ${FOCUS_RING_CLASS}`}
        style={{
          width: FLOW_NODE_SIZE,
          height: FLOW_NODE_SIZE,
          background: accent,
          ...ringStyle(Boolean(highlighted || current), Boolean(highlighted)),
        }}
      >
        <KindIcon size={FLOW_ICON_SIZE} weight="bold" color="var(--paper)" aria-hidden />
      </div>
      <span className={labelClass(lit || highlighted || current)}>{shortCode}</span>
    </NodeShell>
  );
}

/** A collapsed column: a stacked square with the count. A click lists them. */
export function FlowGroupNode({ data }: NodeProps) {
  const { title, icon: KindIcon, accent, dimmed, lit, current } = data as unknown as FlowGroupNodeData;
  return (
    <NodeShell dimmed={dimmed} ariaLabel={`Show all ${title}`}>
      <div className="relative shrink-0" style={{ width: FLOW_NODE_SIZE, height: FLOW_NODE_SIZE }}>
        {STACK_OFFSETS.map((offset) => (
          <span
            key={offset}
            aria-hidden
            className="absolute inset-0 border border-[var(--clr-dark-purple-30)] bg-[var(--paper)]"
            style={{ transform: `translate(${offset}px, ${-offset}px)` }}
          />
        ))}
        <div
          className={`relative grid h-full w-full place-items-center ${FOCUS_RING_CLASS}`}
          style={{ background: accent, ...ringStyle(Boolean(current), true) }}
        >
          <KindIcon size={FLOW_ICON_SIZE} weight="bold" color="var(--paper)" aria-hidden />
        </div>
      </div>
      <span className={labelClass(true)}>{title}</span>
      {lit ? <span className="sr-only">On the focused lineage</span> : null}
    </NodeShell>
  );
}

/** Column header: the kind and how many records it holds. */
export function FlowColumnNode({ data }: NodeProps) {
  const { title, count, onCollapse } = data as unknown as FlowColumnNodeData;
  return (
    <div
      className="flex cursor-default flex-col items-center gap-4 text-center font-mono text-[10px] font-medium uppercase leading-none tracking-[0.07em]"
      style={{ width: FLOW_HEADER_WIDTH }}
    >
      <span className="text-[var(--color-text-secondary)]">{title}</span>
      <span className="text-[var(--color-text-tertiary)]">
        {count} {count === 1 ? "record" : "records"}
      </span>
      {onCollapse ? (
        <Button
          variant="noOutline"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onCollapse();
          }}
          className="nodrag nopan"
        >
          Collapse
        </Button>
      ) : null}
    </div>
  );
}
