/**
 * AttentionList — the compact "needs attention" panel under the hero: the
 * actual open items behind the scene's badges, each row deep-linking to the
 * record to fix. The hero shows the counts; this shows the rows.
 */
"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DashboardAttentionItem } from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";

interface AttentionListProps {
  attention: DashboardAttentionItem[];
}

export function AttentionList({ attention }: AttentionListProps) {
  const flagCount = attention.filter((item) => item.severity === "flag").length;

  return (
    <DashboardPanel
      title="Needs attention"
      meta={
        attention.length > 0 ? (
          <span className="label-micro text-[var(--st-wait)]">
            {attention.length} open
          </span>
        ) : (
          <span className="label-micro text-[var(--st-ok)]">All clear</span>
        )
      }
    >
      {attention.length === 0 ? (
        <div className="flex items-center gap-10 px-20 py-20">
          <CheckCircleIcon
            size={18}
            weight="bold"
            className="text-[var(--st-ok)]"
            aria-hidden
          />
          <span className="body-small text-[var(--color-text-secondary)]">
            Every record check passes.
          </span>
        </div>
      ) : (
        <ul className="flex flex-col px-20 py-4" data-testid="attention-list">
          {attention.map((item, index) => (
            <li
              key={item.id}
              className={
                index > 0 ? "border-t border-[var(--color-border-tertiary)]" : undefined
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
                {item.severity === "flag" ? (
                  <StatusBadge status="rejected" label="Flag" size="small" />
                ) : (
                  <StatusBadge status="pending" label="Upcoming" size="small" />
                )}
                <ArrowRightIcon
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
      {flagCount > 0 && (
        <div className="border-t border-[var(--color-border-tertiary)] px-20 py-10">
          <span className="label-micro text-[var(--st-bad)]">
            {flagCount} {flagCount === 1 ? "flag" : "flags"} blocking records
          </span>
        </div>
      )}
    </DashboardPanel>
  );
}
