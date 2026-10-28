/**
 * CreditBatchEmissionsPanel: the batch sheet's "Emissions" section. It lists
 * the template components that still need an operator (Not recorded, File missing,
 * Check entry, Not set up) and links to the batch page's Emissions tab.
 * Self-fetching and read-only; recording happens on the batch page's Emissions tab.
 */
"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { SectionLabel } from "@/components/forms/section-label";
import { Notice } from "@/components/ui/notice";
import { Button, buttonVariants } from "@/components/ui/button";
// By file, not the emissions barrel: the batch sheet needs only these.
import { EmissionLineBadge } from "@/components/emissions/emission-line-badge";
import { isOpen } from "@/components/emissions/emission-line-display";
import { TemplateSetupNotice } from "@/components/emissions/template-setup-notice";
import { recordHref } from "@/lib/record-links";
import { useBatchEmissionLines } from "@/hooks/use-emission-entries";
import { isEmissionLinesBlocked } from "@/lib/certification/emission-lines-blocked-error";
import { cn } from "@/lib/utils";
import { SheetLinkRows } from "@/components/ui/sheet-link-row";

const OPEN_EMISSIONS_LABEL = "Open emissions";

function OpenEmissionsLink({ creditBatchId, facilityId }: { creditBatchId: string; facilityId: string }) {
  return (
    <Link href={recordHref("creditBatch", creditBatchId, { facilityId, tab: "emissions" })} className={cn(buttonVariants({ variant: "weak", size: "small" }), "shrink-0")}>
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
}: {
  creditBatchId: string;
  facilityId: string;
}) {
  const { data: lines, isLoading, error, refetch, isRefetching } = useBatchEmissionLines(
    facilityId && creditBatchId ? { facilityId, creditBatchId } : null,
  );

  if (isEmissionLinesBlocked(error)) {
    return (
      <PanelSection>
        <TemplateSetupNotice blocker={error.blocker} facilityId={facilityId} creditBatchId={creditBatchId} />
      </PanelSection>
    );
  }
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

  const open = lines.filter(isOpen);
  if (open.length === 0) {
    return (
      <PanelSection>
        <div className="flex items-center justify-between gap-12">
          <span className="flex items-center gap-8 body-small text-[var(--color-text-secondary)]">
            <CheckCircleIcon size={16} weight="bold" aria-hidden />
            All components recorded
          </span>
          <OpenEmissionsLink creditBatchId={creditBatchId} facilityId={facilityId} />
        </div>
      </PanelSection>
    );
  }

  return (
    <PanelSection>
      <div className="flex flex-col gap-8">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {open.length} of {lines.length} {lines.length === 1 ? "component" : "components"} still open
        </span>
        <SheetLinkRows>
          {open.map((line) => (
            <div key={line.componentId} className="flex min-w-0 items-center justify-between gap-12 py-10">
              <span className="truncate body-small font-medium text-[var(--color-text-primary)]">{line.label}</span>
              <EmissionLineBadge state={line.state} size="small" />
            </div>
          ))}
        </SheetLinkRows>
      </div>
      <div className="flex justify-end">
        <OpenEmissionsLink creditBatchId={creditBatchId} facilityId={facilityId} />
      </div>
    </PanelSection>
  );
}
