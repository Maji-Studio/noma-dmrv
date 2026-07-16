/**
 * ProductionRunList component
 * Main production run listing with CRUD operations, stat cards, filters, and DataTable
 */
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import {
  useCreateProductionRun,
  useDeleteProductionRun,
  useProductionRun,
  useProductionRuns,
  useUpdateProductionRun,
  useProductionRunStats,
} from "@/hooks/use-production-runs";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDeferredAttachments } from "@/hooks/use-deferred-attachments";
import { useImportProductionRunReadings } from "@/hooks/use-production-run-reading-imports";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { DataTable } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { formatSafeDate } from "@/lib/format-utils";
import { getRunConflict } from "@/lib/production-runs/overlap-conflict";
import { ProductionRunReadingTable } from "@/components/production-run-readings";
import { ProductionRunForm, type ProductionRunSubmitData } from "./production-run-form";
import { ProductionIncidentTable } from "./production-incident-table";
import { ProductionReadingsDocuments } from "./production-readings-documents";
import { ProductionSampleTable } from "./production-sample-table";
import {
  type ProductionRunFormData,
  type ProductionRunFilterData,
  type ProductionRunStatus,
} from "@/schemas/production-runs";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";

const TOAST_GAP_PREVIEW_LIMIT = 3;

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
  void: <ProhibitIcon size={14} weight="fill" />,
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
      cell: ({ row }) => formatSafeDate(row.original.date),
    },
    {
      id: "facility",
      header: "Facility",
      accessorFn: (row) => row.facilityName ?? "",
      cell: ({ row }) => <span>{row.original.facilityName || "—"}</span>,
    },
    {
      id: "reactor",
      header: "Reactor",
      accessorFn: (row) => row.reactorIdentifier ?? "",
    },
    {
      accessorKey: "totalFeedstockMassKg",
      header: "Feedstock (kg)",
      cell: ({ row }) => row.original.totalFeedstockMassKg?.toLocaleString() ?? "\u2014",
    },
    {
      accessorKey: "biocharOutputKg",
      header: "Biochar Wet (kg)",
      cell: ({ row }) => row.original.biocharOutputKg?.toLocaleString() ?? "\u2014",
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
  const { facilityId } = useFacilityContext();
  const [focusedRunId, setFocusedRunId] = useQueryState(
    "run",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const handledInvalidRunIdRef = useRef<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // UI state
  const [sideSheet, setSideSheet] = useState<{
    entity: ProductionRunWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filters: Partial<ProductionRunFilterData> = useMemo(
    () => ({
      search: searchQuery || undefined,
      facilityId: facilityId || undefined,
      status: (statusFilter as ProductionRunStatus) || undefined,
      page: currentPage,
      pageSize,
      sortBy: "date",
      sortOrder: "desc",
    }),
    [searchQuery, facilityId, statusFilter, currentPage, pageSize]
  );

  const { data: runsData, isLoading, error: fetchError } = useProductionRuns(filters, {
    enabled: !!facilityId,
  });
  const focusedRun = useProductionRun(focusedRunId ?? "", !!focusedRunId);
  const { data: statsData, isLoading: statsLoading } = useProductionRunStats(
    facilityId || undefined,
    !!facilityId,
  );

  const createRun = useCreateProductionRun();
  const updateRun = useUpdateProductionRun();
  const deleteRun = useDeleteProductionRun();
  const toast = useToast();
  const deferredAttachments = useDeferredAttachments();
  const importReadings = useImportProductionRunReadings();
  const [isFlushing, setIsFlushing] = useState(false);

  const runs = runsData?.items ?? [];
  const totalPages = runsData?.totalPages ?? 0;
  const showSavedToast = (
    message: string,
    run: ProductionRunWithRelations,
  ) => {
    const readiness = deriveEntityCertifyReadiness("productionRun", run);
    if (readiness.state === "ready") {
      toast.success(message);
      return;
    }
    const gapLabels = readiness.gaps
      .slice(0, TOAST_GAP_PREVIEW_LIMIT)
      .map((gap) => gap.label)
      .join(", ");
    const suffix = readiness.gaps.length > TOAST_GAP_PREVIEW_LIMIT ? ", ..." : "";
    toast.success(`${message}. Still needed to certify: ${gapLabels}${suffix}`);
  };

  const handleCreate = async (data: ProductionRunSubmitData) => {
    setCreateError(null);
    try {
      const run = await createRun.mutateAsync(data as ProductionRunFormData);
      setIsFlushing(true);
      const flushResult = await deferredAttachments.flush(
        "production_run",
        run.id,
      );
      if (!flushResult.ok) {
        setSideSheet({ entity: run, mode: "edit" });
        setCreateError(
          `Production run created, but ${flushResult.failed.length} ${flushResult.failed.length === 1 ? "attachment" : "attachments"} failed to upload.`,
        );
        return;
      }
      // A deferred readings CSV is uploaded as a document but not yet imported;
      // run the same import edit mode triggers on upload so the run does not
      // land with an empty readings table (matching onUploaded={runImport}).
      const readingsDocs = flushResult.uploaded.filter(
        (attachment) =>
          attachment.documentType === "sensor_data" && attachment.documentId,
      );
      let importFailedCount = 0;
      for (const attachment of readingsDocs) {
        try {
          const importResult = await importReadings.mutateAsync(
            attachment.documentId as string,
          );
          toast.success(`Imported ${importResult.insertedRows} readings`);
        } catch {
          importFailedCount += 1;
        }
      }
      if (importFailedCount > 0) {
        // The import fn records a durable "failed" flag on the document, so the
        // edit-mode readings panel surfaces its Re-import affordance.
        deferredAttachments.clear();
        setSideSheet({ entity: run, mode: "edit" });
        setCreateError(
          `Production run created, but ${importFailedCount} readings ${importFailedCount === 1 ? "file" : "files"} could not be imported. Re-import ${importFailedCount === 1 ? "it" : "them"} below.`,
        );
        return;
      }
      deferredAttachments.clear();
      setSideSheet(null);
      showSavedToast("Production run created successfully", run);
    } catch (error) {
      // Let the form surface an overlap conflict inline (on the start field,
      // with a link to the conflicting run); show other errors as a banner.
      if (getRunConflict(error)) throw error;
      setCreateError(error instanceof Error ? error.message : "Failed to create production run");
    } finally {
      setIsFlushing(false);
    }
  };

  const handleUpdate = async (data: ProductionRunSubmitData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    if (
      deferredAttachments.attachments.some(
        (attachment) => attachment.status === "failed",
      )
    ) {
      setUpdateError(
        "Resolve or remove the failed readings file before saving this production run.",
      );
      return;
    }
    try {
      const { startTime, endTime } = data;
      const run = await updateRun.mutateAsync({
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
      deferredAttachments.clear();
      setSideSheet(null);
      showSavedToast("Production run updated successfully", run);
    } catch (error) {
      if (getRunConflict(error)) throw error;
      setUpdateError(error instanceof Error ? error.message : "Failed to update production run");
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
      toast.success("Production run deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete production run");
    }
  };

  const openCreate = () => {
    setFocusedRunId(null);
    setCreateError(null);
    setUpdateError(null);
    deferredAttachments.clear();
    setSideSheet({ entity: null, mode: "create" });
  };
  const openView = (run: ProductionRunWithRelations) => { setFocusedRunId(run.id); setSideSheet({ entity: run, mode: "view" }); };
  const openEdit = (run: ProductionRunWithRelations) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: run, mode: "edit" }); };
  const closeSideSheet = () => {
    setFocusedRunId(null);
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
    deferredAttachments.clear();
  };
  useOpenCreateIntent(openCreate);

  const clearFilters = () => { setSearchQuery(""); setStatusFilter(""); setCurrentPage(1); };
  const hasActiveFilters = searchQuery || statusFilter;

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

  const unsavedAttachmentCount = deferredAttachments.attachments.filter(
    (attachment) => attachment.status !== "uploaded",
  ).length;
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
        <ServerError message={fetchError.message || "Failed to load production runs"} />
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
        ? formatSafeDate(sideSheetEntity.date)
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
        <StatCard title="Biochar Output" value={`${((statsData?.totalBiocharKg ?? 0) / 1000).toFixed(1)} t`} icon={<LeafIcon size={24} weight="bold" />} description="Total biochar produced" isLoading={statsLoading} />
        <StatCard title="Running" value={statsData?.runningCount ?? 0} icon={<ClockIcon size={24} weight="bold" />} description="Currently active runs" isLoading={statsLoading} />
        <StatCard title="Completed" value={statsData?.completedCount ?? 0} icon={<CheckCircleIcon size={24} weight="bold" />} description="Finished production runs" isLoading={statsLoading} />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={runs}
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
            icon={<FireIcon size={48} />}
            title={hasActiveFilters ? "No production runs found" : "No production runs yet"}
            description={hasActiveFilters ? "Try adjusting your search or filters." : "Create your first production run to start tracking pyrolysis batches."}
            action={
              !hasActiveFilters ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={20} weight="bold" />
                  Create Production Run
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
              placeholder="Search production runs..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full h-40 pl-36 pr-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              aria-label="Search table"
            />
          </div>
          <div className="flex items-center gap-8">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              className="h-40 px-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="running">Running</option>
              <option value="complete">Complete</option>
              <option value="void">Void</option>
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
        isOpen={!!deletingRunId}
        title="Delete Production Run"
        message="Are you sure you want to delete this production run? This action cannot be undone. Note: Production runs with associated samples or credit batches cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeletingRunId(null); setDeleteError(null); }}
        isPending={deleteRun.isPending}
      />

      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        onCloseAttempt={confirmCreateClose}
        mode={sideSheetMode}
        onModeChange={handleModeChange}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Production Run"
        size="wide"
        viewModeChildren={sideSheetEntity ? (
          <>
            <ProductionRunReadingTable
              productionRunId={sideSheetEntity.id}
              readOnly
            />
            <ProductionReadingsDocuments
              productionRunId={sideSheetEntity.id}
              readOnly
            />
            <ProductionSampleTable
              productionRunId={sideSheetEntity.id}
              readOnly
            />
            <ProductionIncidentTable
              productionRunId={sideSheetEntity.id}
              readOnly
            />
          </>
        ) : undefined}
        sections={sideSheetEntity ? [
          {
            title: "General",
            fields: [
              { label: "Code", value: sideSheetEntity.code },
              { label: "Date", value: formatSafeDate(sideSheetEntity.date) },
              { label: "Status", value: <RunStatusBadge status={sideSheetEntity.status} /> },
              {
                label: "Certification",
                value: (
                  <EntityCertifyReadinessBadge
                    readiness={deriveEntityCertifyReadiness(
                      "productionRun",
                      sideSheetEntity,
                    )}
                  />
                ),
              },
            ],
          },
          {
            title: "Location",
            fields: [
              { label: "Facility", value: sideSheetEntity.facilityName },
              { label: "Reactor", value: sideSheetEntity.reactorIdentifier },
            ],
          },
          {
            title: "Operations",
            fields: [
              { label: "Operator", value: sideSheetEntity.operatorName },
              { label: "Feeding Rate", value: sideSheetEntity.feedingRateKgHr != null ? `${sideSheetEntity.feedingRateKgHr} kg/hr` : null },
              { label: "Residence Time", value: sideSheetEntity.residenceTimeMinutes != null ? `${sideSheetEntity.residenceTimeMinutes} min` : null },
            ],
          },
          {
            title: "Output",
            fields: [
              { label: "Feedstock Wet Mass", ...certificationDetailField("productionRun", "feedstockWetMassKg"), value: sideSheetEntity.feedstockWetMassKg != null ? `${sideSheetEntity.feedstockWetMassKg.toLocaleString()} kg` : null },
              { label: "Feedstock Moisture", ...certificationDetailField("productionRun", "feedstockMoisturePercent"), value: sideSheetEntity.feedstockMoisturePercent != null ? `${sideSheetEntity.feedstockMoisturePercent}%` : null },
              { label: "Biochar Wet Mass", ...certificationDetailField("productionRun", "biocharOutputKg"), value: sideSheetEntity.biocharOutputKg != null ? `${sideSheetEntity.biocharOutputKg.toLocaleString()} kg` : null },
              { label: "Biochar Moisture", ...certificationDetailField("productionRun", "biocharMoisturePercent"), value: sideSheetEntity.biocharMoisturePercent != null ? `${sideSheetEntity.biocharMoisturePercent}%` : null },
              { label: "Biochar Dry Mass", value: sideSheetEntity.biocharDryMassKg != null ? `${sideSheetEntity.biocharDryMassKg.toLocaleString()} kg` : null },
            ],
          },
          {
            title: "Energy",
            fields: [
              { label: "Diesel Operation", ...certificationDetailField("productionRun", "dieselOperationLiters"), value: sideSheetEntity.dieselOperationLiters != null ? `${sideSheetEntity.dieselOperationLiters} L` : null },
              { label: "Diesel Genset", ...certificationDetailField("productionRun", "dieselGensetLiters"), value: sideSheetEntity.dieselGensetLiters != null ? `${sideSheetEntity.dieselGensetLiters} L` : null },
              { label: "Preprocessing Fuel", ...certificationDetailField("productionRun", "preprocessingFuelLiters"), value: sideSheetEntity.preprocessingFuelLiters != null ? `${sideSheetEntity.preprocessingFuelLiters} L` : null },
              { label: "Electricity", ...certificationDetailField("productionRun", "electricityKwh"), value: sideSheetEntity.electricityKwh != null ? `${sideSheetEntity.electricityKwh} kWh` : null },
            ],
          },
          {
            title: "Storage",
            fields: [
              { label: "Biochar Storage", value: sideSheetEntity.biocharStorageLocationCode },
              { label: "Feedstock Storage", value: sideSheetEntity.feedstockStorageLocationCode },
            ],
          },
        ] : undefined}
      >
        {(createError || updateError) && <div className="mb-24"><ServerError message={createError || updateError || ""} /></div>}
        <ProductionRunForm
          key={sideSheetEntity?.id ?? "create"}
          productionRun={sideSheetEntity ?? undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={attemptCloseSideSheet}
          isSubmitting={createRun.isPending || updateRun.isPending || isFlushing}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save Changes" : "Create Production Run"}
          deferredAttachments={deferredAttachments}
        >
          {sideSheetEntity && sideSheetMode === "edit" ? (
            <>
              <ProductionRunReadingTable productionRunId={sideSheetEntity.id} />
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
