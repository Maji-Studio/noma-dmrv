/**
 * Chain Node — Custom React Flow node for the chain-of-custody visualizer.
 * Brutalist card with left accent bar, status bar, and click-to-navigate.
 */
"use client";

import { type ElementType } from "react";
import Link from "next/link";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  STATUS_COLORS,
  STATUS_COLOR_FALLBACK,
} from "./chain-constants";

// ============================================
// Types
// ============================================

export interface ChainNodeItem {
  code: string;
  name?: string;
}

export interface ChainNodeData {
  label: string;
  icon: ElementType;
  accent: string;
  href: string | null;
  total: number;
  byStatus: Record<string, number>;
  items: ChainNodeItem[];
  [key: string]: unknown;
}

// ============================================
// Status bar segment
// ============================================

function StatusBar({ byStatus, total }: { byStatus: Record<string, number>; total: number }) {
  const entries = Object.entries(byStatus).filter(([, v]) => v > 0);

  if (total === 0 || entries.length === 0) {
    return (
      <div
        className="w-full h-[4px] bg-[var(--color-background-medium)]"
      />
    );
  }

  return (
    <div className="w-full h-[4px] flex overflow-hidden">
      {entries.map(([status, count]) => (
        <div
          key={status}
          style={{
            width: `${(count / total) * 100}%`,
            backgroundColor: STATUS_COLORS[status] ?? STATUS_COLOR_FALLBACK,
          }}
        />
      ))}
    </div>
  );
}

// ============================================
// Status legend (top 3 statuses)
// ============================================

function StatusLegend({ byStatus }: { byStatus: Record<string, number> }) {
  const sorted = Object.entries(byStatus)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) return null;

  const shown = sorted.slice(0, 3);
  const remaining = sorted.length - shown.length;

  return (
    <p className="body-caption text-[var(--color-text-tertiary)] truncate">
      {shown.map(([s, c]) => `${c} ${s}`).join(" \u00b7 ")}
      {remaining > 0 && ` +${remaining}`}
    </p>
  );
}

// ============================================
// Items list (recent codes/names)
// ============================================

const MAX_ITEMS_SHOWN = 3;

function ItemsList({ items, total }: { items: ChainNodeItem[]; total: number }) {
  if (items.length === 0) return null;

  const shown = items.slice(0, MAX_ITEMS_SHOWN);
  const remaining = total - shown.length;

  return (
    <ul className="flex flex-col gap-2">
      {shown.map((item) => (
        <li key={item.code} className="body-caption text-[var(--color-text-secondary)] truncate">
          {item.code}{item.name ? ` — ${item.name}` : ""}
        </li>
      ))}
      {remaining > 0 && (
        <li className="body-caption text-[var(--color-text-tertiary)]">
          +{remaining} more
        </li>
      )}
    </ul>
  );
}

// ============================================
// ChainNode component
// ============================================

export function ChainNode({ data }: NodeProps) {
  const {
    label,
    icon: Icon,
    accent,
    href,
    total,
    byStatus,
    items,
  } = data as unknown as ChainNodeData;

  const isEmpty = total === 0;

  const card = (
    <div
      className={`
        group flex border bg-[var(--color-background-white)] transition-colors
        ${href ? "cursor-pointer" : "cursor-default"}
        ${isEmpty
          ? "border-dashed border-[var(--color-border-secondary)] opacity-40"
          : "border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)] hover:bg-[var(--color-background-medium)]"
        }
      `}
      style={{
        width: 240,
        minHeight: 110,
        borderLeftWidth: "3px",
        borderLeftStyle: "solid",
        borderLeftColor: accent,
      }}
    >
      <div className="flex-1 flex flex-col gap-6 p-12">
        {/* Header */}
        <div className="flex items-center gap-6">
          <Icon size={18} weight="bold" style={{ color: accent }} className="shrink-0" />
          <span className="title-chapter-title truncate" style={{ color: accent }}>
            {label}
          </span>
        </div>

        {/* Count */}
        <p className="title-heading-3">{total}</p>

        {/* Items list */}
        <ItemsList items={items} total={total} />

        {/* Status bar */}
        <StatusBar byStatus={byStatus} total={total} />

        {/* Status legend */}
        <StatusLegend byStatus={byStatus} />
      </div>
    </div>
  );

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-[var(--clr-purple)] !w-[6px] !h-[6px] !border-0" />

      {href ? <Link href={href} prefetch={false}>{card}</Link> : card}

      <Handle type="source" position={Position.Right} className="!bg-[var(--clr-purple)] !w-[6px] !h-[6px] !border-0" />
    </>
  );
}
