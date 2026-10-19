"use client";

import { toDeleteErrorMessage } from "@/lib/stale-version";
/**
 * CreditBatchList component
 * The Timeline (default) or the List: compact rows with folded filters,
 * pagination, the timeline's lifecycle state and the dry applied biochar. The
 * dormant credit_batches.status column is not rendered; progress comes from
 * data readiness, Removal submission, and the linked GHG Statement's verifier
 * status.
 *
 * Clicking a row opens the side sheet as a preview (deep-linkable via
 * `?batch=<id>`). Its lead action opens the batch's own page,
 * `/credit-batches/[id]`, where the checklist, Samples and activity live.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConflictError } from "@/lib/conflict-ref";
import { parseAsString, useQueryState } from "nuqs";
import {
  CertificateIcon,
  LeafIcon,
  PlusIcon,
} from "@phosphor-icons/react/dist/ssr";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { useToast } from "@/components/ui/toast";
import {
  Button,
  EmptyState,
  ListPagination,
  PageHeader,
} from "@/components/ui";
import { ServerError } from "@/components/forms";
import { CreditBatchForm } from "./credit-batch-form";
import { CreditBatchListRow, CreditBatchListRows } from "./credit-batch-list-rows";
import {
  CreditBatchTimeline,
  type NewBatchRequest,
} from "./credit-batch-timeline";
import { isCreditBatchMembershipLocked, saveCreditBatchEdit } from "./credit-batch-update-patch";
import { RecordUsedBy, recordLockSheetProps } from "@/components/record-locks";
import { useRecordLock, useRecordLocks } from "@/hooks/use-record-locks";
import { isRecordEditable } from "@/lib/record-lock-view";
import { creditBatchSheetSections } from "./credit-batch-view";
import {
  CreditBatchFilters,
  type CreditBatchReadinessFilter,
} from "./credit-batch-filters";
import {
  filterCreditBatches,
  readinessErrorWithholdsResults,
  readinessErrorMessage,
} from "./credit-batch-filtering";
import {
  useCreditBatches,
  useCreditBatch,
  useCreditBatchCo2eStoredPreviews,
  useCreditBatchProductionRunOptions,
  useCreditBatchPageModel,
  useCreditBatchTimelineFacts,
  useCreateCreditBatch,
  useUpdateCreditBatch,
  useDeleteCreditBatch,
} from "@/hooks/use-credit-batches";
import { formatDateRange } from "@/lib/format-utils";
import { creditBatchStateOf } from "@/lib/credit-batches/batch-state";
import { formatFacilityDate } from "@/lib/date-utils";
import {
  defaultNewBatchWindow,
  monthWindow,
} from "@/lib/credit-batches/timeline";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { CREDIT_BATCH_DEEP_LINK_PARAM, creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { buttonVariants } from "@/components/ui/button";
import {
  ENTITY_DEEP_LINK_FOCUS_PARAM,
  parseEntityFocusTarget,
} from "@/lib/entity-deep-link";
import { useCreditBatchHealthSummaries } from "@/hooks/use-certification";
import type { CreditBatchFormData } from "@/schemas/credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { useFacilityClock, useFacilityContext } from "@/hooks/use-facility-context";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { useListPagination } from "@/hooks/use-list-pagination";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { sumNullableBy } from "@/lib/nullable-sum";
import { Notice } from "@/components/ui/notice";
import { ILLUSTRATION_SIZE, CreditBatchArt } from "@/components/ui/illustrations";

// ============================================
// Helpers
// ============================================

const EMPTY_CREDIT_BATCHES: CreditBatchWithRelations[] = [];
export const CREDIT_BATCH_DELETE_MESSAGE =
  "Delete this credit batch? This removes the grouping, releases its production runs so they can be grouped again, and cannot be undone. A credit batch with Samples cannot be deleted until its Samples are moved to another credit batch or deleted.";

export function closeCreditBatchCreate(
  clearCreateIntent: () => void,
  closeSideSheet: () => void,
) {
  clearCreateIntent();
  closeSideSheet();
}

/**
 * Re-attach the live CO₂e-stored preview to a batch snapshot. Cards read from
 * the hydrated list, but the side sheet holds whichever object it was opened
 * with — a click-captured row, or a single-batch fetch (which never carries a
 * preview) for a `?batch=` deep link.
 */
export function hydrateCo2ePreview(
  batch: CreditBatchWithRelations | null,
  previews: Record<string, CreditBatchWithRelations["co2eStoredPreview"]>,
): CreditBatchWithRelations | null {
  if (!batch) return null;
  const preview = previews[batch.id];
  return preview ? { ...batch, co2eStoredPreview: preview } : batch;
}

// ============================================
// Component
// ============================================

export type CreditBatchListView = "timeline" | "list";

export function CreditBatchList({
  canManage = false,
  initialCreate = false,
  initialView = "timeline",
  emissionsEntriesEnabled = false,
}: {
  canManage?: boolean;
  initialCreate?: boolean;
  initialView?: CreditBatchListView;
  /** Server flag EMISSIONS_ENTRIES_ENABLED; mounts the Emissions panel. */
  emissionsEntriesEnabled?: boolean;
}) {
  const [view, setView] = useState<CreditBatchListView>(initialView);
  const [createDefaults, setCreateDefaults] = useState<NewBatchRequest | null>(null);
  // Filter & pagination state
  const [searchQuery, setSearchQuery] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [selectedFeedstockIds, setSelectedFeedstockIds] = useState<string[]>([]);
  const [readinessFilter, setReadinessFilter] =
    useState<CreditBatchReadinessFilter>("all");

  // Side sheet state — `?batch=` deep-links the view sheet (production-run
  // convention); local state handles sheets opened by clicks.
  const router = useRouter();
  const [focusedBatchId, setFocusedBatchId] = useQueryState(
    CREDIT_BATCH_DEEP_LINK_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [deepLinkFocus, setDeepLinkFocus] = useQueryState(
    ENTITY_DEEP_LINK_FOCUS_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const handledInvalidBatchIdRef = useRef<string | null>(null);
  const [sideSheet, setSideSheet] = useState<{
    entity: CreditBatchWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [deletingVersion, setDeletingVersion] = useState<number | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<ConflictError | null>(null);
  const createIntent = useOpenCreateIntent({ initialOpen: initialCreate });

  const { facilityId: contextFacilityId } = useFacilityContext();
  // The facility's day: what the timeline marks and "New credit batch" proposes windows from.
  const { timeZone } = useFacilityClock(contextFacilityId);
  const today = formatFacilityDate(new Date(), timeZone);
  const { currentPage, pageSize, setCurrentPage, setPageSize } =
    useListPagination(contextFacilityId);

  // Data fetching — facility-scoped so batches never leak across facilities
  const { data: creditBatches, isLoading: batchesLoading, error } = useCreditBatches(
    contextFacilityId ?? undefined
  );
  const focusedBatch = useCreditBatch(focusedBatchId ?? "");
  const createCreditBatch = useCreateCreditBatch();
  const updateCreditBatch = useUpdateCreditBatch();
  const deleteCreditBatch = useDeleteCreditBatch();
  const toast = useToast();

  // Facility-scoped facets. A credit batch has exactly one feedstock, so the
  // feedstock multi-select is an OR filter across the selected catalogue ids.
  const allItems = creditBatches ?? EMPTY_CREDIT_BATCHES;
  const allBatchIds = allItems.map((batch) => batch.id);
  const facetFilteredItems = filterCreditBatches(allItems, {}, {
    search: searchQuery,
    startDate: startDateFilter,
    endDate: endDateFilter,
    feedstockTypeIds: selectedFeedstockIds,
    readiness: "all",
  });
  const facetTotalPages = Math.max(
    1,
    Math.ceil(facetFilteredItems.length / pageSize),
  );
  const facetPage = Math.min(currentPage, facetTotalPages);
  const visibleFacetIds = facetFilteredItems
    .slice((facetPage - 1) * pageSize, facetPage * pageSize)
    .map((batch) => batch.id);
  // Card pills need only the visible page. A readiness filter necessarily
  // widens the request to the date/feedstock candidate set so filtering stays
  // accurate without walking every batch on ordinary list loads.
  // The timeline loads its own readiness for the year it shows.
  const healthBatchIds = view === "timeline"
    ? []
    : readinessFilter === "all"
      ? visibleFacetIds
      : facetFilteredItems.map((batch) => batch.id);
  // The sheet's lifecycle rail needs the focused batch's summary even when it
  // is not on the visible page (deep link straight into the sheet).
  const sheetBatchId = sideSheet?.entity?.id ?? focusedBatchId;
  const summaryBatchIds =
    sheetBatchId && !healthBatchIds.includes(sheetBatchId)
      ? [...healthBatchIds, sheetBatchId]
      : healthBatchIds;
  const {
    data: batchHealthSummaries = {},
    isLoading: healthLoading,
    isFetching: healthFetching,
    error: healthError,
    refetch: refetchHealth,
  } =
    useCreditBatchHealthSummaries(
      contextFacilityId ?? undefined,
      summaryBatchIds,
    );
  const listLoading =
    batchesLoading || (readinessFilter !== "all" && healthLoading);
  const filteredItems = filterCreditBatches(
    facetFilteredItems,
    Object.fromEntries(
      healthBatchIds.map((id) => [
        id,
        batchHealthSummaries[id]?.state,
      ]),
    ),
    {
      search: "",
      startDate: "",
      endDate: "",
      feedstockTypeIds: [],
      readiness: readinessFilter,
    },
  );
  const feedstockOptions = Array.from(
    new Map(
      allItems
        .filter((batch) => batch.feedstockTypeName)
        .map((batch) => [
          batch.feedstockTypeId,
          {
            id: batch.feedstockTypeId,
            name: batch.feedstockTypeName as string,
          },
        ]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Keep preview query chunks stable while operators adjust filters; totals are
  // still calculated from the filtered subset below.
  const { data: co2eStoredPreviews = {} } =
    useCreditBatchCo2eStoredPreviews(allBatchIds);
  const hydratedFilteredItems = filteredItems.map((batch) => {
    const preview = co2eStoredPreviews[batch.id];
    return preview
      ? { ...batch, co2eStoredPreview: preview, previewAvailable: true }
      : batch;
  });

  // Client-side pagination
  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedItems = hydratedFilteredItems.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize
  );

  // Compact list summary of the visible production cohorts.
  const visibleCo2ePreviews = hydratedFilteredItems
    .map((b) => b.co2eStoredPreview)
    .filter((preview): preview is NonNullable<typeof preview> => Boolean(preview));
  const hasCompleteCo2eSummary =
    hydratedFilteredItems.length > 0 &&
    visibleCo2ePreviews.length === hydratedFilteredItems.length &&
    visibleCo2ePreviews.every((preview) => preview.co2eStoredTonnes != null);
  const totalCo2e = sumNullableBy(
    visibleCo2ePreviews,
    (preview) => preview.co2eStoredTonnes,
  );

  // Handlers
  const handleCreate = async (data: CreditBatchFormData) => {
    setCreateError(null);
    try {
      const { warning } = await createCreditBatch.mutateAsync(data);
      closeCreditBatchCreate(createIntent.clear, () => setSideSheet(null));
      // The batch is saved. A warning says only that part of its detail did
      // not load, so the operator is told what to do, not that it failed.
      if (warning) toast.warning(`${warning} Refresh the page.`);
      else toast.success("Credit batch created.");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Credit batch was not created. Check the form.";
      console.error("Credit batch create error:", err);
      setCreateError(message);
    }
  };

  const handleUpdate = async (data: CreditBatchFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    const outcome = await saveCreditBatchEdit({
      data,
      saved: sideSheet.entity,
      membershipLocked,
      update: (input) => updateCreditBatch.mutateAsync(input),
    });
    if (outcome.status === "error") {
      setUpdateError(outcome.message);
      return;
    }
    closeSideSheet();
    // The batch is saved. A warning says only that part of its detail did
    // not load, so the operator is told what to do, not that it failed.
    if (outcome.warning) toast.warning(`${outcome.warning} Refresh the page.`);
    else toast.success("Credit batch updated.");
  };

  const handleDelete = (batchId: string) => {
    const row = (creditBatches ?? []).find((item) => item.id === batchId);
    if (!row) return;
    setDeletingVersion(row.version);
    setDeleteConflict(null);
    setDeletingBatchId(batchId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingBatchId || deletingVersion === null) return;
    try {
      await deleteCreditBatch.mutateAsync({ creditBatchId: deletingBatchId, expectedVersion: deletingVersion });
      if (focusedBatchId === deletingBatchId) {
        void setFocusedBatchId(null);
        setSideSheet(null);
      }
      toast.success("Credit batch deleted.");
    } catch (error) {
      if (error instanceof ConflictError) {
        setDeleteConflict(error);
      } else {
        toast.error(toDeleteErrorMessage(error, "Credit batch", "Credit batch was not deleted. Try again."));
      }
    }
    setDeletingBatchId(null);
  };

  // The window a new credit batch opens with: the picked slot, or this month
  // until a feedstock is chosen (the form then proposes that feedstock's month).
  const windowForFeedstock = (feedstockTypeId: string) => {
    const window = defaultNewBatchWindow(
      allItems
        .filter((batch) => batch.feedstockTypeId === feedstockTypeId)
        .map((batch) => ({ start: batch.startDate, end: batch.endDate })),
      today,
    );
    return { startDate: window.start, endDate: window.end };
  };
  const openCreate = (request?: NewBatchRequest) => {
    createIntent.clear();
    setCreateDefaults(request ?? null);
    void setFocusedBatchId(null);
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: null, mode: "create" });
  };
  // Bars and rows open the batch page. The preview sheet stays for old
  // `?batch=<id>` links and for Edit.
  const openPage = (batch: CreditBatchWithRelations) => {
    router.push(creditBatchDeepLinkHref(batch.id, batch.facilityId));
  };
  const openEdit = (batch: CreditBatchWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: batch, mode: "edit" });
  };
  const closeSideSheet = () => {
    createIntent.clear();
    void setFocusedBatchId(null);
    void setDeepLinkFocus(null);
    setSideSheet(null);
    setCreateDefaults(null);
    setCreateError(null);
    setUpdateError(null);
  };

  // Clear a deep-linked `?batch=` that cannot be opened (wrong facility,
  // deleted, or cross-org) — same guard as the production-run list.
  useEffect(() => {
    if (!focusedBatchId) {
      handledInvalidBatchIdRef.current = null;
      return;
    }
    if (
      focusedBatch.isLoading ||
      focusedBatch.isFetching ||
      focusedBatch.isPending
    ) {
      return;
    }
    if (handledInvalidBatchIdRef.current === focusedBatchId) return;

    if (
      focusedBatch.data &&
      contextFacilityId &&
      focusedBatch.data.facilityId !== contextFacilityId
    ) {
      handledInvalidBatchIdRef.current = focusedBatchId;
      toast.error("Linked credit batch is not in the selected facility");
      void setFocusedBatchId(null);
      return;
    }

    if (
      focusedBatch.isError ||
      (focusedBatch.isSuccess && !focusedBatch.data)
    ) {
      handledInvalidBatchIdRef.current = focusedBatchId;
      toast.error("Linked credit batch could not be opened");
      void setFocusedBatchId(null);
    }
  }, [
    contextFacilityId,
    focusedBatch.data,
    focusedBatch.isError,
    focusedBatch.isFetching,
    focusedBatch.isLoading,
    focusedBatch.isPending,
    focusedBatch.isSuccess,
    focusedBatchId,
    setFocusedBatchId,
    toast,
  ]);

  const deepLinkedSideSheet =
    focusedBatchId &&
    focusedBatch.data &&
    (!contextFacilityId || focusedBatch.data.facilityId === contextFacilityId)
      ? ({ entity: focusedBatch.data, mode: "view" } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;

  // Member production runs for the view sheet's "Production runs" section.
  // The sheet's entity is a snapshot (click-captured, or fetched by deep link),
  // so its CO₂e preview is re-attached from the live preview query here —
  // otherwise a preview arriving after the sheet opened never reaches it and the
  // field reads as though the figure were unobtainable.
  const viewEntity = hydrateCo2ePreview(
    displaySideSheet?.entity ?? null,
    co2eStoredPreviews,
  );
  const pageBatchIds = paginatedItems.map((batch) => batch.id);
  const batchLocks = useRecordLocks("creditBatch", pageBatchIds);
  // Dry applied biochar for the visible rows only; the timeline loads its own year.
  const factsQuery = useCreditBatchTimelineFacts(
    contextFacilityId ?? undefined,
    view === "list" ? pageBatchIds : [],
  );
  const { lock: sheetLock, status: sheetLockStatus, retry: retrySheetLock, retrying: sheetLockRetrying } = useRecordLock("creditBatch", viewEntity?.id);
  const membershipLocked = isCreditBatchMembershipLocked(sheetLock);
  // One read for the one batch the sheet shows: its applied biochar is dry, as on the page.
  const sheetPageModel = useCreditBatchPageModel(viewEntity?.id ?? "");
  const runOptionsQuery = useCreditBatchProductionRunOptions({
    facilityId: viewEntity?.facilityId,
    startDate: viewEntity?.startDate,
    endDate: viewEntity?.endDate,
    includeCreditBatchId: viewEntity?.id,
  });
  const memberRunIds = new Set(viewEntity?.productionRunIds ?? []);
  const displayedRuns = (runOptionsQuery.data ?? []).filter((run) => {
    if (memberRunIds.has(run.id)) return true;
    return (
      viewEntity != null &&
      run.status !== COMPLETED_PRODUCTION_RUN_STATUS &&
      run.feedstockTypeIds.length === 1 &&
      run.feedstockTypeIds[0] === viewEntity.feedstockTypeId
    );
  });

  const handleModeChange = (mode: SideSheetMode) => {
    if (!displaySideSheet?.entity) return;
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: displaySideSheet.entity, mode });
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStartDateFilter("");
    setEndDateFilter("");
    setSelectedFeedstockIds([]);
    setReadinessFilter("all");
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(
    searchQuery ||
      startDateFilter ||
      endDateFilter ||
      selectedFeedstockIds.length > 0 ||
      readinessFilter !== "all",
  );

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="verification"
          title="Credit Batches"
          subtitle="Carbon credit batches for verification and registry"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its credit batches." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-max py-32">
        <ServerError
          message={error.message || "The credit batches could not be loaded. Refresh the page and try again."}
        />
      </div>
    );
  }

  const readinessResultsUnavailable = readinessErrorWithholdsResults(
    readinessFilter,
    healthError,
  );

  // Derived values for the side sheet
  const sideSheetOpen = !!displaySideSheet || createIntent.isOpen;
  const sideSheetMode = displaySideSheet?.mode ?? "create";
  const sideSheetEntity = viewEntity;
  const thisMonth = monthWindow(today);
  const createFormDefaults = createDefaults
    ? {
        feedstockTypeId: createDefaults.feedstockTypeId,
        startDate: createDefaults.start,
        endDate: createDefaults.end,
      }
    : { startDate: thisMonth.start, endDate: thisMonth.end };

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create credit batch" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create" || !sideSheetEntity
      ? undefined
      : formatDateRange(sideSheetEntity.startDate, sideSheetEntity.endDate);

  // Record lock (#1119): the sheet reads Sent from its own lock read alone;
  // the lock line states the reason and Edit waits for the read.
  const sideSheetLocked = sheetLock?.level === "sent";

  return (
    <div className="container-max page-shell">
      {/* Header */}
      <PageHeader
        area="verification"
        title="Credit Batches"
        subtitle="Carbon credit batches for verification and registry"
        actions={
          <Button variant="primary" onClick={() => openCreate()}>
            <PlusIcon size={20} weight="bold" />
            New credit batch
          </Button>
        }
      />

      {allItems.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-20 gap-y-8">
          <div className="flex items-center gap-8" role="group" aria-label="Credit batch view">
            {(["timeline", "list"] as const).map((option) => (
              <Button
                key={option}
                variant={view === option ? "primary" : "weak"}
                size="small"
                aria-pressed={view === option}
                onClick={() => setView(option)}
              >
                {option === "timeline" ? "Timeline" : "List"}
              </Button>
            ))}
          </div>
          {/* Compact operational summary of the listed batches. */}
          {view === "list" && (
            <div className="flex flex-wrap items-center gap-x-20 gap-y-4">
              <span className="inline-flex items-center gap-6 body-small font-medium text-[var(--color-text-primary)]">
                <CertificateIcon size={16} weight="bold" aria-hidden />
                {listLoading
                  ? "Loading batches…"
                  : readinessResultsUnavailable
                    ? "Readiness unavailable"
                    : `${totalFiltered} ${totalFiltered === 1 ? "batch" : "batches"}`}
              </span>
              {hasCompleteCo2eSummary && totalCo2e != null && (
                <span className="inline-flex items-center gap-6 body-small text-[var(--color-text-secondary)]">
                  <LeafIcon size={16} weight="bold" aria-hidden />
                  {`${totalCo2e.toFixed(2)} t estimated CO₂e stored`}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {view === "timeline" && allItems.length > 0 && contextFacilityId ? (
        <CreditBatchTimeline
          batches={allItems}
          facilityId={contextFacilityId}
          today={today}
          onNewBatch={openCreate}
        />
      ) : (
        <>
        <CreditBatchFilters
          search={searchQuery}
          startDate={startDateFilter}
          endDate={endDateFilter}
          readiness={readinessFilter}
          feedstocks={feedstockOptions}
          selectedFeedstockIds={selectedFeedstockIds}
          hasActiveFilters={hasActiveFilters}
          onSearchChange={(value) => {
            setSearchQuery(value);
            setCurrentPage(1);
          }}
          onStartDateChange={(value) => {
            setStartDateFilter(value);
            setCurrentPage(1);
          }}
          onEndDateChange={(value) => {
            setEndDateFilter(value);
            setCurrentPage(1);
          }}
          onReadinessChange={(value) => {
            setReadinessFilter(value);
            setCurrentPage(1);
          }}
          onAddFeedstock={(id) => {
            setSelectedFeedstockIds((current) => [...current, id]);
            setCurrentPage(1);
          }}
          onRemoveFeedstock={(id) => {
            setSelectedFeedstockIds((current) =>
              current.filter((feedstockId) => feedstockId !== id),
            );
            setCurrentPage(1);
          }}
          onClear={clearFilters}
        />

        {healthError && (
          <Notice
            tone="warning"
            action={
              <Button
                variant="weak"
                size="small"
                busy={healthFetching}
                onClick={() => void refetchHealth()}
              >
                Retry
              </Button>
            }
          >
            {readinessErrorMessage(readinessFilter)}
          </Notice>
        )}

        {factsQuery.error && (
          <Notice
            tone="warning"
            action={
              <Button
                variant="weak"
                size="small"
                busy={factsQuery.isFetching}
                onClick={() => void factsQuery.refetch()}
              >
                Retry
              </Button>
            }
          >
            The applied biochar of each credit batch could not be loaded.
          </Notice>
        )}

        {/* Rows or Empty State */}
        {readinessResultsUnavailable ? null : listLoading ? (
          <div
            className="bg-[var(--panel-bg)] [border:var(--panel-border)] p-32 body-small text-[var(--color-text-tertiary)]"
            aria-busy="true"
          >
            Loading credit batches…
          </div>
        ) : paginatedItems.length === 0 ? (
          <EmptyState
            padding="lg"
            icon={hasActiveFilters ? <CertificateIcon size={48} /> : <CreditBatchArt size={ILLUSTRATION_SIZE.empty} />}
            title={
              hasActiveFilters
                ? "No credit batches found"
                : "No credit batches yet"
            }
            description={
              hasActiveFilters ? "Try adjusting or clearing the filters." : undefined
            }
            action={
              !hasActiveFilters ? (
                <Button variant="primary" onClick={() => openCreate()}>
                  <PlusIcon size={18} weight="bold" />
                  Create your first credit batch
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <CreditBatchListRows>
              {paginatedItems.map((batch) => (
                <CreditBatchListRow
                  key={batch.id}
                  creditBatch={batch}
                  view={creditBatchStateOf(healthError ? undefined : batchHealthSummaries[batch.id])}
                  readinessStatus={healthError ? "failed" : healthLoading ? "loading" : "ready"}
                  facts={factsQuery.data[batch.id]}
                  factsStatus={factsQuery.error ? "failed" : factsQuery.isLoading ? "loading" : "ready"}
                  lock={batchLocks.locks[batch.id]}
                  onOpen={openPage}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
            </CreditBatchListRows>

            <ListPagination
              page={safeCurrentPage}
              pageCount={totalPages}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              className="border-t border-[var(--color-border-tertiary)] pt-16 md:px-0"
            />
          </>
        )}
        </>
      )}

      {deleteConflict && (
        <ServerError
          message={deleteConflict.message}
          action={deleteConflict.conflict.entity === "sample" && (
            <Link
              href={`/samples?${new URLSearchParams({ facility: contextFacilityId ?? "", sample: deleteConflict.conflict.id })}`}
              className="body-small underline"
            >
              Open {deleteConflict.conflict.code}
            </Link>
          )}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingBatchId}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingBatchId(null)}
        title="Delete credit batch"
        message={CREDIT_BATCH_DELETE_MESSAGE}
        isPending={deleteCreditBatch.isPending}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        detailToggle="view"
        detailScope={sideSheetEntity?.id ?? "create"}
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={handleModeChange}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit"
        canEdit={isRecordEditable(sheetLock)}
        {...recordLockSheetProps({ lock: sheetLock, status: sheetLockStatus, retry: retrySheetLock, retrying: sheetLockRetrying, inUseLocksNothing: !membershipLocked })}
        size="wide"
        sections={
          sideSheetEntity
            ? creditBatchSheetSections({
                creditBatch: sideSheetEntity,
                productionRuns: displayedRuns,
                isLoadingRuns: runOptionsQuery.isLoading,
                runsError: runOptionsQuery.error,
                isRetryingRuns: runOptionsQuery.isFetching,
                onRetryRuns: () => void runOptionsQuery.refetch(),
                healthSummary: healthError
                  ? undefined
                  : batchHealthSummaries[sideSheetEntity.id],
                isHealthLoading: healthLoading && !healthError,
                canManage,
                emissionsEntriesEnabled,
                locked: sideSheetLocked,
                activeFocusTarget:
                  sideSheetEntity.id === focusedBatchId
                    ? parseEntityFocusTarget(deepLinkFocus)
                    : null,
                appliedDryKg: sheetPageModel.error
                  ? null
                  : sheetPageModel.data?.mass.appliedDryKg,
              })
            : undefined
        }
        viewModeChildren={
          sideSheetEntity ? <RecordUsedBy lock={sheetLock} /> : undefined
        }
        viewPrimaryAction={
          sideSheetEntity ? (
            <Link
              href={creditBatchDeepLinkHref(sideSheetEntity.id, sideSheetEntity.facilityId)}
              className={buttonVariants({ variant: "primary", className: "flex-1" })}
            >
              Open credit batch
            </Link>
          ) : undefined
        }
      >
        <CreditBatchForm
          key={
            sideSheetEntity?.id ??
            `create:${createDefaults?.feedstockTypeId ?? ""}:${createDefaults?.start ?? ""}`
          }
          defaultValues={sideSheetEntity ? undefined : createFormDefaults}
          windowForFeedstock={windowForFeedstock}
          creditBatch={sideSheetEntity ?? undefined}
          onSubmit={
            sideSheetEntity && sideSheetMode === "edit"
              ? handleUpdate
              : handleCreate
          }
          onClearServerError={() => {
            setCreateError(null);
            setUpdateError(null);
          }}
          onCancel={closeSideSheet}
          isSubmitting={
            createCreditBatch.isPending || updateCreditBatch.isPending
          }
          errorMessage={createError || updateError || undefined}
          canManage={canManage}
          lock={sheetLock}
        />
      </EntitySideSheet>
    </div>
  );
}
