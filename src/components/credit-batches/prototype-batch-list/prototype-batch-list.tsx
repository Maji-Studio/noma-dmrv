"use client";

/**
 * PROTOTYPE (throwaway): the credit batch overview with a made-up full
 * production (two feedstocks, October 2025 to October 2026). Three timeline refinements on
 * ?variant=A|B|C share the mass strip on top. Each batch opens the batch page
 * prototype in the scenario that matches its state. ?real=1 shows today's list.
 */
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { PrototypeSwitcher, resolveVariant } from "@/components/ui/prototype-switcher";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { BATCHES, type PipelineStage } from "./list-model";
import { ListProvider, MassPipeline, StageFilterNote } from "./list-parts";
import { QuietTimeline, TrackTimeline, VolumeTimeline } from "./timeline-versions";

const VARIANTS = [
  { key: "A", name: "Quiet bars" },
  { key: "B", name: "Thin track" },
  { key: "C", name: "Bars and volume" },
] as const;

export function PrototypeBatchList() {
  const searchParams = useSearchParams();
  const variant = resolveVariant(VARIANTS, searchParams.get("variant"));
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
            <Button variant="primary">
              <PlusIcon size={20} aria-hidden />
              New credit batch
            </Button>
          }
        />
        <MassPipeline />
        <StageFilterNote />
        {variant.key === "A" && <QuietTimeline />}
        {variant.key === "B" && <TrackTimeline />}
        {variant.key === "C" && <VolumeTimeline />}
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
