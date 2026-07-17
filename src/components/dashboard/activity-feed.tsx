/**
 * ActivityFeed — the last few things that actually happened at the facility
 * (feedstock received, runs completed, deliveries, applications, batches),
 * newest first, each row deep-linking to its list page.
 */
"use client";

import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { DashboardActivityItem } from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

interface ActivityFeedProps {
  activity: DashboardActivityItem[];
}

export function ActivityFeed({ activity }: ActivityFeedProps) {
  return (
    <DashboardPanel
      title="Recent activity"
      meta={
        <span className="label-micro text-[var(--color-text-tertiary)]">
          Latest {activity.length}
        </span>
      }
    >
      {activity.length === 0 ? (
        <div className="px-20 py-20">
          <span className="body-small text-[var(--color-text-secondary)]">
            Nothing recorded yet — activity appears as records are logged.
          </span>
        </div>
      ) : (
        <ul className="flex flex-col px-20 py-4" data-testid="activity-feed">
          {activity.map((item, index) => (
            <li
              key={item.id}
              className={
                index > 0 ? "border-t border-[var(--color-border-tertiary)]" : undefined
              }
            >
              <Link
                href={item.href}
                className="group grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-12 py-11"
              >
                <span className="label-micro w-52 text-[var(--color-text-tertiary)]">
                  {formatDate(item.dateIso)}
                </span>
                <span className="body-small truncate text-[var(--color-text-primary)]">
                  {item.title}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
                  {item.code}
                </span>
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
    </DashboardPanel>
  );
}
