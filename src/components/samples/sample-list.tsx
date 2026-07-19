/**
 * SampleList component
 * Main sample listing with CRUD operations, stat cards, filters, and DataTable
 */
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { FlaskIcon, LeafIcon, MagnifyingGlassIcon, PlusIcon, XIcon, FireIcon, CertificateIcon } from "@phosphor-icons/react/dist/ssr";
import { parseAsString, useQueryState } from "nuqs";
import {
  useCreateSample,
  useDeleteSample,
  useSample,
  useSamples,
  useUpdateSample,
  useSampleStats,
} from "@/hooks/use-samples";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDeferredAttachments } from "@/hooks/use-deferred-attachments";
import { useCreateTransportLeg } from "@/hooks/use-transport-legs";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { TransportLegsSummary } from "@/components/transport-legs";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { formatDate, formatDateTime } from "@/lib/format-utils";
import { SampleForm } from "./sample-form";
import {
  formatDurabilityOption,
  type SampleFormData,
  type SampleFilterData,
} from "@/schemas/samples";
import type { SampleWithRelations } from "@/data-access/samples";
import type { TransportLegFormData } from "@/schemas/transport-legs";
import { SampleDocumentsPanel } from "./sample-documents-panel";

const READINESS_PREVIEW_LIMIT = 3;

// ============================================
// Durability Badge
// ============================================

function DurabilityBadge({ durability }: { durability: "200_year" | "1000_year" }) {
  const label = formatDurabilityOption(durability);
  const is1000Year = durability === "1000_year";
  return (
    <span
      className={`inline-flex items-center gap-4 px-8 py-2 text-[11px] font-medium uppercase tracking-[0.06em] ${
        is1000Year
          ? "border border-[var(--clr-purple-20)] bg-[var(--clr-purple-10)] text-[var(--clr-purple)]"
          : "border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] text-[var(--color-text-secondary)]"
      }`}
    >
      {is1000Year && <CertificateIcon size={12} weight="fill" />}
      {label}
    </span>
  );
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (sample: SampleWithRelations) => void,
  onDelete: (sampleId: string) => void
): ColumnDef<SampleWithRelations>[] {
  return [
    {
      accessorKey: "sampleCode",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">
          {row.original.sampleCode}
        </span>
      ),
    },
    {
      accessorKey: "samplingTime",
      header: "Sampling Time",
      cell: ({ row }) => formatDateTime(row.original.samplingTime),
    },
    {
      id: "creditBatch",
      header: "Credit Batch",
      accessorFn: (row) => row.creditBatchCode ?? "",
      cell: ({ row }) => (
        <span className="text-[var(--clr-dark-purple)]">
          {row.original.creditBatchCode ?? "\u2014"}
        </span>
      ),
    },
    {
      accessorKey: "totalCarbonPercent",
      header: "Total C (%)",
      cell: ({ row }) => row.original.totalCarbonPercent?.toFixed(1) ?? "\u2014",
    },
    {
      accessorKey: "organicCarbonPercent",
      header: "Organic C (%)",
      cell: ({ row }) => row.original.organicCarbonPercent?.toFixed(1) ?? "\u2014",
    },
    {
      accessorKey: "hToCOrgRatio",
      header: "H:C Ratio",
      cell: ({ row }) => row.original.hToCOrgRatio?.toFixed(3) ?? "\u2014",
    },
    {
      accessorKey: "durabilityOption",
      header: "Durability",
      cell: ({ row }) => <DurabilityBadge durability={row.original.durabilityOption} />,
    },
    {
      id: "certifyReadiness",
      header: "Chemistry",
      cell: ({ row }) => (
        <EntityCertifyReadinessBadge
          readiness={deriveEntityCertifyReadiness("sample", row.original)}
          readyLabel="Chemistry complete"
          readinessNoun="sample chemistry"
        />
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <RowActionsMenu
            label={`Actions for ${row.original.sampleCode}`}
            actions={[
              { label: "Edit", onSelect: () => onEdit(row.original) },
              { label: "Delete", destructive: true, onSelect: () => onDelete(row.original.id) },
            ]}
          />
        </div>
      ),
      enableSorting: false,
    },
  ];
}

// ============================================
// Side Sheet State
// ============================================

type SideSheetState =
  | { mode: "create"; entity: null }
  | { mode: "view"; entity: SampleWithRelations }
  | { mode: "edit"; entity: SampleWithRelations };

// ============================================
// Component
// ============================================

export function SampleList() {
  const { facilityId: contextFacilityId } = useFacilityContext();
  const [focusedSampleId, setFocusedSampleId] = useQueryState(
    "sample",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [creditBatchFilter, setCreditBatchFilter] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [deletingSampleId, setDeletingSampleId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filters: Partial<SampleFilterData> = useMemo(() => ({
    search: searchQuery || undefined,
    creditBatchId: creditBatchFilter || undefined,
    facilityId: contextFacilityId || undefined,
    page: currentPage,
    pageSize,
    sortBy: "samplingTime",
    sortOrder: "desc",
  }), [searchQuery, creditBatchFilter, contextFacilityId, currentPage, pageSize]);

  const { data: samplesData, isLoading, error: fetchError } = useSamples(filters, {
    enabled: !!contextFacilityId,
  });
  const { data: statsData, isLoading: statsLoading } = useSampleStats(
    creditBatchFilter || undefined,
    !!contextFacilityId,
    contextFacilityId || undefined,
  );
  const { data: creditBatchesData } = useCreditBatches(
    contextFacilityId || undefined,
  );
  const focusedSample = useSample(focusedSampleId ?? "", !!focusedSampleId);

  const createSample = useCreateSample();
  const updateSample = useUpdateSample();
  const deleteSample = useDeleteSample();
  const toast = useToast();
  const deferredAttachments = useDeferredAttachments();
  const createTransportLeg = useCreateTransportLeg();
  const [deferredLegs, setDeferredLegs] = useState<TransportLegFormData[]>([]);
  const [isFlushing, setIsFlushing] = useState(false);

  const samples = samplesData?.items ?? [];
  const totalPages = samplesData?.totalPages ?? 0;
  useEffect(() => {
    if (!focusedSampleId) return;
    if (focusedSample.error || (focusedSample.isSuccess && !focusedSample.data)) {
      setFocusedSampleId(null);
      toast.error("Linked sample could not be opened");
    }
  }, [
    focusedSample.data,
    focusedSample.error,
    focusedSample.isSuccess,
    focusedSampleId,
    setFocusedSampleId,
    toast,
  ]);

  const deepLinkedSideSheet =
    focusedSampleId && focusedSample.data
      ? ({ mode: "view", entity: focusedSample.data } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;
  const showSavedToast = (message: string, sample: SampleWithRelations) => {
    const readiness = deriveEntityCertifyReadiness("sample", sample);
    if (readiness.state === "ready") {
      toast.success(message);
      return;
    }
    const gapLabels = readiness.gaps
      .slice(0, READINESS_PREVIEW_LIMIT)
      .map((gap) => gap.label)
      .join(", ");
    const suffix = readiness.gaps.length > READINESS_PREVIEW_LIMIT ? ", ..." : "";
    toast.success(`${message}. Still needed to certify: ${gapLabels}${suffix}`);
  };

  const handleCreate = async (data: SampleFormData) => {
    setFormError(null);
    try {
      const sample = await createSample.mutateAsync(data);
      setIsFlushing(true);
      const attachmentResult = await deferredAttachments.flush("sample", sample.id);
      const failedLegs: TransportLegFormData[] = [];
      for (const leg of deferredLegs) {
        try {
          await createTransportLeg.mutateAsync({
            ...leg,
            entityType: "sample",
            entityId: sample.id,
          });
        } catch {
          failedLegs.push(leg);
        }
      }
      setDeferredLegs(failedLegs);

      const failedCount = attachmentResult.failed.length + failedLegs.length;
      if (failedCount > 0) {
        setSideSheet({ mode: "edit", entity: sample });
        setFormError(
          `Sample created, but ${failedCount} ${failedCount === 1 ? "attachment" : "attachments"} failed to save.`,
        );
        return;
      }

      deferredAttachments.clear();
      setSideSheet(null);
      showSavedToast("Sample created successfully", sample);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to create sample");
    } finally {
      setIsFlushing(false);
    }
  };

  // Keep the post-create "failed to save" banner in sync when the user retries
  // or removes individual failures inline: recompute it from the remaining
  // failed attachments and transport legs so a fully-resolved queue clears it.
  const setCreateFailureBanner = (
    failedAttachments: number,
    failedLegs: number,
  ) => {
    const total = failedAttachments + failedLegs;
    setFormError(
      total > 0
        ? `Sample created, but ${total} ${total === 1 ? "attachment" : "attachments"} failed to save.`
        : null,
    );
  };

  const handleRetryDeferredAttachments = async (key?: string) => {
    if (sideSheet?.mode !== "edit") return;
    const result = await deferredAttachments.retry(
      "sample",
      [sideSheet.entity.id],
      key,
    );
    // Failures this retry did not target stay failed (excluded by key); add
    // whatever this attempt left failed.
    const untouchedFailed =
      key === undefined
        ? 0
        : deferredAttachments.attachments.filter(
            (attachment) =>
              attachment.status === "failed" && attachment.key !== key,
          ).length;
    setCreateFailureBanner(
      untouchedFailed + result.failed.length,
      deferredLegs.length,
    );
  };

  const handleRemoveDeferredAttachment = (key: string) => {
    deferredAttachments.remove(key);
    if (sideSheet?.mode !== "edit") return;
    const remainingFailed = deferredAttachments.attachments.filter(
      (attachment) => attachment.status === "failed" && attachment.key !== key,
    ).length;
    setCreateFailureBanner(remainingFailed, deferredLegs.length);
  };

  const handleDeferredLegsChange = (legs: TransportLegFormData[]) => {
    setDeferredLegs(legs);
    // Removing a failed leg from the post-create failure list must reconcile
    // the banner too (adding legs only happens pre-create, where mode !== edit
    // short-circuits and there is no banner yet).
    if (sideSheet?.mode !== "edit") return;
    const failedAttachments = deferredAttachments.attachments.filter(
      (attachment) => attachment.status === "failed",
    ).length;
    setCreateFailureBanner(failedAttachments, legs.length);
  };

  const retryDeferredLegs = async () => {
    if (sideSheet?.mode !== "edit" || deferredLegs.length === 0) return;
    setIsFlushing(true);
    const failedLegs: TransportLegFormData[] = [];
    try {
      for (const leg of deferredLegs) {
        try {
          await createTransportLeg.mutateAsync({
            ...leg,
            entityType: "sample",
            entityId: sideSheet.entity.id,
          });
        } catch {
          failedLegs.push(leg);
        }
      }
      setDeferredLegs(failedLegs);
      setFormError(
        failedLegs.length > 0
          ? `Sample was saved, but ${failedLegs.length} transport ${failedLegs.length === 1 ? "leg" : "legs"} still failed to save.`
          : null,
      );
    } finally {
      setIsFlushing(false);
    }
  };

  const handleUpdate = async (data: SampleFormData) => {
    if (sideSheet?.mode !== "edit") return;
    setFormError(null);
    if (
      deferredLegs.length > 0 ||
      deferredAttachments.attachments.some(
        // Any not-yet-`uploaded` entry is unresolved: "failed" awaits a retry,
        // and "uploading" means an attachment retry is mid-flight whose state a
        // save would clobber. Both must block the save.
        (attachment) => attachment.status !== "uploaded",
      )
    ) {
      setFormError(
        "Resolve or remove the failed attachments and transport legs before saving this sample.",
      );
      return;
    }
    try {
      const sample = await updateSample.mutateAsync({
        sampleId: sideSheet.entity.id,
        ...data,
      });
      deferredAttachments.clear();
      setDeferredLegs([]);
      setSideSheet(null);
      showSavedToast("Sample updated successfully", sample);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to update sample");
    }
  };

  const handleDelete = useCallback(
    (sampleId: string) => setDeletingSampleId(sampleId),
    [],
  );
  const handleDeleteConfirm = async () => {
    if (!deletingSampleId) return;
    setDeleteError(null);
    try {
      await deleteSample.mutateAsync(deletingSampleId);
      setDeletingSampleId(null);
      toast.success("Sample deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete sample");
    }
  };

  const openCreate = () => {
    setFocusedSampleId(null);
    setFormError(null);
    deferredAttachments.clear();
    setDeferredLegs([]);
    setSideSheet({ mode: "create", entity: null });
  };
  const openView = (sample: SampleWithRelations) => {
    setFocusedSampleId(sample.id);
    setFormError(null);
    setSideSheet({ mode: "view", entity: sample });
  };
  const openEdit = useCallback((sample: SampleWithRelations) => {
    setFormError(null);
    setSideSheet({ mode: "edit", entity: sample });
  }, []);
  const closeSideSheet = () => {
    setFocusedSampleId(null);
    setSideSheet(null);
    setFormError(null);
    deferredAttachments.clear();
    setDeferredLegs([]);
  };

  const unsavedAttachmentCount =
    deferredAttachments.attachments.filter(
      (attachment) => attachment.status !== "uploaded",
    ).length + deferredLegs.length;
  const confirmCreateClose = () => {
    // An in-flight flush is mid-write; blocking Escape/backdrop/X keeps the
    // completion handler from mutating a discarded-then-reopened form.
    if (isFlushing) return false;
    return (
      displaySideSheet?.mode !== "create" ||
      unsavedAttachmentCount === 0 ||
      window.confirm(`Discard ${unsavedAttachmentCount} unsaved attachment(s)?`)
    );
  };
  const attemptCloseSideSheet = () => {
    if (confirmCreateClose()) closeSideSheet();
  };

  const handleModeChange = (mode: SideSheetMode) => {
    if (!displaySideSheet?.entity) return;
    setFormError(null);
    if (mode === "edit") {
      setSideSheet({ mode: "edit", entity: displaySideSheet.entity });
    } else if (mode === "view") {
      setSideSheet({ mode: "view", entity: displaySideSheet.entity });
    }
  };

  const clearFilters = () => { setSearchQuery(""); setCreditBatchFilter(""); setCurrentPage(1); };
  const hasActiveFilters = searchQuery || creditBatchFilter;

  const editingEntity =
    displaySideSheet?.mode === "edit" ? displaySideSheet.entity : null;
  const isSubmitting =
    createSample.isPending || updateSample.isPending || isFlushing;

  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="verification"
          title="Lab Samples"
          subtitle="Lab analysis of biochar samples and carbon permanence"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its lab samples." />
      </div>
    );
  }

  if (fetchError) {
    return <div className="container-max py-32"><ServerError message={fetchError.message || "Failed to load samples"} /></div>;
  }

  const viewingEntity =
    displaySideSheet?.mode === "view" ? displaySideSheet.entity : null;
  const viewSubtitle = viewingEntity
    ? [viewingEntity.creditBatchCode, viewingEntity.facilityName].filter(Boolean).join(" \u2014 ") || undefined
    : undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="verification"
        title="Lab Samples"
        subtitle="Lab analysis of biochar samples and carbon permanence"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New Sample
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        <StatCard title="Total Samples" value={statsData?.totalSamples ?? 0} icon={<FlaskIcon size={24} weight="bold" />} description="All lab samples" isLoading={statsLoading} />
        <StatCard title="Avg Carbon %" value={statsData?.avgCarbonPercent?.toFixed(1) ?? "-"} icon={<LeafIcon size={24} weight="bold" />} description="Average total carbon" isLoading={statsLoading} />
        <StatCard title="200-Year" value={statsData?.samples200Year ?? 0} icon={<FireIcon size={24} weight="bold" />} description="Standard durability" isLoading={statsLoading} />
        <StatCard title="1000-Year" value={statsData?.samples1000Year ?? 0} icon={<CertificateIcon size={24} weight="bold" />} description="Enhanced durability" isLoading={statsLoading} />
      </div>

      <DataTable
        columns={columns}
        data={samples}
        enableSorting
        enablePagination
        manualPagination
        pageCount={totalPages}
        pageSize={pageSize}
        pageIndex={currentPage - 1}
        onPaginationChange={(p) => {
          if (p.pageSize !== pageSize) { setPageSize(p.pageSize); setCurrentPage(1); }
          else { setCurrentPage(p.pageIndex + 1); }
        }}
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<FlaskIcon size={48} />}
            title={hasActiveFilters ? "No samples found" : "No samples yet"}
            description={
              hasActiveFilters
                ? "Try adjusting your search or filters."
                : "Create your first lab sample to start tracking biochar quality."
            }
            action={
              !hasActiveFilters ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={20} weight="bold" />
                  Create Sample
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <div className="relative max-w-[320px] flex-1">
            <MagnifyingGlassIcon size={18} className="absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none" />
            <input
              type="text"
              placeholder="Search samples..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full h-40 pl-36 pr-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              aria-label="Search table"
            />
          </div>
          <div className="flex items-center gap-8">
            <select
              value={creditBatchFilter}
              onChange={(e) => { setCreditBatchFilter(e.target.value); setCurrentPage(1); }}
              className="h-40 px-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small cursor-pointer"
              aria-label="Filter by credit batch"
            >
              <option value="">All Credit Batches</option>
              {creditBatchesData?.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code}
                </option>
              ))}
            </select>
            {hasActiveFilters && (
              <Button variant="noOutline" size="small" onClick={clearFilters}>
                <XIcon size={16} weight="bold" />
                Clear
              </Button>
            )}
          </div>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteError && <ServerError message={deleteError} />}
      <DeleteConfirmDialog
        isOpen={!!deletingSampleId}
        title="Delete Sample"
        message="Are you sure you want to delete this sample? This action cannot be undone. Note: Samples linked to credit batches cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeletingSampleId(null); setDeleteError(null); }}
        isPending={deleteSample.isPending}
      />

      <EntitySideSheet
        open={!!displaySideSheet}
        onOpenChange={(open) => { if (!open) closeSideSheet(); }}
        onCloseAttempt={confirmCreateClose}
        mode={displaySideSheet?.mode ?? "create"}
        onModeChange={handleModeChange}
        title={displaySideSheet?.mode === "create" ? "Create Sample" : (displaySideSheet?.entity?.sampleCode ?? "")}
        subtitle={displaySideSheet?.mode === "create" ? undefined : viewSubtitle}
        editLabel="Edit Sample"
        sections={displaySideSheet?.mode === "view" && displaySideSheet.entity ? [
          {
            title: "General",
            fields: [
              { label: "Sample Code", value: displaySideSheet.entity.sampleCode },
              { label: "Sampling Time", value: formatDateTime(displaySideSheet.entity.samplingTime) },
              { label: "Credit Batch", value: displaySideSheet.entity.creditBatchCode },
              { label: "Facility", value: displaySideSheet.entity.facilityName },
              {
                label: "Sample chemistry",
                value: (
                  <EntityCertifyReadinessBadge
                    readiness={deriveEntityCertifyReadiness(
                      "sample",
                      displaySideSheet.entity,
                    )}
                    readyLabel="Chemistry complete"
                    readinessNoun="sample chemistry"
                  />
                ),
              },
            ],
          },
          {
            title: "Carbon Analysis",
            fields: [
              { label: "Total Carbon", value: displaySideSheet.entity.totalCarbonPercent != null ? `${displaySideSheet.entity.totalCarbonPercent.toFixed(1)}%` : null },
              { label: "Organic Carbon", ...certificationDetailField("sample", "organicCarbonPercent"), value: displaySideSheet.entity.organicCarbonPercent != null ? `${displaySideSheet.entity.organicCarbonPercent.toFixed(1)}%` : null },
              { label: "Inorganic Carbon", value: displaySideSheet.entity.inorganicCarbonPercent != null ? `${displaySideSheet.entity.inorganicCarbonPercent.toFixed(1)}%` : null },
              { label: "H:Corg Ratio", ...certificationDetailField("sample", "hToCOrgRatio"), value: displaySideSheet.entity.hToCOrgRatio != null ? displaySideSheet.entity.hToCOrgRatio.toFixed(3) : null },
            ],
          },
          {
            title: "Durability",
            fields: [
              { label: "Durability Option", value: formatDurabilityOption(displaySideSheet.entity.durabilityOption) },
              { label: "Random Reflectance R0", ...certificationDetailField("sample", "randomReflectanceR0Percent"), value: displaySideSheet.entity.randomReflectanceR0Percent != null ? `${displaySideSheet.entity.randomReflectanceR0Percent.toFixed(1)}%` : null },
              { label: "Reactive Carbon", ...certificationDetailField("sample", "reactiveCarbonPercent"), value: displaySideSheet.entity.reactiveCarbonPercent != null ? `${displaySideSheet.entity.reactiveCarbonPercent.toFixed(1)}%` : null },
              { label: "Residual Carbon", ...certificationDetailField("sample", "residualCarbonPercent"), value: displaySideSheet.entity.residualCarbonPercent != null ? `${displaySideSheet.entity.residualCarbonPercent.toFixed(1)}%` : null },
            ],
          },
          {
            title: "Physical Properties",
            fields: [
              { label: "Bulk Density", value: displaySideSheet.entity.bulkDensityKgPerM3 != null ? `${displaySideSheet.entity.bulkDensityKgPerM3} kg/m\u00B3` : null },
              { label: "pH", value: displaySideSheet.entity.ph != null ? String(displaySideSheet.entity.ph) : null },
            ],
          },
          {
            title: "Lab Information",
            fields: [
              { label: "Lab Name", value: displaySideSheet.entity.labName },
              { label: "Lab Accreditation", value: displaySideSheet.entity.labAccreditation },
              { label: "Analysis Date", value: formatDate(displaySideSheet.entity.analysisDate) },
            ],
          },
        ] : undefined}
        viewModeChildren={
          displaySideSheet?.mode === "view" && displaySideSheet.entity ? (
            <>
              <TransportLegsSummary
                entityType="sample"
                entityId={displaySideSheet.entity.id}
              />
              <section className="space-y-16 border-t border-[var(--color-border-tertiary)] pt-16">
                <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  Evidence &amp; Documents
                </h3>
                <SampleDocumentsPanel
                  sampleId={displaySideSheet.entity.id}
                  readOnly
                />
              </section>
            </>
          ) : null
        }
      >
        {formError && <div className="mb-24"><ServerError message={formError} /></div>}
        <SampleForm
          key={editingEntity?.id ?? "create"}
          sample={editingEntity ?? undefined}
          onSubmit={displaySideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={attemptCloseSideSheet}
          isSubmitting={isSubmitting}
          submitLabel={displaySideSheet?.mode === "edit" ? "Save Changes" : "Create Sample"}
          deferredAttachments={deferredAttachments}
          onRetryDeferredAttachments={handleRetryDeferredAttachments}
          onRemoveDeferredAttachment={handleRemoveDeferredAttachment}
          deferredLegs={deferredLegs}
          onDeferredLegsChange={handleDeferredLegsChange}
          onRetryDeferredLegs={retryDeferredLegs}
        />
      </EntitySideSheet>
    </div>
  );
}
