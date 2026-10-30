/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). The two
 * hosts a variant renders into, drawn after the real ones from fixture data:
 * the credit batch page on its Emissions tab, and the Removal sheet open over
 * the Removals list.
 */
"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon, LeafIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { DetailField, DetailSection } from "@/components/ui/detail-panel";
import { IdentityChip } from "@/components/credit-batches/credit-batch-page-parts";
import { CREDIT_BATCH_PAGE_TABS, CREDIT_BATCH_PAGE_TAB_LABELS } from "@/lib/credit-batches/batch-page";
import { formatDateRange } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { BATCHES, FEEDSTOCK_TYPE, REMOVALS, type Focus, type RemovalFixture } from "./fixture";
import { MUTED, PANEL } from "./parts";

/** The switcher bar floats over the page bottom; keep the last row reachable. */
const SWITCHER_CLEARANCE = "pb-96";

export function BatchSurface({ focus, children }: { focus: Focus; children: ReactNode }) {
  const batch = BATCHES.find((candidate) => candidate.code === focus.owner.key) ?? BATCHES[0];
  return (
    <div className={cn("container-max page-shell min-w-0", SWITCHER_CLEARANCE)}>
      <div className="flex flex-col gap-20">
        <span className={cn("inline-flex min-h-44 items-center gap-6 self-start body-small", MUTED)}>
          <ArrowLeftIcon size={16} aria-hidden />
          All credit batches
        </span>
        <div className="flex flex-col gap-12">
          <PageHeader area="verification" title={batch.code} />
          <div className="flex flex-wrap items-center gap-12">
            <IdentityChip icon={<LeafIcon size={16} aria-hidden />}>{FEEDSTOCK_TYPE}</IdentityChip>
            <span className={cn("body-small", MUTED)}>{formatDateRange(batch.startDate, batch.endDate)}</span>
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-24">
        <div className="flex items-stretch border-b border-[var(--color-border-secondary)]">
          <div role="tablist" aria-label="Credit batch sections" className="relative flex min-w-0 flex-1 overflow-x-auto">
            {CREDIT_BATCH_PAGE_TABS.map((key) => (
              <span
                key={key}
                role="tab"
                aria-selected={key === "emissions"}
                className={cn(
                  "-mb-px inline-flex h-44 shrink-0 items-center gap-8 border-b-2 px-16 body-medium first:pl-0",
                  key === "emissions" ? "border-[var(--ink)] font-medium" : "border-transparent text-[var(--color-text-secondary)]",
                )}
              >
                {CREDIT_BATCH_PAGE_TAB_LABELS[key]}
              </span>
            ))}
          </div>
        </div>
        <div role="tabpanel" className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

function useCloseSheet() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (code: string | null) => {
    const q = new URLSearchParams(params.toString());
    q.set("focus", code ?? "none");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
}

export function RemovalSurface({ focus, fixture, open, children }: { focus: Focus; fixture: RemovalFixture; open: boolean; children: ReactNode }) {
  const removals = REMOVALS[fixture];
  const removal = removals.find((candidate) => candidate.code === focus.owner.key) ?? removals[0];
  const memberBatches = BATCHES.filter((batch) => removal.batches.includes(batch.code));
  const window = memberBatches.length ? formatDateRange(memberBatches[0].startDate, memberBatches[memberBatches.length - 1].endDate) : "";
  const openRemoval = useCloseSheet();
  return (
    <>
      <div className={cn("container-max page-shell min-w-0", SWITCHER_CLEARANCE)}>
        <PageHeader area="certification" title="Removals" />
        <div className={cn(PANEL, "overflow-x-auto")}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--sea)] text-left">
                <th scope="col" className="px-16 py-10 body-small font-medium text-[var(--color-text-secondary)]">Removal</th>
                <th scope="col" className="px-16 py-10 body-small font-medium text-[var(--color-text-secondary)]">Credit batches</th>
                <th scope="col" className="px-16 py-10 body-small font-medium text-[var(--color-text-secondary)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {removals.map((row) => (
                <tr key={row.code} className="[border-top:var(--row-divider)]">
                  <td className="px-16 py-12">
                    <button type="button" onClick={() => openRemoval(row.code)} className="body-small font-medium underline-offset-2 hover:underline">{row.code}</button>
                  </td>
                  <td className="px-16 py-12 body-small">{row.batches.join(", ")}</td>
                  <td className="px-16 py-12 body-small">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <SlideOverPanel.Root open={open} onOpenChange={(next) => !next && openRemoval(null)} dismissOnClickOutside={false}>
        <SlideOverPanel.Content size="wide">
          <SlideOverPanel.Header showClose>
            <SlideOverPanel.Title>{removal.code}</SlideOverPanel.Title>
            <SlideOverPanel.Description>{window}</SlideOverPanel.Description>
          </SlideOverPanel.Header>
          <SlideOverPanel.Body className="flex flex-col gap-24 pb-96">
            <DetailSection title="Submission status" divider={false}>
              <DetailField label="Status" value={removal.status} />
            </DetailSection>
            <DetailSection title="Removal">
              <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
                <DetailField label="Reporting window" value={window} />
                <DetailField
                  label={`Credit batches (${removal.batches.length})`}
                  value={
                    <span className="font-mono">{removal.batches.join(", ")}</span>
                  }
                />
              </div>
            </DetailSection>
            {children}
          </SlideOverPanel.Body>
          <SlideOverPanel.Footer>
            <SlideOverPanel.FooterClose />
          </SlideOverPanel.Footer>
        </SlideOverPanel.Content>
      </SlideOverPanel.Root>
    </>
  );
}
