/**
 * CreditBatchDetail — the credit-batch detail route's client body
 * (`/credit-batches/[id]`), recut in Phase 5 of the visual design plan:
 * proper detail header (eyebrow, code, status, period) over a KPI strip
 * (CO₂e stored · credit weight · buffer pool · applications), the batch
 * health check as a compact checklist strip, and the batch's own data as
 * read panels — the edit form only mounts behind the "Edit details" toggle,
 * so inputs no longer sit directly in the detail view. The health strip's
 * carbon fix link anchors to the `#batch-details` section here, closing the
 * loop on a single page.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CaretRight,
  Leaf,
  Scales,
  ShieldCheck,
  Stack,
} from "@phosphor-icons/react/dist/ssr";
import { formatSafeDate, formatTonnes } from "@/lib/format-utils";
import { ServerError } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
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
  useCreditBatches,
  useUpdateCreditBatch,
} from "@/hooks/use-credit-batches";
import { CreditBatchForm, type ApplicationOption } from "./credit-batch-form";
import { CreditBatchHealthStrip } from "./credit-batch-health-strip";

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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-max page-shell">{children}</div>
  );
}

/** CO₂e stored: the registry figure when present, else the certify preview. */
function co2eStoredKpi(batch: CreditBatchWithRelations): {
  value: string;
  description: string | undefined;
} {
  if (batch.totalCo2eStoredTons != null) {
    return {
      value: formatTonnes(batch.totalCo2eStoredTons, { unit: "t CO₂e" }),
      description: "Registry accounting",
    };
  }
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
  const [isEditing, setIsEditing] = useState(false);
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

  const existingBatches = (allBatches ?? []).map((b) => ({
    id: b.id,
    code: b.code,
    facilityId: b.facilityId,
    startDate: b.startDate,
    endDate: b.endDate,
  }));

  const stored = co2eStoredKpi(creditBatch);
  const period = `${formatSafeDate(creditBatch.startDate)} — ${formatSafeDate(creditBatch.endDate)}`;

  return (
    <Shell>
      <Breadcrumb code={creditBatch.code} />

      {/* Header */}
      <PageHeader
        area="verification"
        title={creditBatch.code}
        subtitle={`${creditBatch.facility?.name ?? "No facility"} · ${period}`}
        actions={
          <StatusBadge
            status={creditBatch.status}
            label={formatCreditBatchStatus(creditBatch.status)}
            size="large"
          />
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-24 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="CO₂e stored"
          value={stored.value}
          description={stored.description}
          icon={<Leaf size={24} />}
        />
        <StatCard
          title="Credit weight"
          value={formatTonnes(creditBatch.weightTons)}
          description="Registry issuance"
          icon={<Scales size={24} />}
        />
        <StatCard
          title="Buffer pool"
          value={
            creditBatch.bufferPoolPercent != null
              ? `${creditBatch.bufferPoolPercent}%`
              : "—"
          }
          description="Risk-based (2–20%)"
          icon={<ShieldCheck size={24} />}
        />
        <StatCard
          title="Applications"
          value={creditBatch.applicationCount}
          description="Matched by crediting period"
          icon={<Stack size={24} />}
        />
      </div>

      {/* Health check strip */}
      <CreditBatchHealthStrip
        creditBatchId={creditBatchId}
        facilityId={creditBatch.facilityId}
      />

      {/* Batch details — read panels; the edit form mounts behind the toggle.
          Anchor target for the health strip's carbon fix link. */}
      <section
        id="batch-details"
        className="flex flex-col gap-24 bg-[var(--panel-bg)] [border:var(--panel-border)] p-32 scroll-mt-24"
      >
        <div className="flex items-center justify-between gap-16">
          <h2 className="title-heading-3 flex items-center gap-6">
            Batch details
            <InfoHint>
              Crediting period and durability drive the carbon accounting
              above.
            </InfoHint>
          </h2>
          {!isEditing && (
            <Button variant="default" onClick={() => setIsEditing(true)}>
              Edit details
            </Button>
          )}
        </div>

        {updateError && <ServerError message={updateError} />}

        {isEditing ? (
          <CreditBatchForm
            creditBatch={creditBatch}
            applications={applications}
            existingBatches={existingBatches}
            onSubmit={handleUpdate}
            onCancel={() => {
              setUpdateError(null);
              setIsEditing(false);
            }}
            isSubmitting={updateCreditBatch.isPending}
            submitLabel="Save changes"
            stickyActions={false}
          />
        ) : (
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
            </DetailSection>

            <DetailSection title="Durability">
              <DetailRow>
                <DetailField
                  label="Durability option"
                  value={formatDurabilityOption(creditBatch.durabilityOption)}
                />
                <DetailField
                  label="Applications in period"
                  value={creditBatch.applicationCount}
                />
              </DetailRow>
            </DetailSection>

            <DetailSection title="Site management">
              <DetailField
                label="Notes"
                value={creditBatch.siteManagementNotes}
              />
            </DetailSection>

            <DetailSection title="Registry & accounting">
              <DetailRow>
                <DetailField
                  label="CO₂e emissions"
                  value={formatTonnes(creditBatch.totalCo2eEmissionsTons)}
                />
                <DetailField
                  label="CO₂e counterfactual"
                  value={formatTonnes(creditBatch.totalCo2eCounterfactualTons)}
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
        )}
      </section>
    </Shell>
  );
}
