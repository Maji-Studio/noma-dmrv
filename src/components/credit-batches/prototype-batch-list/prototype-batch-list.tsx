"use client";

/**
 * PROTOTYPE (throwaway): the credit batch overview with a made-up full
 * production (two feedstocks, October 2025 to October 2026). The quiet-bars timeline sits under the mass strip. Each batch opens the batch page
 * prototype in the scenario that matches its state. ?real=1 shows today's list.
 */
import Link from "next/link";
import { useState } from "react";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { PrototypeSwitcher } from "@/components/ui/prototype-switcher";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { Notice } from "@/components/ui/notice";
import { formatDateRange } from "@/lib/format-utils";
import { BATCHES, defaultNewBatchWindow, FEEDSTOCKS, type NewBatchSlot, type PipelineStage } from "./list-model";
import { ListProvider, MassPipeline, StageFilterNote } from "./list-parts";
import { QuietTimeline } from "./quiet-timeline";
import { TODAY } from "./timeline-core";

const VARIANTS = [{ key: "A", name: "Quiet bars" }] as const;

const CREATE_FORM_HREF = "/credit-batches?real=1&create=1";

/** One line per feedstock: the window the header button proposes. */
function defaultSlots(): NewBatchSlot[] {
  return FEEDSTOCKS.map((feedstock) => ({
    feedstock,
    ...defaultNewBatchWindow(BATCHES.filter((batch) => batch.feedstock === feedstock), TODAY),
  }));
}

export function PrototypeBatchList() {
  const [proposed, setProposed] = useState<NewBatchSlot[] | null>(null);
  const [stage, setStage] = useState<PipelineStage["key"] | null>(null);
  const { facilityId } = useFacilityContext();
  const real = useCreditBatches(facilityId ?? undefined);
  const realBatchId = real.data?.[0]?.id ?? null;

  return (
    <ListProvider value={{ realBatchId, stage, setStage }}>
      <div className="container-max page-shell min-w-0 pb-[240px] sm:pb-[160px]">
        <PageHeader
          area="verification"
          title="Credit Batches"
          subtitle="Carbon credit batches for verification and registry"
          actions={
            <Button variant="primary" onClick={() => setProposed(defaultSlots())}>
              <PlusIcon size={20} aria-hidden />
              New credit batch
            </Button>
          }
        />
        <MassPipeline />
        <StageFilterNote />
        <QuietTimeline onPick={(slot) => setProposed([slot])} />
        {/* PROTOTYPE: the real form cannot be prefilled with a stub feedstock, so the windows are named here. */}
        {proposed && (
          <Notice
            tone="info"
            title="New credit batch"
            action={
              <Link href={CREATE_FORM_HREF} className="body-small font-medium underline underline-offset-2">
                Open the form
              </Link>
            }
          >
            <ul>
              {proposed.map((slot) => (
                <li key={slot.feedstock}>
                  {slot.feedstock}: {formatDateRange(slot.start, slot.end)}
                </li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
      <PrototypeSwitcher variants={VARIANTS} title="Credit batch overview">
        <ul className="list-disc pl-16">
          <li>{BATCHES.length} made-up credit batches, two feedstocks, Oct 2025 to Oct 2026. Maize cobs runs mid-month to mid-month and pauses Jun 10 to Jul 19.</li>
          <li>The mass strip filters: click a stage to keep batches with biochar stuck before it.</li>
          <li>Every batch opens CB-26-001 in the matching scenario.</li>
          <li>
            <Link href="/credit-batches?real=1" className="underline">Today&apos;s list</Link>
          </li>
        </ul>
      </PrototypeSwitcher>
    </ListProvider>
  );
}
PrototypeBatchList.displayName = "PrototypeBatchList";
