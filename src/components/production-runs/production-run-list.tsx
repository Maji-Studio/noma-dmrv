/**
 * ProductionRunList component
 * Main production run listing with CRUD operations, stat cards, filters, and DataTable
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import {
  FireIcon,
  LeafIcon,
  PlusIcon,
  XIcon,
  ClockIcon,
  CheckCircleIcon,
  WarningIcon,
  ProhibitIcon,
} from "@phosphor-icons/react/dist/ssr";
import {
  useCreateProductionRun,
  useDeleteProductionRun,
  useProductionRun,
  useProductionRuns,
  useUpdateProductionRun,
  useProductionRunStats,
} from "@/hooks/use-production-runs";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import { useCreateWithEvidence } from "@/hooks/use-create-with-evidence";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { DataTable } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { MassPair } from "@/components/ui/mass-pair";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { parseExactIdFilter } from "@/lib/exact-id-filter";
import { formatDate, formatDateRange, formatMassKg } from "@/lib/format-utils";
import {
  formatMoisturePercent,
  MOISTURE_FIELD_LABEL,
  qualifyMassLabel,
  WET_MASS_FIELD_LABEL,
} from "@/lib/mass-moisture";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { getRunConflict } from "@/lib/production-runs/overlap-conflict";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import { ProductionRunForm, type ProductionRunSubmitData } from "./production-run-form";
import { ProductionIncidentTable } from "./production-incident-table";
import { ProductionReadingsDocuments } from "./production-readings-documents";
import { ProductionSampleTable } from "./production-sample-table";
import {
  buildProductionRunFeedstockDetailField,
  buildProductionRunWindowDetailFields,
  productionRunStatusCertStatus,
} from "./production-run-detail-fields";
import {
  type ProductionRunFormData,
  type ProductionRunFilterData,
  type ProductionRunStatus,
} from "@/schemas/production-runs";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";

function productionRunDetailHref(run: ProductionRunWithRelations) {
  const params = new URLSearchParams({
    facility: run.facilityId,
    run: run.id,
  });
  return `/production-runs?${params.toString()}`;
}

// ============================================
// Status Badge
// ============================================

const STATUS_ICONS: Record<ProductionRunStatus, React.ReactNode> = {
  draft: <WarningIcon size={14} weight="fill" />,
  running: <ClockIcon size={14} weight="fill" />,
  complete: <CheckCircleIcon size={14} weight="fill" />,
  failed: <WarningIcon size={14} weight="fill" />,
  cancelled: <ProhibitIcon size={14} weight="fill" />,
};

function RunStatusBadge({ status }: { status: ProductionRunStatus }) {
  return <StatusBadge status={status} icon={STATUS_ICONS[status]} />;
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (run: ProductionRunWithRelations) => void,
  onDelete: (runId: string) => void
): ColumnDef<ProductionRunWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      id: "facility",
      header: "Facility",
      accessorFn: (row) => row.facilityName ?? "",
      cell: ({ row }) => <span>{row.original.facilityName || "Not available"}</span>,
    },
    {
      id: "reactor",
      header: "Reactor",
      accessorFn: (row) => row.reactorIdentifier ?? "",
    },
    {
      accessorKey: "totalFeedstockWetMassKg",
      header: "Feedstock wet mass",
      cell: ({ row }) => (
        <span className="font-mono">{formatMassKg(row.original.totalFeedstockWetMassKg)}</span>
      ),
    },
    {
      accessorKey: "biocharOutputKg",
      header: "Biochar wet mass",
      cell: ({ row }) => (
        <span className="font-mono">{formatMassKg(row.original.biocharOutputKg)}</span>
      ),
    },
    {
      accessorKey: "biocharDryMassKg",
      header: "Biochar dry mass",
      cell: ({ row }) => (
        <span className="font-mono">{formatMassKg(row.original.biocharDryMassKg)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <RunStatusBadge status={row.original.status} />,
    },
    {
      id: "certifyReadiness",
      header: "Certification",
      cell: ({ row }) => (
        <EntityCertifyReadinessBadge
          readiness={deriveEntityCertifyReadiness("productionRun", row.original)}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <RowActionsMenu
            label={`Actions for ${row.original.code}`}
            actions={[
              {
                label: "Open details",
                href: productionRunDetailHref(row.original),
              },
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
// Component
// ============================================

export function ProductionRunList() {
  // Global facility context
  const { facilityId, facilities } = useFacilityContext();
  const [focusedRunId, setFocusedRunId] = useQueryState(
    "run",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [affectedRunIdsParam, setAffectedRunIdsParam] = useQueryState(
    "ids",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [creditBatchFilterParam, setCreditBatchFilter] = useQueryState(
    "creditBatch",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const creditBatchFilter = creditBatchFilterParam ?? "";
  const affectedRunFilter = parseExactIdFilter(affectedRunIdsParam);
  const affectedRunIds = affectedRunFilter.ids;
  useEffect(() => {
    if (
      affectedRunIdsParam &&
      affectedRunFilter.normalized !== affectedRunIdsParam
    ) {
      void setAffectedRunIdsParam(affectedRunFilter.normalized);
    }
  }, [
    affectedRunFilter.normalized,
    affectedRunIdsParam,
    setAffectedRunIdsParam,
  ]);
  const handledInvalidRunIdRef = useRef<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination(
      `${facilityId ?? ""}:${creditBatchFilter}:${affectedRunFilter.normalized ?? ""}`,
    );
  const debouncedSearch = useDebounce(searchQuery, LIST_SEARCH_DEBOUNCE_MS);

  // UI state
  const [sideSheet, setSideSheet] = useState<{
    entity: ProductionRunWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filters: Partial<ProductionRunFilterData> = {
    ids: affectedRunIds.length > 0 ? affectedRunIds : undefined,
    search: debouncedSearch || undefined,
    facilityId: facilityId || undefined,
    creditBatchId: creditBatchFilter || undefined,
    status: (statusFilter as ProductionRunStatus) || undefined,
    page: currentPage,
    pageSize,
    sortBy: "date",
    sortOrder: "desc",
  };

  const { data: runsData, isLoading, error: fetchError } = useProductionRuns(filters, {
    enabled: !!facilityId,
  });
  const focusedRun = useProductionRun(focusedRunId ?? "", !!focusedRunId);
  const { data: statsData, isLoading: statsLoading } = useProductionRunStats(
    facilityId || undefined,
    !!facilityId,
  );
  const { data: creditBatches } = useCreditBatches(facilityId || undefined);

  const createRun = useCreateProductionRun();
  const updateRun = useUpdateProductionRun();
  const deleteRun = useDeleteProductionRun();
  const toast = useToast();

  const runs = runsData?.items ?? [];
  const totalPages = runsData?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });

  const createWithEvidence = useCreateWithEvidence({
    entityType: "production_run",
    entityNoun: "Production run",
    executeCreate: async (data: ProductionRunSubmitData) => {
      const run = await createRun.mutateAsync(data as ProductionRunFormData);
      return { entities: [run], result: run };
    },
    setError: setCreateError,
    setUpdateError,
    getCreateErrorMessage: (error) => {
      // Let the form surface an overlap conflict inline (on the start field,
      // with a link to the conflicting run); show other errors as a banner.
      if (getRunConflict(error)) throw error;
      return error instanceof Error
        ? error.message
        : "Production run was not created. Check the form.";
    },
    unresolvedUpdateMessage:
      "Resolve or remove the failed attachment before saving this production run.",
    openEditOnFailure: (run) =>
      setSideSheet({ entity: run, mode: "edit" }),
    closeOnSuccess: () => setSideSheet(null),
    onSuccess: () =>
      toast.success("Production run created."),
  });
  const { deferredAttachments, isFlushing } = createWithEvidence;

  const handleCreate = createWithEvidence.handleCreate;

  const handleUpdate = async (data: ProductionRunSubmitData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    if (createWithEvidence.guardUpdate()) return;
    try {
      const { startTime, endTime } = data;
      await updateRun.mutateAsync({
        // startDate/endDate are folded into startTime/endTime by the form and
        // are stripped by the update schema.
        ...data,
        productionRunId: sideSheet.entity.id,
        startTime: startTime instanceof Date ? startTime : new Date(startTime),
        endTime:
          endTime === null
            ? null
            : endTime === undefined
              ? undefined
              : endTime instanceof Date
                ? endTime
                : new Date(endTime),
      });
      createWithEvidence.reset();
      setSideSheet(null);
      toast.success("Production run updated.");
    } catch (error) {
      if (getRunConflict(error)) throw error;
      setUpdateError(error instanceof Error ? error.message : "Production run was not saved. Try again.");
    }
  };

  const handleDelete = (runId: string) => setDeletingRunId(runId);

  const handleDeleteConfirm = async () => {
    if (!deletingRunId) return;
    setDeleteError(null);
    try {
      await deleteRun.mutateAsync(deletingRunId);
      if (focusedRunId === deletingRunId) {
        setFocusedRunId(null);
      }
      setDeletingRunId(null);
      toast.success("Production run deleted.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Production run was not deleted. Try again.");
    }
  };

  const openCreate = () => {
    setFocusedRunId(null);
    setCreateError(null);
    setUpdateError(null);
    createWithEvidence.reset();
    setSideSheet({ entity: null, mode: "create" });
  };
  const openView = (run: ProductionRunWithRelations) => { setFocusedRunId(run.id); setSideSheet({ entity: run, mode: "view" }); };
  const openEdit = (run: ProductionRunWithRelations) => { setCreateError(null); setUpdateError(null); createWithEvidence.reset(); setSideSheet({ entity: run, mode: "edit" }); };
  const closeSideSheet = () => {
    setFocusedRunId(null);
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
    createWithEvidence.reset();
  };
  useOpenCreateIntent(openCreate);

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setCreditBatchFilter(null);
    setAffectedRunIdsParam(null);
    setCurrentPage(1);
  };
  const hasActiveFilters =
    searchQuery ||
    statusFilter ||
    creditBatchFilter ||
    affectedRunIds.length > 0;

  const columns = createColumns(openEdit, handleDelete);

  useEffect(() => {
    if (!focusedRunId) {
      handledInvalidRunIdRef.current = null;
      return;
    }
    if (focusedRun.isLoading || focusedRun.isFetching || focusedRun.isPending) return;
    if (handledInvalidRunIdRef.current === focusedRunId) return;

    if (focusedRun.data && facilityId && focusedRun.data.facilityId !== facilityId) {
      handledInvalidRunIdRef.current = focusedRunId;
      toast.error("Linked production run is not in the selected facility");
      setFocusedRunId(null);
      return;
    }

    if (focusedRun.isError || (focusedRun.isSuccess && !focusedRun.data)) {
      handledInvalidRunIdRef.current = focusedRunId;
      toast.error("Linked production run could not be opened");
      setFocusedRunId(null);
    }
  }, [
    facilityId,
    focusedRun.data,
    focusedRun.isError,
    focusedRun.isFetching,
    focusedRun.isLoading,
    focusedRun.isPending,
    focusedRun.isSuccess,
    focusedRunId,
    setFocusedRunId,
    toast,
  ]);

  const deepLinkedSideSheet =
    focusedRunId &&
    focusedRun.data &&
    (!facilityId || focusedRun.data.facilityId === facilityId)
      ? ({ entity: focusedRun.data, mode: "view" } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;

  const confirmCreateClose = () =>
    createWithEvidence.confirmClose(displaySideSheet?.mode === "create");
  const attemptCloseSideSheet = () => {
    if (confirmCreateClose()) closeSideSheet();
  };

  const handleModeChange = (mode: SideSheetMode) => {
    if (!displaySideSheet?.entity) return;
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: displaySideSheet.entity, mode });
  };

  if (!facilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="production"
          title="Production Runs"
          subtitle="Pyrolysis batches from feedstock to biochar output"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its production runs." />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "The production runs could not be loaded. Refresh the page and try again."} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!displaySideSheet;
  const sideSheetMode = displaySideSheet?.mode ?? "create";
  const sideSheetEntity = displaySideSheet?.entity ?? null;
  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Production Run" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create"
      ? undefined
      : sideSheetEntity
        ? formatDate(sideSheetEntity.date)
        : undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="production"
        title="Production Runs"
        subtitle="Pyrolysis batches from feedstock to biochar output"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New Production Run
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        <StatCard title="Total Runs" value={statsData?.totalRuns ?? 0} icon={<FireIcon size={24} weight="bold" />} description="All production batches" isLoading={statsLoading} />
        <StatCard
          title="Biochar Output"
          value={
            <MassPair
              wetKg={statsData?.totalBiocharKg ?? 0}
              dryKg={statsData ? statsData.totalBiocharDryKg : 0}
            />
          }
          valueLayout="breakdown"
          icon={<LeafIcon size={24} weight="bold" />}
          isLoading={statsLoading}
        />
        <StatCard title="Running" value={statsData?.runningCount ?? 0} icon={<ClockIcon size={24} weight="bold" />} description="Currently active runs" isLoading={statsLoading} />
        <StatCard title="Completed" value={statsData?.completedCount ?? 0} icon={<CheckCircleIcon size={24} weight="bold" />} description="Finished production runs" isLoading={statsLoading} />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={runs}
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
        aria-label="Production runs"
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<FireIcon size={48} />}
            title={
              creditBatchFilter
                ? "No production runs in this credit batch"
                : hasActiveFilters
                  ? "No production runs found"
                  : "No production runs yet"
            }
            description={hasActiveFilters ? "Try adjusting your search or filters." : "A production run is one pyrolysis batch, turning feedstock into biochar."}
            action={
              !hasActiveFilters ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={20} weight="bold" />
                  Create your first production run
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <div className="flex w-full flex-col gap-8 sm:flex-1 sm:flex-row sm:items-center">
            {affectedRunIds.length > 0 && (
              <span className="inline-flex h-32 shrink-0 items-center self-start border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] px-10 body-caption font-medium text-[var(--st-wait)] sm:self-auto">
                {affectedRunIds.length} affected production {affectedRunIds.length === 1 ? "run" : "runs"}
              </span>
            )}
            <DataTable.Search
              placeholder="Search production runs..."
              aria-label="Search production runs"
            />
          </div>
          <DataTable.Controls>
            <DataTable.FilterSelect
              value={creditBatchFilter}
              onChange={(event) => {
                setCreditBatchFilter(event.target.value || null);
                setCurrentPage(1);
              }}
              aria-label="Filter production runs by credit batch"
            >
              <option value="">All credit batches</option>
              {creditBatches?.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {formatDateRange(batch.startDate, batch.endDate)}
                </option>
              ))}
            </DataTable.FilterSelect>
            <DataTable.FilterSelect
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              aria-label="Filter production runs by status"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="running">Running</option>
              <option value="complete">Complete</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
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
        isOpen={!!deletingRunId}
        title="Delete Production Run"
        message="Are you sure you want to delete this production run? This action cannot be undone. Note: Production runs with dependent biochar products or credit batches cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeletingRunId(null); setDeleteError(null); }}
        isPending={deleteRun.isPending}
      />

      <EntitySideSheet
        numberedSections
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        onCloseAttempt={confirmCreateClose}
        mode={sideSheetMode}
        onModeChange={handleModeChange}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Production Run"
        size="wide"
        sections={sideSheetEntity ? [
          {
            title: "Run setup",
            fields: [
              { label: "Reactor", value: sideSheetEntity.reactorIdentifier },
              {
                label: "Status",
                value: <RunStatusBadge status={sideSheetEntity.status} />,
                certifyRequired: true,
                certifyStatus: productionRunStatusCertStatus(
                  sideSheetEntity.status,
                ),
              },
              ...(sideSheetEntity.status === "cancelled"
                ? [{ label: "Cancellation reason", value: sideSheetEntity.cancellationReason }]
                : []),
              ...buildProductionRunWindowDetailFields(sideSheetEntity, facilities),
              { label: "Operator", value: sideSheetEntity.operatorName },
            ],
          },
          {
            title: "Feedstock & processing",
            fields: [
              buildProductionRunFeedstockDetailField(sideSheetEntity.feedstocks),
              {
                label: "Source bin",
                value: sideSheetEntity.feedstockStorageLocationName,
              },
              { label: qualifyMassLabel(WET_MASS_FIELD_LABEL, "Feedstock"), ...certificationDetailField("productionRun", "feedstockWetMassKg"), value: formatMassKg(sideSheetEntity.feedstockWetMassKg) },
              { label: qualifyMassLabel(MOISTURE_FIELD_LABEL, "Feedstock"), ...certificationDetailField("productionRun", "feedstockMoisturePercent"), value: formatMoisturePercent(sideSheetEntity.feedstockMoisturePercent) },
              { label: "Feed rate (kg/hr)", value: sideSheetEntity.feedingRateKgHr != null ? `${sideSheetEntity.feedingRateKgHr} kg/hr` : null },
              { label: "Residence time (min)", value: sideSheetEntity.residenceTimeMinutes != null ? `${sideSheetEntity.residenceTimeMinutes} min` : null },
            ],
            content: (
              <MoistureSplit
                wetMassKg={sideSheetEntity.feedstockWetMassKg}
                moisturePercent={sideSheetEntity.feedstockMoisturePercent}
                dryMassKg={sideSheetEntity.feedstockMassDryKg}
                materialLabel="Feedstock"
              />
            ),
          },
          {
            title: "Output",
            fields: [
              {
                label: "Biochar storage",
                value: sideSheetEntity.biocharStorageLocationName,
              },
              { label: qualifyMassLabel(WET_MASS_FIELD_LABEL, "Biochar"), ...certificationDetailField("productionRun", "biocharOutputKg"), value: formatMassKg(sideSheetEntity.biocharOutputKg) },
              { label: qualifyMassLabel(MOISTURE_FIELD_LABEL, "Biochar"), ...certificationDetailField("productionRun", "biocharMoisturePercent"), value: formatMoisturePercent(sideSheetEntity.biocharMoisturePercent) },
            ],
            content: (
              <MoistureSplit
                wetMassKg={sideSheetEntity.biocharOutputKg}
                moisturePercent={sideSheetEntity.biocharMoisturePercent}
                dryMassKg={sideSheetEntity.biocharDryMassKg}
                materialLabel="Biochar"
              />
            ),
          },
          {
            title: "Energy",
            fields: [
              { label: "Startup / plant diesel (L)", ...certificationDetailField("productionRun", "dieselOperationLiters"), value: sideSheetEntity.dieselOperationLiters != null ? `${sideSheetEntity.dieselOperationLiters} L` : null },
              { label: "Genset diesel (L)", ...certificationDetailField("productionRun", "dieselGensetLiters"), value: sideSheetEntity.dieselGensetLiters != null ? `${sideSheetEntity.dieselGensetLiters} L` : null },
              { label: "Preprocess fuel (L)", ...certificationDetailField("productionRun", "preprocessingFuelLiters"), value: sideSheetEntity.preprocessingFuelLiters != null ? `${sideSheetEntity.preprocessingFuelLiters} L` : null },
              { label: "Electricity (kWh)", ...certificationDetailField("productionRun", "electricityKwh"), value: sideSheetEntity.electricityKwh != null ? `${sideSheetEntity.electricityKwh} kWh` : null },
            ],
          },
          {
            title: "Readings file",
            fields: [],
            content: (
              <ProductionReadingsDocuments
                productionRunId={sideSheetEntity.id}
                readOnly
              />
            ),
          },
          {
            title: "Samples & incidents",
            fields: [],
            content: (
              <div className="space-y-20">
                <ProductionSampleTable productionRunId={sideSheetEntity.id} readOnly />
                <ProductionIncidentTable productionRunId={sideSheetEntity.id} readOnly />
              </div>
            ),
          },
        ] : undefined}
      >
        <ProductionRunForm
          key={sideSheetEntity?.id ?? "create"}
          productionRun={sideSheetEntity ?? undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={attemptCloseSideSheet}
          isSubmitting={createRun.isPending || updateRun.isPending || isFlushing}
          errorMessage={createError || updateError || undefined}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save Changes" : "Create Production Run"}
          deferredAttachments={deferredAttachments}
        >
          {sideSheetEntity && sideSheetMode === "edit" ? (
            <>
              <ProductionSampleTable productionRunId={sideSheetEntity.id} />
              <ProductionIncidentTable
                productionRunId={sideSheetEntity.id}
                facilityId={sideSheetEntity.facilityId}
                defaultReactorId={sideSheetEntity.reactorId}
                defaultOperatorId={sideSheetEntity.operatorId}
              />
            </>
          ) : null}
        </ProductionRunForm>
      </EntitySideSheet>
    </div>
  );
}
