"use client";

import { entityViewHref } from "@/lib/entity-deep-link";
import { StaleVersionError, staleDeleteMessage, toDeleteErrorMessage } from "@/lib/stale-version";
/**
 * SampleList component
 * Main sample listing with CRUD operations, stat cards, filters, and DataTable
 */

import { useEffect, useState } from "react";
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
import { LOAD_FAILED, MISSING_VALUE } from "@/lib/copy-utils";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { recordLockSheetProps, recordLockTitleMark, RecordLockListNotice } from "@/components/record-locks";
import { useRecordLock, useRecordLocks } from "@/hooks/use-record-locks";
import { isRecordEditable, type RecordLockViews } from "@/lib/record-lock-view";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { formatDate } from "@/lib/format-utils";
import { creditBatchOptionLabel } from "@/lib/credit-batch-option-label";
import { SAMPLE_DELETE_MESSAGE } from "./sample-delete-copy";
import { formatMoisturePercent, MASS_MOISTURE_LABELS } from "@/lib/mass-moisture";
import {
  ENTITY_DEEP_LINK_FOCUS_PARAM,
  ENTITY_DEEP_LINK_MODE_PARAM,
} from "@/lib/entity-deep-link";
import { SampleForm } from "./sample-form";
import {
  formatDurabilityOption,
  type SampleFormData,
  type SampleFilterData,
} from "@/schemas/samples";
import type { SampleWithRelations } from "@/data-access/samples";
import { useDocumentsCertStatus } from "@/components/forms/use-documents-cert-status";
import { isLabReportDocument } from "@/lib/certification/lab-report";
import { formatLabPercent, formatSamplingTime, RATIO_DIGITS, sampleSheetSections } from "./sample-read-sections";
import {
  leaveSampleCreateIntent,
  resolveSampleCreateCreditBatchId,
  SAMPLE_CREATE_CREDIT_BATCH_PARAM,
} from "@/lib/sample-create-intent";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import { ILLUSTRATION_SIZE, SampleVialArt } from "@/components/ui/illustrations";

/** The average carbon card when the stats read settled and no Sample has a total carbon result. */
const NO_TOTAL_CARBON_RESULTS = "No total carbon results";

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
      className={`inline-flex items-center gap-4 px-8 py-2 text-[11px] font-medium ${
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

/** Lab details an operator can add from the Columns menu. */
const SAMPLE_COLUMNS_HIDDEN_BY_DEFAULT = {
  labName: false,
  analysisDate: false,
  oToCOrgRatio: false,
  moistureContentPercent: false,
  ph: false,
  ashContentPercent: false,
};

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (sample: SampleWithRelations) => void,
  onDelete: (sampleId: string) => void,
  locks: RecordLockViews,
): ColumnDef<SampleWithRelations>[] {
  return [
    {
      accessorKey: "sampleCode",
      meta: { nowrap: true, recordLink: true, recordLinkBefore: recordLockTitleMark(locks) },
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
      cell: ({ row }) => formatSamplingTime(row.original),
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
        row.original.hToCOrgRatio?.toFixed(RATIO_DIGITS) ?? MISSING_VALUE.notRecorded,
    },
    {
      accessorKey: "labName",
      header: "Lab name",
      cell: ({ row }) => (
        <span className="block max-w-xs truncate">{row.original.labName || MISSING_VALUE.notRecorded}</span>
      ),
    },
    {
      accessorKey: "analysisDate",
      meta: { nowrap: true },
      header: "Analysis date",
      cell: ({ row }) => formatDate(row.original.analysisDate),
    },
    {
      accessorKey: "oToCOrgRatio",
      header: "O:C org ratio",
      cell: ({ row }) =>
        row.original.oToCOrgRatio?.toFixed(RATIO_DIGITS) ?? MISSING_VALUE.notRecorded,
    },
    {
      accessorKey: "moistureContentPercent",
      header: MASS_MOISTURE_LABELS.moisture,
      cell: ({ row }) => formatMoisturePercent(row.original.moistureContentPercent),
    },
    {
      accessorKey: "ph",
      header: "pH",
      cell: ({ row }) => (row.original.ph == null ? MISSING_VALUE.notRecorded : String(row.original.ph)),
    },
    {
      accessorKey: "ashContentPercent",
      header: "Ash content",
      cell: ({ row }) => formatLabPercent(row.original.ashContentPercent),
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
      // A Sample stays fully editable while In use; only a Sent Removal
      // refuses its edit and delete (#687 item 2), so neither is offered.
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          {isRecordEditable(locks[row.original.id]) && (
            <RowActionsMenu
              label={`Actions for ${row.original.sampleCode}`}
              actions={[
                { label: "Edit", onSelect: () => onEdit(row.original) },
                { label: "Delete", destructive: true, onSelect: () => onDelete(row.original.id) },
              ]}
            />
          )}
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
  const [, setDeepLinkFocus] = useQueryState(
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
  // One snapshot from the moment the dialog opens: a refetch can move the row off the page before the refusal comes back.
  const [deleting, setDeleting] = useState<{ id: string; version: number; code: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // A stale refusal closes the dialog (its Delete would resubmit the same version), so it reads on the page.
  const [staleDeleteNotice, setStaleDeleteNotice] = useState<string | null>(null);

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
  const { data: statsData, isLoading: statsLoading, isError: statsFailed } = useSampleStats(
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

  if (!sideSheet && deepLinkMode === "edit" && focusedSample.data && focusedSampleId === focusedSample.data.id) {
    setSideSheet({ mode: "edit", entity: focusedSample.data });
  }

  const createSample = useCreateSample();
  const updateSample = useUpdateSample();
  const deleteSample = useDeleteSample();
  const toast = useToast();
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
  const labReportStatus = useDocumentsCertStatus("sample", displaySideSheet?.entity?.id, isLabReportDocument);
  const sampleLocks = useRecordLocks("sample", samples.map((sample) => sample.id));
  // A lock that arrives as Sent keeps an open draft, read-only, with the way
  // back (`submitBlock`).
  const { lock: sheetLock, status: sheetLockStatus, retry: retrySheetLock, retrying: sheetLockRetrying } = useRecordLock("sample", displaySideSheet?.entity?.id);

  const createWithEvidence = useCreateWithEvidence({
    entityType: "sample",
    entityNoun: "Sample",
    executeCreate: async ({ data }: { data: SampleFormData; onRefusal: SaveRefusalHandler }) => {
      const sample = await createSample.mutateAsync(data);
      return { entities: [sample], result: sample };
    },
    setError: setFormError,
    setUpdateError: setFormError,
    getCreateErrorMessage: (error, { onRefusal }) =>
      onRefusal(error, error instanceof Error ? error.message : "Sample was not created. Check the form."),
    unresolvedUpdateMessage:
      "Resolve or remove the failed attachments before saving this Sample.",
    openEditOnFailure: (sample) =>
      leaveSampleCreateIntent(createIntent.clear, () =>
        setSideSheet({ mode: "edit", entity: sample }),
      ),
    closeOnSuccess: () =>
      leaveSampleCreateIntent(createIntent.clear, () => setSideSheet(null)),
    onAfterFlush: ({ flushResult }) => ({
      failureMessage: buildAttachmentFailureBanner(flushResult.failed.length) ?? undefined,
    }),
    onSuccess: () =>
      toast.success("Sample created."),
  });
  const { deferredAttachments, isFlushing } = createWithEvidence;

  const handleCreate = (data: SampleFormData, onRefusal: SaveRefusalHandler) =>
    createWithEvidence.handleCreate({ data, onRefusal });

  // Keep the post-create "failed to save" banner in sync when the user retries
  // or removes individual failures inline: recompute it from the remaining
  // failed attachments so a fully-resolved queue clears it.
  const setCreateFailureBanner = (
    failedAttachments: number,
  ) => {
    setFormError(buildAttachmentFailureBanner(failedAttachments));
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
    );
  };

  const handleRemoveDeferredAttachment = (key: string) => {
    deferredAttachments.remove(key);
    if (sideSheet?.mode !== "edit") return;
    const remainingFailed = deferredAttachments.attachments.filter(
      (attachment) => attachment.status === "failed" && attachment.key !== key,
    ).length;
    setCreateFailureBanner(remainingFailed);
  };

  const handleUpdate = async (data: SampleFormData, onRefusal: SaveRefusalHandler) => {
    // A deep-linked edit sheet (?sample=...&mode=edit) has no local sheet
    // state, so the target comes from the displayed sheet, not `sideSheet`.
    if (displaySideSheet?.mode !== "edit") return;
    setFormError(null);
    if (createWithEvidence.guardUpdate()) return;
    try {
      await updateSample.mutateAsync({
        sampleId: displaySideSheet.entity.id,
        expectedVersion: displaySideSheet.entity.version,
        ...data,
      });
      closeSideSheet();
      toast.success("Sample updated.");
    } catch (error) {
      setFormError(onRefusal(error, error instanceof Error ? error.message : "Sample was not saved. Try again."));
    }
  };

  const handleDelete = (sampleId: string) => {
    const row = (samples).find((item) => item.id === sampleId);
    if (!row) return;
    setStaleDeleteNotice(null);
    setDeleting({ id: sampleId, version: row.version, code: row.sampleCode });
  };
  const handleDeleteConfirm = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await deleteSample.mutateAsync({ sampleId: deleting.id, expectedVersion: deleting.version });
      setDeleting(null);
      toast.success("Sample deleted.");
    } catch (error) {
      if (error instanceof StaleVersionError) {
        setDeleting(null);
        setStaleDeleteNotice(staleDeleteMessage(`Sample ${deleting.code}`));
      } else {
        setDeleteError(toDeleteErrorMessage(error, "Sample", "Sample was not deleted. Try again."));
      }
    }
  };

  const openCreate = () => {
    createSample.startDraft();
    createIntent.clear();
    setFocusedSampleId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    createWithEvidence.reset();
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
    // A deep-linked create skips openCreate, so closing ends the draft and its key.
    createSample.startDraft();
    createIntent.clear();
    setFocusedSampleId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setSideSheet(null);
    setFormError(null);
    createWithEvidence.reset();
  };

  const confirmCreateClose = () =>
    createWithEvidence.confirmClose(
      displaySideSheet?.mode === "create",
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

  const columns = createColumns(openEdit, handleDelete, sampleLocks.locks);

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="verification"
          title="Lab Samples"
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
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New Sample
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        <StatCard title="Total Samples" value={statsData?.totalSamples ?? 0} icon={<FlaskIcon size={24} weight="bold" />} isLoading={statsLoading} />
        <StatCard title="Avg total carbon %" value={statsData?.avgCarbonPercent?.toFixed(1) ?? <span className="body-small font-normal text-[var(--color-text-tertiary)]">{!statsData && statsFailed ? LOAD_FAILED : NO_TOTAL_CARBON_RESULTS}</span>} icon={<LeafIcon size={24} weight="bold" />} isLoading={statsLoading} />
        <StatCard title="200-Year" value={statsData?.samples200Year ?? 0} icon={<FireIcon size={24} weight="bold" />} description="Standard durability" isLoading={statsLoading} />
        <StatCard title="1000-Year" value={statsData?.samples1000Year ?? 0} icon={<CertificateIcon size={24} weight="bold" />} description="Enhanced durability" isLoading={statsLoading} />
      </div>

      <RecordLockListNotice read={sampleLocks} />

      <DataTable
        defaultColumnVisibility={SAMPLE_COLUMNS_HIDDEN_BY_DEFAULT}
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
        getRowHref={(row) => entityViewHref("/lab-samples", "sample", row.id, contextFacilityId)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={hasActiveFilters ? <FlaskIcon size={48} /> : <SampleVialArt size={ILLUSTRATION_SIZE.empty} />}
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
                  {creditBatchOptionLabel(batch)}
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

      {staleDeleteNotice && <ServerError message={staleDeleteNotice} />}
      <DeleteConfirmDialog
        isOpen={!!deleting}
        title="Delete Sample"
        message={SAMPLE_DELETE_MESSAGE}
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeleting(null); setDeleteError(null); }}
        isPending={deleteSample.isPending}
        errorMessage={deleteError ?? undefined}
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
        {...recordLockSheetProps({ lock: sheetLock, status: sheetLockStatus, retry: retrySheetLock, retrying: sheetLockRetrying, inUseLocksNothing: true })}
        canEdit={isRecordEditable(sheetLock)}
        editLabel="Edit Sample"
        sections={displaySideSheet?.mode === "view" && displaySideSheet.entity ? sampleSheetSections(displaySideSheet.entity, labReportStatus) : undefined}
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
            submitLabel={displaySideSheet?.mode === "edit" ? "Save changes" : "Create Sample"}
            deferredAttachments={deferredAttachments}
            onRetryDeferredAttachments={handleRetryDeferredAttachments}
            onRemoveDeferredAttachment={handleRemoveDeferredAttachment}
          />
        )}
      </EntitySideSheet>
    </div>
  );
}
