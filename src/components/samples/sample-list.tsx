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
import { useCreateWithEvidence } from "@/hooks/use-create-with-evidence";
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
import {
  ENTITY_DEEP_LINK_FOCUS_PARAM,
  ENTITY_DEEP_LINK_MODE_PARAM,
  parseEntityFocusTarget,
} from "@/lib/entity-deep-link";
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

/** One template for the create-failure banner so its two call sites (post-flush
 * failure and inline retry recount) can never drift apart. Null when resolved. */
function buildAttachmentFailureBanner(total: number): string | null {
  return total > 0
    ? `Sample created, but ${total} ${total === 1 ? "attachment" : "attachments"} failed to save.`
    : null;
}

function formatPercent(value: number | null, digits = 2) {
  return value == null ? null : `${value.toFixed(digits)}%`;
}

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
  const [deepLinkMode, setDeepLinkMode] = useQueryState(
    ENTITY_DEEP_LINK_MODE_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [deepLinkFocus, setDeepLinkFocus] = useQueryState(
    ENTITY_DEEP_LINK_FOCUS_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [creditBatchFilterParam, setCreditBatchFilter] = useQueryState(
    "creditBatch",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const creditBatchFilter = creditBatchFilterParam ?? "";
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
  const createTransportLeg = useCreateTransportLeg();
  const [deferredLegs, setDeferredLegs] = useState<TransportLegFormData[]>([]);

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
      ? ({
          mode: deepLinkMode === "edit" ? "edit" : "view",
          entity: focusedSample.data,
        } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;
  const activeFocusTarget = sideSheet
    ? null
    : parseEntityFocusTarget(deepLinkFocus);
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

  const createWithEvidence = useCreateWithEvidence({
    entityType: "sample",
    entityNoun: "Sample",
    executeCreate: async (data: SampleFormData) => {
      const sample = await createSample.mutateAsync(data);
      return { entities: [sample], result: sample };
    },
    setError: setFormError,
    setUpdateError: setFormError,
    getCreateErrorMessage: (error) =>
      error instanceof Error ? error.message : "Failed to create sample",
    unresolvedUpdateMessage:
      "Resolve or remove the failed attachments and transport legs before saving this sample.",
    openEditOnFailure: (sample) =>
      setSideSheet({ mode: "edit", entity: sample }),
    closeOnSuccess: () => setSideSheet(null),
    onAfterFlush: async ({ created, flushResult }) => {
      const sample = created.result;
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

      const failedCount = flushResult.failed.length + failedLegs.length;
      if (failedCount === 0) return;
      return {
        failureMessage: buildAttachmentFailureBanner(failedCount) ?? undefined,
      };
    },
    onSuccess: ({ result }) =>
      showSavedToast("Sample created successfully", result),
  });
  const { deferredAttachments, isFlushing } = createWithEvidence;

  const handleCreate = createWithEvidence.handleCreate;

  // Keep the post-create "failed to save" banner in sync when the user retries
  // or removes individual failures inline: recompute it from the remaining
  // failed attachments and transport legs so a fully-resolved queue clears it.
  const setCreateFailureBanner = (
    failedAttachments: number,
    failedLegs: number,
  ) => {
    setFormError(buildAttachmentFailureBanner(failedAttachments + failedLegs));
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
    await createWithEvidence.runWhileFlushing(async () => {
      const failedLegs: TransportLegFormData[] = [];
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
    });
  };

  const handleUpdate = async (data: SampleFormData) => {
    if (sideSheet?.mode !== "edit") return;
    setFormError(null);
    if (createWithEvidence.guardUpdate(deferredLegs.length > 0)) return;
    try {
      const sample = await updateSample.mutateAsync({
        sampleId: sideSheet.entity.id,
        ...data,
      });
      createWithEvidence.reset();
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
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    createWithEvidence.reset();
    setDeferredLegs([]);
    setSideSheet({ mode: "create", entity: null });
  };
  const openView = (sample: SampleWithRelations) => {
    setFocusedSampleId(sample.id);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    setSideSheet({ mode: "view", entity: sample });
  };
  const openEdit = (sample: SampleWithRelations) => {
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    createWithEvidence.reset();
    setSideSheet({ mode: "edit", entity: sample });
  };
  const closeSideSheet = () => {
    setFocusedSampleId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setSideSheet(null);
    setFormError(null);
    createWithEvidence.reset();
    setDeferredLegs([]);
  };

  const confirmCreateClose = () =>
    createWithEvidence.confirmClose(
      displaySideSheet?.mode === "create",
      deferredLegs.length,
    );
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

  const clearFilters = () => { setSearchQuery(""); setCreditBatchFilter(null); setCurrentPage(1); };
  const hasActiveFilters = searchQuery || creditBatchFilter;

  const editingEntity =
    displaySideSheet?.mode === "edit" ? displaySideSheet.entity : null;
  const isSubmitting =
    createSample.isPending || updateSample.isPending || isFlushing;

  const columns = createColumns(openEdit, handleDelete);

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
              onChange={(e) => { setCreditBatchFilter(e.target.value || null); setCurrentPage(1); }}
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
            title: "Sample Information",
            fields: [
              { label: "Credit Batch", value: displaySideSheet.entity.creditBatchCode },
              { label: "Sampling Time", value: formatDateTime(displaySideSheet.entity.samplingTime) },
              { label: "Analysis Date", value: formatDate(displaySideSheet.entity.analysisDate) },
              { label: "Lab Name", value: displaySideSheet.entity.labName },
              { label: "Lab Accreditation", value: displaySideSheet.entity.labAccreditation },
              { label: "Sample Weight (g)", value: displaySideSheet.entity.weightGrams },
              { label: "Sample Volume (mL)", value: displaySideSheet.entity.volumeMl },
            ],
          },
          {
            title: "Carbon Analysis",
            fields: [
              { label: "Total Carbon (%)", value: formatPercent(displaySideSheet.entity.totalCarbonPercent) },
              { label: "Organic Carbon (%)", ...certificationDetailField("sample", "organicCarbonPercent"), value: formatPercent(displaySideSheet.entity.organicCarbonPercent) },
              { label: "Inorganic Carbon (%)", value: formatPercent(displaySideSheet.entity.inorganicCarbonPercent) },
            ],
          },
          {
            title: "Elemental Analysis",
            fields: [
              { label: "Hydrogen (%)", value: formatPercent(displaySideSheet.entity.totalHydrogenPercent) },
              { label: "Nitrogen (%)", value: formatPercent(displaySideSheet.entity.totalNitrogenPercent) },
              { label: "Oxygen (%)", value: formatPercent(displaySideSheet.entity.totalOxygenPercent) },
              { label: "Sulfur (%)", value: formatPercent(displaySideSheet.entity.totalSulfurPercent) },
            ],
          },
          {
            title: "Proximate Analysis",
            fields: [
              { label: "Ash Content (%)", value: formatPercent(displaySideSheet.entity.ashContentPercent) },
              { label: "Moisture Content (%)", value: formatPercent(displaySideSheet.entity.moistureContentPercent) },
            ],
          },
          {
            title: "Physical Properties",
            fields: [
              { label: "Bulk Density (kg/m³)", value: displaySideSheet.entity.bulkDensityKgPerM3 },
              { label: "pH", value: displaySideSheet.entity.ph != null ? String(displaySideSheet.entity.ph) : null },
              { label: "Salt Content (g/kg)", value: displaySideSheet.entity.saltContentGPerKg },
            ],
          },
          {
            title: "Stability Ratios",
            fields: [
              { label: "Inherited Durability", value: formatDurabilityOption(displaySideSheet.entity.durabilityOption) },
              { label: "H:C org Ratio", ...certificationDetailField("sample", "hToCOrgRatio"), value: displaySideSheet.entity.hToCOrgRatio?.toFixed(4) ?? null },
              { label: "O:C org Ratio", value: displaySideSheet.entity.oToCOrgRatio?.toFixed(4) ?? null },
            ],
          },
          ...(displaySideSheet.entity.durabilityOption === "1000_year" ? [
            {
              title: "1000-Year Durability · R₀ Reflectance",
              fields: [
                { label: "Mean Random Reflectance R₀ (%)", ...certificationDetailField("sample", "randomReflectanceR0Percent"), value: formatPercent(displaySideSheet.entity.randomReflectanceR0Percent) },
                { label: "R₀ Readings at or above 2% (%)", ...certificationDetailField("sample", "sReflectanceFraction"), value: displaySideSheet.entity.sReflectanceFraction == null ? null : formatPercent(displaySideSheet.entity.sReflectanceFraction * 100) },
                { label: "Measurement Count", value: displaySideSheet.entity.r0MeasurementCount },
                { label: "R₀ Analysis Date", value: formatDate(displaySideSheet.entity.r0AnalysisDate) },
              ],
            },
            {
              title: "TGA Non-Reactive Carbon",
              fields: [
                { label: "Reactive Carbon (%)", ...certificationDetailField("sample", "reactiveCarbonPercent"), value: formatPercent(displaySideSheet.entity.reactiveCarbonPercent) },
                { label: "Residual (Non-Reactive) Carbon (%)", ...certificationDetailField("sample", "residualCarbonPercent"), value: formatPercent(displaySideSheet.entity.residualCarbonPercent) },
                { label: "TGA Analysis Date", value: formatDate(displaySideSheet.entity.tgaAnalysisDate) },
              ],
            },
          ] : []),
          {
            title: "Nutrient Claims",
            fields: [
              { label: "Enable nutrient claims", value: displaySideSheet.entity.nutrientClaimEnabled ? "Yes" : "No" },
              ...(displaySideSheet.entity.nutrientClaimEnabled ? [
                { label: "Phosphorus (%)", value: formatPercent(displaySideSheet.entity.phosphorusPercent) },
                { label: "Potassium (%)", value: formatPercent(displaySideSheet.entity.potassiumPercent) },
                { label: "Magnesium (%)", value: formatPercent(displaySideSheet.entity.magnesiumPercent) },
                { label: "Calcium (%)", value: formatPercent(displaySideSheet.entity.calciumPercent) },
                { label: "Iron (%)", value: formatPercent(displaySideSheet.entity.ironPercent) },
              ] : []),
            ],
          },
          {
            title: "Evidence & Documents",
            fields: [],
            content: <SampleDocumentsPanel sampleId={displaySideSheet.entity.id} readOnly />,
          },
          {
            title: "Transport",
            fields: [],
            content: <TransportLegsSummary entityType="sample" entityId={displaySideSheet.entity.id} />,
          },
          {
            title: "Record Metadata",
            fields: [
              { label: "Sample Code", value: displaySideSheet.entity.sampleCode },
              { label: "Facility", value: displaySideSheet.entity.facilityName },
              {
                label: "Sample chemistry",
                value: <EntityCertifyReadinessBadge readiness={deriveEntityCertifyReadiness("sample", displaySideSheet.entity)} readyLabel="Chemistry complete" readinessNoun="sample chemistry" />,
              },
            ],
          },
        ] : undefined}
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
          focusTarget={
            displaySideSheet?.mode === "edit" ? activeFocusTarget : null
          }
        />
      </EntitySideSheet>
    </div>
  );
}
