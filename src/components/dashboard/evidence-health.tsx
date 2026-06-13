/**
 * EvidenceHealth — structural certification gaps for the facility (restored
 * from the operator dashboard): missing GPS, runs without lab samples, and
 * transport-leg provenance holes. Each row is a count chip (green clear /
 * orange open) linking to where the gap is closed; the footer opens the
 * facility's certification overview.
 */
"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { DashboardEvidenceRow } from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";

interface EvidenceHealthProps {
  rows: DashboardEvidenceRow[];
  facilityId: string;
}

export function EvidenceHealth({ rows, facilityId }: EvidenceHealthProps) {
  const openGaps = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <DashboardPanel
      title="Evidence health"
      meta={
        openGaps > 0 ? (
          <span className="label-micro text-[var(--st-wait)]">
            {openGaps} {openGaps === 1 ? "gap" : "gaps"}
          </span>
        ) : (
          <span className="label-micro text-[var(--st-ok)]">All clear</span>
        )
      }
    >
      <ul className="flex flex-col px-20 py-4" data-testid="evidence-health">
        {rows.map((row, index) => {
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
      <div className="border-t border-[var(--color-border-tertiary)] px-20 py-20">
        <Link
          href={`/certification?facility=${encodeURIComponent(facilityId)}`}
          className="group inline-flex items-center gap-8 label-micro text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Open certification overview
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
