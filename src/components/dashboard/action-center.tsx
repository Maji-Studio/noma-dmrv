/**
 * ActionCenter — the dashboard's single "what needs me" surface. Folds the
 * three formerly-separate operator panels into one place to act:
 *
 *   - a live band (running runs + in-flight submissions — "Now"),
 *   - a NEEDS FIXING lane (record flags + upcoming items — the attention queue),
 *   - an EVIDENCE GAPS lane (structural certification holes — evidence health).
 *
 * Splitting these across panels made the operator hunt for where to act; here
 * the flags, the gaps, and the live signal sit side by side under one header
 * with one certification CTA.
 */
"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  DashboardAttentionItem,
  DashboardEvidenceRow,
  DashboardNowItem,
  DashboardNowStatus,
} from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";

/** How many live chips to render before collapsing into a "+N" count. */
const LIVE_CHIP_CAP = 5;

const NOW_KIND_LABEL: Record<DashboardNowItem["kind"], string> = {
  production: "Production",
  registry: "Registry",
  verifier: "Verifier",
};

/** Live work pulses; settled work (submitted / complete) sits still. */
const NOW_STATUS: Record<DashboardNowStatus, { color: string; pulse: boolean }> = {
  running: { color: "var(--acc-infra)", pulse: true },
  locked: { color: "var(--st-wait)", pulse: true },
  submitted: { color: "var(--st-wait)", pulse: false },
  complete: { color: "var(--st-ok)", pulse: false },
};

function severityBadge(item: DashboardAttentionItem) {
  return item.severity === "flag" ? (
    <StatusBadge status="rejected" label="Flag" size="small" />
  ) : (
    <StatusBadge status="pending" label="Upcoming" size="small" />
  );
}

interface ActionCenterProps {
  attention: DashboardAttentionItem[];
  evidence: DashboardEvidenceRow[];
  now: DashboardNowItem[];
  facilityId: string;
}

export function ActionCenter({
  attention,
  evidence,
  now,
  facilityId,
}: ActionCenterProps) {
  const flagCount = attention.filter((item) => item.severity === "flag").length;
  const openGaps = evidence.reduce((sum, row) => sum + row.count, 0);
  const toClear = flagCount + openGaps;
  const liveItems = now.filter((item) => NOW_STATUS[item.status].pulse);
  const liveChips = now.slice(0, LIVE_CHIP_CAP);
  const liveOverflow = now.length - liveChips.length;

  return (
    <DashboardPanel
      title="Action center"
      meta={
        toClear > 0 ? (
          <span className="label-micro text-[var(--st-wait)]">
            {toClear} to clear
          </span>
        ) : (
          <span className="label-micro text-[var(--st-ok)]">All clear</span>
        )
      }
    >
      {/* Live band — only when something is actually in flight. */}
      {now.length > 0 && (
        <div className="flex flex-wrap items-center gap-8 border-b border-[var(--color-border-tertiary)] px-20 py-14">
          <span className="flex items-center gap-6 label-micro text-[var(--color-text-tertiary)]">
            {liveItems.length > 0 && (
              <span
                className="h-8 w-8 animate-pulse bg-[var(--acc-infra)]"
                aria-hidden
              />
            )}
            Live
          </span>
          {liveChips.map((item) => {
            const dot = NOW_STATUS[item.status];
            return (
              <Link
                key={item.id}
                href={item.href}
                className="group flex items-center gap-7 border border-[var(--color-border-tertiary)] bg-[var(--color-background-white)] px-8 py-4 transition-colors hover:border-[var(--color-text-tertiary)]"
              >
                <span
                  className={`h-7 w-7 ${dot.pulse ? "animate-pulse" : ""}`}
                  style={{ background: dot.color }}
                  aria-hidden
                />
                <span className="label-micro text-[var(--color-text-tertiary)]">
                  {NOW_KIND_LABEL[item.kind]}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-primary)]">
                  {item.code}
                </span>
              </Link>
            );
          })}
          {liveOverflow > 0 && (
            <span className="label-micro text-[var(--color-text-tertiary)]">
              +{liveOverflow} more
            </span>
          )}
        </div>
      )}

      {/* The two action lanes. */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* NEEDS FIXING — record flags + upcoming. */}
        <div className="lg:border-r lg:border-[var(--color-border-tertiary)]">
          <div className="flex items-center justify-between gap-8 px-20 pt-16 pb-8">
            <span className="label-micro text-[var(--color-text-tertiary)]">
              Needs fixing
            </span>
            {flagCount > 0 && (
              <span className="label-micro text-[var(--st-bad)]">
                {flagCount} {flagCount === 1 ? "flag" : "flags"}
              </span>
            )}
          </div>
          {attention.length === 0 ? (
            <div className="flex items-center gap-10 px-20 pb-16 pt-4">
              <CheckCircle
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
            <ul className="flex flex-col px-20 pb-4" data-testid="action-center-flags">
              {attention.map((item, index) => (
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
        </div>

        {/* EVIDENCE GAPS — structural certification holes. */}
        <div className="border-t border-[var(--color-border-tertiary)] lg:border-t-0">
          <div className="flex items-center justify-between gap-8 px-20 pt-16 pb-8">
            <span className="label-micro text-[var(--color-text-tertiary)]">
              Evidence gaps
            </span>
            {openGaps > 0 ? (
              <span className="label-micro text-[var(--st-wait)]">
                {openGaps} {openGaps === 1 ? "gap" : "gaps"}
              </span>
            ) : (
              <span className="label-micro text-[var(--st-ok)]">Clear</span>
            )}
          </div>
          <ul className="flex flex-col px-20 pb-4" data-testid="action-center-evidence">
            {evidence.map((row, index) => {
              const open = row.count > 0;
              return (
                <li
                  key={row.key}
                  className={
                    index > 0
                      ? "border-t border-[var(--color-border-tertiary)]"
                      : undefined
                  }
                >
                  <Link
                    href={row.href}
                    className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-12 py-12"
                  >
                    <span className="body-small text-[var(--color-text-secondary)]">
                      {row.label}
                    </span>
                    <span
                      className="inline-flex min-w-28 justify-center border px-8 py-2 font-mono text-[12px] tabular-nums"
                      style={{
                        color: open ? "var(--st-wait)" : "var(--st-ok)",
                        background: open ? "var(--st-wait-bg)" : "var(--st-ok-bg)",
                        borderColor: open
                          ? "var(--st-wait-border)"
                          : "var(--st-ok-border)",
                      }}
                    >
                      {row.count}
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
        </div>
      </div>

      {/* One certification CTA for the whole panel. */}
      <div className="border-t border-[var(--color-border-tertiary)] px-20 py-18">
        <Link
          href={`/certification/removals?facility=${encodeURIComponent(facilityId)}`}
          className="group inline-flex items-center gap-8 label-micro text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Open certification removals
          <ArrowRight
            size={13}
            weight="bold"
            className="transition-transform duration-150 group-hover:translate-x-[3px]"
            aria-hidden
          />
        </Link>
      </div>
    </DashboardPanel>
  );
}
