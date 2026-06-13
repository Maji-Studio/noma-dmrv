/**
 * NowPanel — the dashboard's live signal (restored from the operator
 * dashboard, re-scoped to the selected facility): production runs that are
 * running right now, registry/verifier submissions in flight, and runs
 * completed in the last fortnight. Running and in-progress rows carry a
 * pulsing square so the panel reads as alive at a glance.
 */
"use client";

import Link from "next/link";
import { ArrowRight, Pulse } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  DashboardNowItem,
  DashboardNowStatus,
} from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";

const KIND_LABEL: Record<DashboardNowItem["kind"], string> = {
  production: "Production",
  registry: "Registry",
  verifier: "Verifier",
};

/** Square indicator colour + whether it pulses (live work). */
const STATUS_DOT: Record<DashboardNowStatus, { color: string; pulse: boolean }> = {
  running: { color: "var(--acc-infra)", pulse: true },
  locked: { color: "var(--st-wait)", pulse: true },
  submitted: { color: "var(--st-wait)", pulse: false },
  complete: { color: "var(--st-ok)", pulse: false },
};

interface NowPanelProps {
  items: DashboardNowItem[];
}

export function NowPanel({ items }: NowPanelProps) {
  const liveCount = items.filter(
    (item) => STATUS_DOT[item.status].pulse,
  ).length;

  return (
    <DashboardPanel
      title="Now"
      meta={
        liveCount > 0 ? (
          <span className="flex items-center gap-6 label-micro text-[var(--acc-infra-ink)]">
            <span
              className="h-8 w-8 animate-pulse bg-[var(--acc-infra)]"
              aria-hidden
            />
            {liveCount} live
          </span>
        ) : (
          <span className="label-micro text-[var(--color-text-tertiary)]">
            Idle
          </span>
        )
      }
      className="min-h-0 flex-1"
    >
      {items.length === 0 ? (
        <EmptyState
          padding="md"
          icon={<Pulse size={32} />}
          title="Quiet right now"
          description="No running production or in-flight submission for this facility."
        />
      ) : (
        <ul className="flex flex-col px-20 py-4" data-testid="now-panel">
          {items.map((item, index) => {
            const dot = STATUS_DOT[item.status];
            return (
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
                  className="group grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-12 py-12"
                >
                  <span
                    className={[
                      "h-10 w-10",
                      dot.pulse ? "animate-pulse" : "",
                    ].join(" ")}
                    style={{ background: dot.color }}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-col gap-2">
                    <span className="label-micro text-[var(--color-text-tertiary)]">
                      {KIND_LABEL[item.kind]} ·{" "}
                      <span className="font-mono text-[var(--color-text-primary)]">
                        {item.code}
                      </span>
                    </span>
                    <span className="body-small text-[var(--color-text-secondary)]">
                      {item.detail}
                    </span>
                  </span>
                  <ArrowRight
                    size={14}
                    weight="bold"
                    className="text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}
