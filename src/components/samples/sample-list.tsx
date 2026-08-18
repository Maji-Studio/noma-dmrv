/**
 * SampleList component
 * Main sample listing with CRUD operations, stat cards, filters, and DataTable
 */
"use client";

import { useEffect, useState, useCallback } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { FlaskIcon, LeafIcon, PlusIcon, XIcon, FireIcon, CertificateIcon } from "@phosphor-icons/react/dist/ssr";
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
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { useCreateWithEvidence } from "@/hooks/use-create-with-evidence";
import { useCreateTransportLeg } from "@/hooks/use-transport-legs";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { TransportLegsSummary } from "@/components/transport-legs";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import {
  formatDate,
  formatDateRange,
  formatDateTime,
  formatPercent,
} from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL } from "@/lib/mass-moisture";
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
import {
  leaveSampleCreateIntent,
  resolveSampleCreateCreditBatchId,
  SAMPLE_CREATE_CREDIT_BATCH_PARAM,
} from "@/lib/sample-create-intent";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";

const LAB_PERCENT_FRACTION_DIGITS = 2;

function formatLabPercent(value: number | null | undefined): string {
  return formatPercent(value, { digits: LAB_PERCENT_FRACTION_DIGITS });
}

/** One template for the create-failure banner so its two call sites (post-flush
 * failure and inline retry recount) can never drift apart. Null when resolved. */
function buildAttachmentFailureBanner(total: number): string | null {
  return total > 0
    ? `Sample created, but ${total} ${total === 1 ? "attachment" : "attachments"} failed to save.`
    : null;
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
      meta: { nowrap: true },
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">
          {row.original.sampleCode}
        </span>
      ),
    },
    {
      accessorKey: "samplingTime",
      meta: { nowrap: true },
      header: "Sampling time",
      cell: ({ row }) => formatDateTime(row.original.samplingTime),
    },
    {
      id: "creditBatch",
      header: "Credit batch",
      accessorFn: (row) => row.creditBatchCode ?? "",
      cell: ({ row }) => (
        <span className="text-[var(--clr-dark-purple)]">
          {row.original.creditBatchCode ?? MISSING_VALUE.notSet}
        </span>
      ),
    },
    {
      accessorKey: "totalCarbonPercent",
      header: "Total C (%)",
      cell: ({ row }) =>
        row.original.totalCarbonPercent?.toFixed(1) ?? MISSING_VALUE.notRecorded,
    },
    {
      accessorKey: "organicCarbonPercent",
      header: "Organic C (%)",
      cell: ({ row }) =>
        row.original.organicCarbonPercent?.toFixed(1) ?? MISSING_VALUE.notRecorded,
    },
    {
      accessorKey: "hToCOrgRatio",
      header: "H:C org ratio",
      cell: ({ row }) =>
        row.original.hToCOrgRatio?.toFixed(3) ?? MISSING_VALUE.notRecorded,
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
          readinessNoun="Sample chemistry"
        />
      ),
    },
    {
      id: "actions",
      meta: { stickyEnd: true },
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

export function SampleList({
  initialCreate = false,
  initialCreditBatchId,
}: {
  initialCreate?: boolean;
  initialCreditBatchId?: string;
}) {
  const { facilityId: contextFacilityId } = useFacilityContext();
  const createIntent = useOpenCreateIntent({
    initialOpen: initialCreate,
    contextParam: SAMPLE_CREATE_CREDIT_BATCH_PARAM,
    initialContext: initialCreditBatchId,
  });
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
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination(`${contextFacilityId ?? ""}:${creditBatchFilter}`);
  const debouncedSearch = useDebounce(searchQuery, LIST_SEARCH_DEBOUNCE_MS);

  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [deletingSampleId, setDeletingSampleId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filters: Partial<SampleFilterData> = {
    search: debouncedSearch || undefined,
    creditBatchId: creditBatchFilter || undefined,
    facilityId: contextFacilityId || undefined,
    page: currentPage,
    pageSize,
    sortBy: "samplingTime",
    sortOrder: "desc",
  };

  const { data: samplesData, isLoading, error: fetchError } = useSamples(filters, {
    enabled: !!contextFacilityId,
  });
  const { data: statsData, isLoading: statsLoading } = useSampleStats(
    creditBatchFilter || undefined,
    !!contextFacilityId,
    contextFacilityId || undefined,
  );
  const {
    data: creditBatchesData,
    isLoading: creditBatchesLoading,
    error: creditBatchesError,
  } = useCreditBatches(contextFacilityId || undefined);
  const focusedSample = useSample(focusedSampleId ?? "", !!focusedSampleId);

  const createSample = useCreateSample();
  const updateSample = useUpdateSample();
  const deleteSample = useDeleteSample();
  const toast = useToast();
  const createTransportLeg = useCreateTransportLeg();
  const [deferredLegs, setDeferredLegs] = useState<TransportLegFormData[]>([]);

  const samples = samplesData?.items ?? [];
  const totalPages = samplesData?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });
  useEffect(() => {
    if (!focusedSampleId) return;
    if (focusedSample.error || (focusedSample.isSuccess && !focusedSample.data)) {
      setFocusedSampleId(null);
      toast.error("The linked Sample could not be opened.");
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
  const createIntentSideSheet = createIntent.isOpen
    ? ({ mode: "create", entity: null } as const)
    : null;
  const displaySideSheet =
    sideSheet ?? createIntentSideSheet ?? deepLinkedSideSheet;
  const activeFocusTarget = sideSheet
    ? null
    : parseEntityFocusTarget(deepLinkFocus);

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
      error instanceof Error ? error.message : "Sample was not created. Check the form.",
    unresolvedUpdateMessage:
      "Resolve or remove the failed attachments and transport legs before saving this Sample.",
    openEditOnFailure: (sample) =>
      leaveSampleCreateIntent(createIntent.clear, () =>
        setSideSheet({ mode: "edit", entity: sample }),
      ),
    closeOnSuccess: () =>
      leaveSampleCreateIntent(createIntent.clear, () => setSideSheet(null)),
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
    onSuccess: () =>
      toast.success("Sample created."),
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
      await updateSample.mutateAsync({
        sampleId: sideSheet.entity.id,
        ...data,
      });
      createWithEvidence.reset();
      setDeferredLegs([]);
      setSideSheet(null);
      toast.success("Sample updated.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Sample was not saved. Try again.");
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
      toast.success("Sample deleted.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Sample was not deleted. Try again.");
    }
  };

  const openCreate = () => {
    createIntent.clear();
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
    createIntent.clear();
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
  const preselectedCreditBatchId = resolveSampleCreateCreditBatchId(
    createIntent.context,
    creditBatchesData,
  );
  const isResolvingCreateContext =
    displaySideSheet?.mode === "create" &&
    !!createIntent.context &&
    creditBatchesLoading;
  const createContextError =
    displaySideSheet?.mode === "create" &&
    !!createIntent.context &&
    !creditBatchesLoading &&
    (!preselectedCreditBatchId || creditBatchesError)
      ? "The selected credit batch could not be opened. Return to the batch detail and try again."
      : null;
  const isSubmitting =
    createSample.isPending || updateSample.isPending || isFlushing;

  const columns = createColumns(openEdit, handleDelete);

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="verification"
          title="Lab Samples"
          subtitle="Lab analysis of biochar Samples and carbon permanence"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its lab Samples." />
      </div>
    );
  }

  if (fetchError) {
    return <div className="container-max py-32"><ServerError message={fetchError.message || "The Samples could not be loaded. Refresh the page and try again."} /></div>;
  }

  const viewingEntity =
    displaySideSheet?.mode === "view" ? displaySideSheet.entity : null;
  const viewSubtitle = viewingEntity
    ? [viewingEntity.creditBatchCode, viewingEntity.facilityName].filter(Boolean).join(" · ") || undefined
    : undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="verification"
        title="Lab Samples"
        subtitle="Lab analysis of biochar Samples and carbon permanence"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New Sample
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        <StatCard title="Total Samples" value={statsData?.totalSamples ?? 0} icon={<FlaskIcon size={24} weight="bold" />} description="All lab Samples" isLoading={statsLoading} />
        <StatCard title="Avg Carbon %" value={statsData?.avgCarbonPercent?.toFixed(1) ?? MISSING_VALUE.notAvailable} icon={<LeafIcon size={24} weight="bold" />} description="Average total carbon" isLoading={statsLoading} />
        <StatCard title="200-Year" value={statsData?.samples200Year ?? 0} icon={<FireIcon size={24} weight="bold" />} description="Standard durability" isLoading={statsLoading} />
        <StatCard title="1000-Year" value={statsData?.samples1000Year ?? 0} icon={<CertificateIcon size={24} weight="bold" />} description="Enhanced durability" isLoading={statsLoading} />
      </div>

      <DataTable
        columns={columns}
        data={samples}
        enableSorting={false}
        enablePagination
        manualPagination
        pageCount={totalPages}
        pageSize={pageSize}
        pageIndex={currentPage - 1}
        globalFilter={searchQuery}
        onGlobalFilterChange={(value) => {
          setSearchQuery(value);
          setCurrentPage(1);
        }}
        onPaginationChange={onPaginationChange}
        aria-label="Samples"
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<FlaskIcon size={48} />}
            title={hasActiveFilters ? "No Samples found" : "No Samples yet"}
            description={
              hasActiveFilters
                ? "Try adjusting your search or filters."
                : "Lab Samples carry the analysis behind biochar quality and durability."
            }
            action={
              !hasActiveFilters ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={20} weight="bold" />
                  Create your first Sample
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search
            placeholder="Search by Sample code..."
            aria-label="Search Samples by code"
          />
          <DataTable.Controls>
            <DataTable.FilterSelect
              value={creditBatchFilter}
              onChange={(e) => { setCreditBatchFilter(e.target.value || null); setCurrentPage(1); }}
              aria-label="Filter by credit batch"
            >
              <option value="">All credit batches</option>
              {creditBatchesData?.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {formatDateRange(batch.startDate, batch.endDate)}
                </option>
              ))}
            </DataTable.FilterSelect>
            {hasActiveFilters && (
              <Button variant="noOutline" size="small" onClick={clearFilters}>
                <XIcon size={16} weight="bold" />
                Clear
              </Button>
            )}
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteError && <ServerError message={deleteError} />}
      <DeleteConfirmDialog
        isOpen={!!deletingSampleId}
        title="Delete Sample"
        message="Delete this Sample? Samples linked to credit batches cannot be deleted. This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeletingSampleId(null); setDeleteError(null); }}
        isPending={deleteSample.isPending}
      />

      <EntitySideSheet
        numberedSections
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
            title: "Sample information",
            fields: [
              { label: "Credit batch", value: displaySideSheet.entity.creditBatchCode },
              { label: "Sampling time", value: formatDateTime(displaySideSheet.entity.samplingTime) },
              { label: "Analysis date", value: formatDate(displaySideSheet.entity.analysisDate) },
              { label: "Lab name", value: displaySideSheet.entity.labName },
              { label: "Lab accreditation", value: displaySideSheet.entity.labAccreditation },
              { label: "Sample weight (g)", value: displaySideSheet.entity.weightGrams },
              { label: "Sample volume (mL)", value: displaySideSheet.entity.volumeMl },
            ],
          },
          {
            title: "Carbon analysis",
            fields: [
              { label: "Total carbon (%)", value: formatLabPercent(displaySideSheet.entity.totalCarbonPercent) },
              { label: "Organic carbon (%)", ...certificationDetailField("sample", "organicCarbonPercent"), value: formatLabPercent(displaySideSheet.entity.organicCarbonPercent) },
              { label: "Inorganic carbon (%)", value: formatLabPercent(displaySideSheet.entity.inorganicCarbonPercent) },
            ],
          },
          {
            title: "Elemental analysis",
            fields: [
              { label: "Hydrogen (%)", value: formatLabPercent(displaySideSheet.entity.totalHydrogenPercent) },
              { label: "Nitrogen (%)", value: formatLabPercent(displaySideSheet.entity.totalNitrogenPercent) },
              { label: "Oxygen (%)", value: formatLabPercent(displaySideSheet.entity.totalOxygenPercent) },
              { label: "Sulfur (%)", value: formatLabPercent(displaySideSheet.entity.totalSulfurPercent) },
            ],
          },
          {
            title: "Proximate analysis",
            fields: [
              { label: "Ash content (%)", value: formatLabPercent(displaySideSheet.entity.ashContentPercent) },
              { label: MOISTURE_FIELD_LABEL, value: formatMoisturePercent(displaySideSheet.entity.moistureContentPercent) },
            ],
          },
          {
            title: "Physical properties",
            fields: [
              { label: "Bulk density (kg/m³)", value: displaySideSheet.entity.bulkDensityKgPerM3 },
              { label: "pH", value: displaySideSheet.entity.ph != null ? String(displaySideSheet.entity.ph) : null },
              { label: "Salt content (g/kg)", value: displaySideSheet.entity.saltContentGPerKg },
            ],
          },
          {
            title: "Stability ratios",
            fields: [
              { label: "Inherited durability", value: formatDurabilityOption(displaySideSheet.entity.durabilityOption) },
              { label: "H:C org ratio", ...certificationDetailField("sample", "hToCOrgRatio"), value: displaySideSheet.entity.hToCOrgRatio?.toFixed(4) ?? null },
              { label: "O:C org ratio", ...certificationDetailField("sample", "oToCOrgRatio"), value: displaySideSheet.entity.oToCOrgRatio?.toFixed(4) ?? null },
            ],
          },
          ...(displaySideSheet.entity.durabilityOption === "1000_year" ? [
            {
              title: "1000-year durability · R₀ reflectance",
              fields: [
                { label: "Mean random reflectance R₀ (%)", ...certificationDetailField("sample", "randomReflectanceR0Percent"), value: formatLabPercent(displaySideSheet.entity.randomReflectanceR0Percent) },
                { label: "R₀ readings at or above 2% (%)", ...certificationDetailField("sample", "sReflectanceFraction"), value: displaySideSheet.entity.sReflectanceFraction == null ? null : formatLabPercent(displaySideSheet.entity.sReflectanceFraction * 100) },
                { label: "Measurement count", value: displaySideSheet.entity.r0MeasurementCount },
                { label: "R₀ analysis date", value: formatDate(displaySideSheet.entity.r0AnalysisDate) },
              ],
            },
            {
              title: "TGA non-reactive carbon",
              fields: [
                { label: "Reactive carbon (%)", ...certificationDetailField("sample", "reactiveCarbonPercent"), value: formatLabPercent(displaySideSheet.entity.reactiveCarbonPercent) },
                { label: "Residual (non-reactive) carbon (%)", ...certificationDetailField("sample", "residualCarbonPercent"), value: formatLabPercent(displaySideSheet.entity.residualCarbonPercent) },
                { label: "TGA analysis date", value: formatDate(displaySideSheet.entity.tgaAnalysisDate) },
              ],
            },
          ] : []),
          {
            title: "Nutrient claims",
            fields: [
              { label: "Enable nutrient claims", value: displaySideSheet.entity.nutrientClaimEnabled ? "Yes" : "No" },
              ...(displaySideSheet.entity.nutrientClaimEnabled ? [
                { label: "Phosphorus (%)", value: formatLabPercent(displaySideSheet.entity.phosphorusPercent) },
                { label: "Potassium (%)", value: formatLabPercent(displaySideSheet.entity.potassiumPercent) },
                { label: "Magnesium (%)", value: formatLabPercent(displaySideSheet.entity.magnesiumPercent) },
                { label: "Calcium (%)", value: formatLabPercent(displaySideSheet.entity.calciumPercent) },
                { label: "Iron (%)", value: formatLabPercent(displaySideSheet.entity.ironPercent) },
              ] : []),
            ],
          },
          {
            title: "Evidence & documents",
            fields: [],
            content: <SampleDocumentsPanel sampleId={displaySideSheet.entity.id} readOnly />,
          },
          {
            title: "Transport",
            fields: [],
            content: <TransportLegsSummary entityType="sample" entityId={displaySideSheet.entity.id} />,
          },
        ] : undefined}
      >
        {isResolvingCreateContext ? (
          <div
            className="flex flex-col gap-16 py-8"
            aria-label="Loading selected credit batch"
          >
            <Skeleton className="h-24 w-2/3" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : createContextError ? (
          <ServerError message={createContextError} />
        ) : (
          <SampleForm
            key={editingEntity?.id ?? "create"}
            sample={editingEntity ?? undefined}
            creditBatchId={preselectedCreditBatchId}
            onSubmit={displaySideSheet?.mode === "edit" ? handleUpdate : handleCreate}
            onCancel={attemptCloseSideSheet}
            isSubmitting={isSubmitting}
            errorMessage={formError ?? undefined}
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
        )}
      </EntitySideSheet>
    </div>
  );
}
