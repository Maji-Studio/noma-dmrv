/**
 * CreditBatchDetail — the credit-batch detail route's client body
 * (`/credit-batches/[id]`). One question drives the layout: is this batch
 * ready to become credits, and what needs fixing if not?
 *
 * Header (code, status, Edit) → 3-card KPI strip (CO₂e stored · lab samples
 * toward the ≥3 minimum · production runs) → certification checklist →
 * lab-sample roll-up → a read-only Details reference card. Editing opens the
 * standard entity side sheet from the header — the same pattern as the list
 * page — so the detail body stays read-only. Registry-issuance figures
 * (credit weight, buffer pool) live in the Details card, not the KPI strip:
 * they are null until issuance and carry no operational signal.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CaretRightIcon,
  FlaskIcon,
  LeafIcon,
  PencilSimpleIcon,
  StackIcon,
} from "@phosphor-icons/react/dist/ssr";
import { formatSafeDate, formatTonnes } from "@/lib/format-utils";
import { ServerError } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import {
  DetailField,
  DetailRow,
  DetailSection,
} from "@/components/ui/detail-panel";
import {
  formatCreditBatchStatus,
  formatDurabilityOption,
  type CreditBatchFormData,
} from "@/schemas/credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import {
  useCreditBatch,
  useUpdateCreditBatch,
} from "@/hooks/use-credit-batches";
import { useBatchDurabilitySummary } from "@/hooks/use-certification";
import { CreditBatchForm } from "./credit-batch-form";
import { CreditBatchHealthStrip } from "./credit-batch-health-strip";
import { CreditBatchDurabilityPanel } from "./credit-batch-durability-panel";

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

/** CO₂e stored: the derived certify preview (issue #285 — never stored). */
function co2eStoredKpi(batch: CreditBatchWithRelations): {
  value: string;
  description: string | undefined;
} {
  if (batch.co2eStoredPreview?.co2eStoredTonnes != null) {
    return {
      value: formatTonnes(batch.co2eStoredPreview.co2eStoredTonnes, {
        unit: "t CO₂e",
      }),
      description: "Preview estimate",
    };
  }
  return { value: "—", description: undefined };
}

export function CreditBatchDetail({ creditBatchId }: CreditBatchDetailProps) {
  const { data: creditBatch, isLoading, error } = useCreditBatch(creditBatchId);
  // Scope to this batch's facility — overlap validation is per-facility, and
  // credit batches must never be read across the facility boundary.
  const updateCreditBatch = useUpdateCreditBatch();
  // Same roll-up the durability panel renders — React Query dedupes the fetch.
  const { data: durability, isLoading: durabilityLoading } =
    useBatchDurabilitySummary(creditBatchId);
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
      const result = await updateCreditBatch.mutateAsync({
        creditBatchId,
        ...data,
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

  const stored = co2eStoredKpi(creditBatch);
  const period = `${formatSafeDate(creditBatch.startDate)} — ${formatSafeDate(creditBatch.endDate)}`;

  return (
    <Shell>
      <Breadcrumb code={creditBatch.code} />

      {/* Header — status + the single Edit entry point for the whole page */}
      <PageHeader
        area="verification"
        title={creditBatch.code}
        subtitle={`${creditBatch.facility?.name ?? "No facility"} · ${period}`}
        actions={
          <div className="flex items-center gap-12">
            <StatusBadge
              status={creditBatch.status}
              label={formatCreditBatchStatus(creditBatch.status)}
              size="large"
            />
            <Button variant="default" onClick={() => setIsEditing(true)}>
              <PencilSimpleIcon size={16} aria-hidden />
              Edit batch
            </Button>
          </div>
        }
      />

      {/* KPI strip */}
      <div
        data-testid="batch-kpis"
        className="grid grid-cols-1 gap-24 sm:grid-cols-3"
      >
        <StatCard
          title="CO₂e stored"
          value={stored.value}
          description={stored.description}
          icon={<LeafIcon size={24} />}
        />
        <StatCard
          title="Lab samples"
          value={
            durability
              ? `${durability.usableReplicateCount} of ${durability.minimumReplicates}`
              : "—"
          }
          description="usable for certification"
          icon={<FlaskIcon size={24} />}
          isLoading={durabilityLoading}
        />
        <StatCard
          title="Production runs"
          value={creditBatch.productionRunCount}
          description="in this batch"
          icon={<StackIcon size={24} />}
        />
      </div>

      {/* Certification checklist */}
      <CreditBatchHealthStrip
        creditBatchId={creditBatchId}
        facilityId={creditBatch.facilityId}
      />

      {/* Lab-sample roll-up + readiness (ADR 0016) */}
      <CreditBatchDurabilityPanel creditBatchId={creditBatchId} />

      {/* Details — read-only reference. Anchor target for checklist fix links. */}
      <section
        id="batch-details"
        className="flex flex-col gap-20 bg-[var(--panel-bg)] [border:var(--panel-border)] p-32 scroll-mt-24"
      >
        <h2 className="title-heading-3">Details</h2>

        <div className="flex flex-col gap-20">
          <DetailSection title="Overview" divider={false}>
            <DetailRow>
              <DetailField
                label="Start date"
                value={formatSafeDate(creditBatch.startDate)}
              />
              <DetailField
                label="End date"
                value={formatSafeDate(creditBatch.endDate)}
              />
            </DetailRow>
            <DetailRow>
              <DetailField
                label="Durability option"
                value={formatDurabilityOption(creditBatch.durabilityOption)}
              />
              <DetailField
                label="Site management notes"
                value={creditBatch.siteManagementNotes}
              />
            </DetailRow>
          </DetailSection>

          <DetailSection title="Registry & accounting">
            <DetailRow>
              <DetailField
                label="Applied weight"
                value={formatTonnes(creditBatch.appliedWeightTons)}
              />
              <DetailField
                label="Buffer pool"
                value={
                  creditBatch.bufferPoolPercent != null
                    ? `${creditBatch.bufferPoolPercent}%`
                    : "—"
                }
              />
            </DetailRow>
            <DetailRow>
              <DetailField
                label="Registry"
                value={creditBatch.registry}
              />
              <DetailField
                label="Credit value"
                value={
                  creditBatch.value != null
                    ? `${creditBatch.value}${creditBatch.currency ? ` ${creditBatch.currency}` : ""}`
                    : "—"
                }
              />
            </DetailRow>
          </DetailSection>
        </div>
      </section>

      {/* Edit side sheet — the same form the list page mounts */}
      <SlideOverPanel.Root
        open={isEditing}
        onOpenChange={(open) => {
          if (!open) closeEdit();
        }}
      >
        <SlideOverPanel.Content size="wide">
          <SlideOverPanel.Header showClose>
            <div className="flex min-w-0 flex-col gap-4">
              <SlideOverPanel.Title>{creditBatch.code}</SlideOverPanel.Title>
              <SlideOverPanel.Description>
                {creditBatch.facility?.name ?? "No facility"}
              </SlideOverPanel.Description>
            </div>
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
