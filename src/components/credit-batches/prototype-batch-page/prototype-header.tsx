"use client";

/** PROTOTYPE (throwaway): page header shared by the variants. */
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui";
import { formatDateRange } from "@/lib/format-utils";
import { useProto } from "./prototype-context";
import { LockPill, OverflowMenu, PrimaryAction, ProgressSteps } from "./prototype-parts";

export function BatchHeader({ withProgress = true }: { withProgress?: boolean }) {
  const { batch } = useProto();
  return (
    <div className="flex flex-col gap-16">
      <Link href={`/credit-batches?facility=${batch.facilityId}`} className="inline-flex items-center gap-6 self-start body-small underline-offset-2 hover:underline">
        <ArrowLeftIcon size={14} aria-hidden />
        All credit batches
      </Link>
      <PageHeader
        area="certification"
        title={batch.code}
        subtitle={[batch.feedstockTypeName, batch.facility?.name, formatDateRange(batch.startDate, batch.endDate)].filter(Boolean).join(", ")}
        actions={
          <>
            <PrimaryAction />
            <OverflowMenu />
          </>
        }
      />
      {withProgress && (
        <div className="flex flex-col gap-12 border-y border-[var(--color-border-tertiary)] py-12 lg:flex-row lg:items-center lg:justify-between lg:gap-32">
          <div className="min-w-0 lg:max-w-[640px] lg:flex-1">
            <ProgressSteps />
          </div>
          <LockPill />
        </div>
      )}
    </div>
  );
}
