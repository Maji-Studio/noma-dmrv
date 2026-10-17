/**
 * CreditBatchEmissionsPanel: the batch sheet's "Emissions" section. It lists
 * the template lines that still need an operator (Not recorded, File missing,
 * Needs review, Needs setup) and links to the Emissions page for the batch.
 * Self-fetching and read-only; recording happens on the Emissions page.
 */
"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { SectionLabel } from "@/components/forms/section-label";
import { Notice } from "@/components/ui/notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge, type StatusValue } from "@/components/ui/status-badge";
import { useBatchEmissionLines } from "@/hooks/use-emission-entries";
import { EMISSION_LINE_STATE_LABELS, type EmissionLineState } from "@/lib/certification/emission-lines";
import { cn } from "@/lib/utils";
import { SheetLinkRows } from "./sheet-link-row";

const OPEN_STATES: readonly EmissionLineState[] = ["empty", "missingEvidence", "needsReview", "needsSetup"];
const BADGE_STATUS: Record<string, StatusValue> = {
  empty: "pending",
  missingEvidence: "pending",
  needsReview: "pending",
  needsSetup: "missing_data",
};
const OPEN_EMISSIONS_LABEL = "Open emissions";

export function emissionsBatchHref(creditBatchId: string): string {
  return `/emissions/${creditBatchId}`;
}

function OpenEmissionsLink({ creditBatchId }: { creditBatchId: string }) {
  return (
    <Link href={emissionsBatchHref(creditBatchId)} className={cn(buttonVariants({ variant: "weak", size: "small" }), "shrink-0")}>
      {OPEN_EMISSIONS_LABEL}
      <ArrowRightIcon size={14} aria-hidden />
    </Link>
  );
}

function PanelSection({ children }: { children: React.ReactNode }) {
  return (
    <section data-testid="credit-batch-emissions-panel" className="flex flex-col gap-16 border-t border-[var(--color-border-tertiary)] pt-16">
      <SectionLabel>Emissions</SectionLabel>
      {children}
    </section>
  );
}

export function CreditBatchEmissionsPanel({
  creditBatchId,
  facilityId,
  enabled,
}: {
  creditBatchId: string;
  facilityId: string;
  /** The server's EMISSIONS_ENTRIES_ENABLED flag, passed down by the page. */
  enabled: boolean;
}) {
  const { data: lines, isLoading, error, refetch, isRefetching } = useBatchEmissionLines(
    enabled && facilityId && creditBatchId ? { facilityId, creditBatchId } : null,
  );
  if (!enabled) return null;

  if (error) {
    return (
      <PanelSection>
        <Notice
          tone="warning"
          action={<Button variant="weak" size="small" busy={isRefetching} onClick={() => void refetch()}>Retry</Button>}
        >
          Emissions lines unavailable. Retry to load them.
        </Notice>
      </PanelSection>
    );
  }
  if (isLoading || !lines) {
    return (
      <PanelSection>
        <span className="body-caption text-[var(--color-text-tertiary)]" aria-busy>Loading emissions…</span>
      </PanelSection>
    );
  }

  const open = lines.filter((line) => OPEN_STATES.includes(line.state));
  if (open.length === 0) {
    return (
      <PanelSection>
        <div className="flex items-center justify-between gap-12">
          <span className="flex items-center gap-8 body-small text-[var(--color-text-secondary)]">
            <CheckCircleIcon size={16} weight="bold" aria-hidden />
            All lines recorded
          </span>
          <OpenEmissionsLink creditBatchId={creditBatchId} />
        </div>
      </PanelSection>
    );
  }

  return (
    <PanelSection>
      <div className="flex flex-col gap-8">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {open.length} of {lines.length} {lines.length === 1 ? "line" : "lines"} still open
        </span>
        <SheetLinkRows>
          {open.map((line) => (
            <div key={line.componentId} className="flex min-w-0 items-center justify-between gap-12 py-10">
              <span className="truncate body-small font-medium text-[var(--color-text-primary)]">{line.label}</span>
              <StatusBadge status={BADGE_STATUS[line.state]} label={EMISSION_LINE_STATE_LABELS[line.state]} size="small" />
            </div>
          ))}
        </SheetLinkRows>
      </div>
      <div className="flex justify-end">
        <OpenEmissionsLink creditBatchId={creditBatchId} />
      </div>
    </PanelSection>
  );
}
