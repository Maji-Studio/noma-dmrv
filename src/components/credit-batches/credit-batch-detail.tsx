/**
 * CreditBatchDetail — the credit-batch detail route's client body
 * (`/credit-batches/[id]`). One question drives the layout: is this batch
 * ready to become credits, and what needs fixing if not?
 *
 * Header (code, period, Edit) → compact batch overview → certification
 * readiness beside the lab-sample summary. Editing opens the
 * standard entity side sheet from the header — the same pattern as the list
 * page — so the detail body stays read-only. Registry/accounting data is not
 * repeated here because it is not an operator input for a production cohort.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CaretRightIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { formatDateRange } from "@/lib/format-utils";
import { ServerError } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { type CreditBatchFormData } from "@/schemas/credit-batches";
import {
  useCreditBatch,
  useCreditBatchProductionRunOptions,
  useUpdateCreditBatch,
} from "@/hooks/use-credit-batches";
import { CreditBatchForm } from "./credit-batch-form";
import { CreditBatchHealthStrip } from "./credit-batch-health-strip";
import { CreditBatchDurabilityPanel } from "./credit-batch-durability-panel";
import { CreditBatchOverview } from "./credit-batch-overview";

interface CreditBatchDetailProps {
  creditBatchId: string;
}

function Breadcrumb({ code }: { code: string | null }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-6 body-caption text-[var(--color-text-tertiary)]"
    >
      <Link
        href="/credit-batches"
        className="hover:text-[var(--color-text-secondary)] hover:underline underline-offset-2"
      >
        Credit Batches
      </Link>
      <CaretRightIcon size={12} aria-hidden />
      <span className="text-[var(--color-text-secondary)]">{code ?? "…"}</span>
    </nav>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-max page-shell">{children}</div>
  );
}

export function CreditBatchDetail({ creditBatchId }: CreditBatchDetailProps) {
  const { data: creditBatch, isLoading, error } = useCreditBatch(creditBatchId);
  // Scope to this batch's facility — overlap validation is per-facility, and
  // credit batches must never be read across the facility boundary.
  const updateCreditBatch = useUpdateCreditBatch();
  const {
    data: productionRunOptions = [],
    isLoading: productionRunsLoading,
  } = useCreditBatchProductionRunOptions({
    facilityId: creditBatch?.facilityId,
    startDate: creditBatch?.startDate,
    endDate: creditBatch?.endDate,
    includeCreditBatchId: creditBatch?.id,
  });
  const toast = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const closeEdit = () => {
    setUpdateError(null);
    setIsEditing(false);
  };

  const handleUpdate = async (data: CreditBatchFormData) => {
    setUpdateError(null);
    try {
      const { sampling, ...mutableData } = data;
      void sampling;
      const result = await updateCreditBatch.mutateAsync({
        creditBatchId,
        ...mutableData,
      });
      if (result.success) {
        toast.success("Credit batch updated successfully");
        setIsEditing(false);
      } else {
        setUpdateError(result.error || "Failed to update credit batch");
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "An error occurred while updating the credit batch";
      console.error("Credit batch update error:", { creditBatchId, message });
      setUpdateError(message);
    }
  };

  if (error) {
    return (
      <Shell>
        <Breadcrumb code={null} />
        <ServerError message={error.message || "Failed to load credit batch"} />
      </Shell>
    );
  }

  if (isLoading) {
    return (
      <Shell>
        <Breadcrumb code={null} />
        <div
          className="bg-[var(--panel-bg)] [border:var(--panel-border)] p-32"
          aria-busy="true"
        >
          <span className="body-small text-[var(--color-text-tertiary)]">
            Loading credit batch…
          </span>
        </div>
      </Shell>
    );
  }

  if (!creditBatch) {
    return (
      <Shell>
        <Breadcrumb code={null} />
        <div className="bg-[var(--panel-bg)] [border:var(--panel-border)] p-32">
          <span className="body-small text-[var(--color-text-tertiary)]">
            No credit batch found.
          </span>
        </div>
      </Shell>
    );
  }

  const period = formatDateRange(creditBatch.startDate, creditBatch.endDate);
  const memberRunIds = new Set(creditBatch.productionRunIds);
  const memberRuns = productionRunOptions.filter((run) =>
    memberRunIds.has(run.id),
  );

  return (
    <Shell>
      <Breadcrumb code={creditBatch.code} />

      {/* Header — the single Edit entry point for the whole page. No lifecycle
          badge: every batch sits at the DB default with no transition path, so
          the checklist below is the batch's real state (QA 2026-07-21 F3). */}
      <PageHeader
        area="verification"
        title={creditBatch.code}
        subtitle={period}
        actions={
          <Button variant="default" onClick={() => setIsEditing(true)}>
            <PencilSimpleIcon size={16} aria-hidden />
            Edit batch
          </Button>
        }
      />

      <CreditBatchOverview
        creditBatch={creditBatch}
        productionRuns={memberRuns}
        isLoadingRuns={productionRunsLoading}
      />

      <div className="grid grid-cols-1 items-start gap-20 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <CreditBatchHealthStrip
          creditBatchId={creditBatchId}
          facilityId={creditBatch.facilityId}
          productionRuns={memberRuns}
          feedstockName={creditBatch.feedstockTypeName}
        />
        <CreditBatchDurabilityPanel creditBatchId={creditBatchId} />
      </div>

      {/* Edit side sheet — the same form the list page mounts */}
      <SlideOverPanel.Root
        open={isEditing}
        onOpenChange={(open) => {
          if (!open) closeEdit();
        }}
      >
        <SlideOverPanel.Content size="wide">
          <SlideOverPanel.Header showClose>
            <SlideOverPanel.Title>{creditBatch.code}</SlideOverPanel.Title>
          </SlideOverPanel.Header>
          <SlideOverPanel.Body noPaddingBottom fillHeight>
            {updateError && (
              <div className="mb-24">
                <ServerError message={updateError} />
              </div>
            )}
            <CreditBatchForm
              key={creditBatch.id}
              creditBatch={creditBatch}
              onSubmit={handleUpdate}
              onClearServerError={() => setUpdateError(null)}
              onCancel={closeEdit}
              isSubmitting={updateCreditBatch.isPending}
              submitLabel="Save changes"
            />
          </SlideOverPanel.Body>
        </SlideOverPanel.Content>
      </SlideOverPanel.Root>
    </Shell>
  );
}
