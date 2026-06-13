/**
 * AttentionQueue — the dashboard's "Record checks" panel (visual design plan,
 * Phase 5). Items are computed gaps in existing MRV records (an attention
 * item has no lifecycle of its own — it disappears when the record is fixed);
 * each row links straight to where the record is resolved.
 */
"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DashboardAttentionItem } from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";

function severityBadge(item: DashboardAttentionItem) {
  return item.severity === "flag" ? (
    <StatusBadge status="rejected" label="Flagged" size="small" />
  ) : (
    <StatusBadge status="pending" label="Upcoming" size="small" />
  );
}

interface AttentionQueueProps {
  items: DashboardAttentionItem[];
}

export function AttentionQueue({ items }: AttentionQueueProps) {
  const flagCount = items.filter((item) => item.severity === "flag").length;

  return (
    <DashboardPanel
      title="Record checks"
      meta={
        flagCount > 0 ? (
          <span className="label-micro text-[var(--st-bad)]">
            {flagCount} {flagCount === 1 ? "flag" : "flags"}
          </span>
        ) : (
          <span className="label-micro text-[var(--color-text-tertiary)]">
            Clear
          </span>
        )
      }
      className="min-h-0 flex-1"
    >
      {items.length === 0 ? (
        <EmptyState
          padding="md"
          icon={<CheckCircle size={32} />}
          title="No flags on record"
          description="Every check passes for this facility's current records."
        />
      ) : (
        <ul className="flex flex-col px-20 py-4" data-testid="attention-queue">
          {items.map((item, index) => (
            <li
              key={item.id}
              className={
                index > 0
                  ? "border-t border-[var(--color-border-tertiary)]"
                  : undefined
              }
            >
              <Link
                href={item.href}
                className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-12 py-12"
              >
                <span className="flex min-w-0 flex-col gap-2">
                  <span className="label-micro text-[var(--color-text-tertiary)]">
                    {item.entityCode}
                  </span>
                  <span className="body-small text-[var(--color-text-primary)]">
                    {item.title}
                  </span>
                </span>
                {severityBadge(item)}
                <ArrowRight
                  size={14}
                  weight="bold"
                  className="text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
