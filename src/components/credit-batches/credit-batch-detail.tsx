/**
 * CreditBatchDetail — the credit-batch detail route's client body
 * (`/credit-batches/[id]`). Top of the page is the batch health check (the
 * batch-grain readiness gate introduced in the certify-removal redesign);
 * below it sits the batch's own detail/edit form. The carbon health check's fix
 * link anchors to the `#batch-details` section here, closing the loop on a
 * single page.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { formatSafeDate } from "@/lib/format-utils";
import { ServerError } from "@/components/forms";
import { InfoHint } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatCreditBatchStatus,
  type CreditBatchFormData,
} from "@/schemas/credit-batches";
import {
  useCreditBatch,
  useCreditBatches,
  useUpdateCreditBatch,
} from "@/hooks/use-credit-batches";
import { CreditBatchForm, type ApplicationOption } from "./credit-batch-form";
import { CreditBatchHealthPanel } from "./credit-batch-health-panel";

interface CreditBatchDetailProps {
  creditBatchId: string;
  applications?: ApplicationOption[];
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
      <CaretRight size={12} aria-hidden />
      <span className="text-[var(--color-text-secondary)]">{code ?? "…"}</span>
    </nav>
  );
}

export function CreditBatchDetail({
  creditBatchId,
  applications = [],
}: CreditBatchDetailProps) {
  const { data: creditBatch, isLoading, error } = useCreditBatch(creditBatchId);
  // Scope to this batch's facility — overlap validation is per-facility, and
  // credit batches must never be read across the facility boundary.
  const { data: allBatches } = useCreditBatches(creditBatch?.facilityId);
  const updateCreditBatch = useUpdateCreditBatch();
  const toast = useToast();
  const [updateError, setUpdateError] = useState<string | null>(null);

  const handleUpdate = async (data: CreditBatchFormData) => {
    setUpdateError(null);
    try {
      const result = await updateCreditBatch.mutateAsync({
        creditBatchId,
        ...data,
      });
      if (result.success) {
        toast.success("Credit batch updated successfully");
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
      <div className="mx-auto w-full max-w-[1200px] px-24 py-32 flex flex-col gap-32">
        <Breadcrumb code={null} />
        <ServerError message={error.message || "Failed to load credit batch"} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-24 py-32 flex flex-col gap-32">
        <Breadcrumb code={null} />
        <div
          className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-32"
          aria-busy="true"
        >
          <span className="body-small text-[var(--color-text-tertiary)]">
            Loading credit batch…
          </span>
        </div>
      </div>
    );
  }

  if (!creditBatch) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-24 py-32 flex flex-col gap-32">
        <Breadcrumb code={null} />
        <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-32">
          <span className="body-small text-[var(--color-text-tertiary)]">
            No credit batch found.
          </span>
        </div>
      </div>
    );
  }

  const existingBatches = (allBatches ?? []).map((b) => ({
    id: b.id,
    code: b.code,
    facilityId: b.facilityId,
    startDate: b.startDate,
    endDate: b.endDate,
  }));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-24 py-32 flex flex-col gap-32">
      <Breadcrumb code={creditBatch.code} />

      {/* Header */}
      <header className="flex flex-col gap-16 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] p-32">
        <div className="flex items-start justify-between gap-24">
          <div className="flex flex-col gap-4">
            <h1 className="title-heading-2">{creditBatch.code}</h1>
            <p className="body-small text-[var(--color-text-secondary)]">
              {creditBatch.facility?.name ?? "No facility"} ·{" "}
              {formatSafeDate(creditBatch.startDate)} —{" "}
              {formatSafeDate(creditBatch.endDate)}
            </p>
          </div>
          <StatusBadge
            status={creditBatch.status}
            label={formatCreditBatchStatus(creditBatch.status)}
          />
        </div>
      </header>

      {/* Health check */}
      <CreditBatchHealthPanel
        creditBatchId={creditBatchId}
        facilityId={creditBatch.facilityId}
      />

      {/* Batch details / edit — anchor target for the carbon health fix link */}
      <section
        id="batch-details"
        className="flex flex-col gap-24 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-32 scroll-mt-24"
      >
        <h2 className="title-heading-3 flex items-center gap-6">
          Batch details
          <InfoHint>
            Crediting period and durability drive the carbon accounting above.
          </InfoHint>
        </h2>

        {updateError && <ServerError message={updateError} />}

        <CreditBatchForm
          creditBatch={creditBatch}
          applications={applications}
          existingBatches={existingBatches}
          onSubmit={handleUpdate}
          isSubmitting={updateCreditBatch.isPending}
          submitLabel="Save changes"
          stickyActions={false}
        />
      </section>
    </div>
  );
}
