/**
 * ProductionRunList component
 * Main production run listing with CRUD operations, stat cards, filters, and DataTable
 */
"use client";

import { useState, useMemo } from "react";
import { parseLocalDateString } from "@/lib/date-utils";

function formatDateField(d: string): string {
  const dateObj = /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? parseLocalDateString(d)
    : new Date(d);
  return dateObj.toLocaleDateString();
}
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Fire,
  Leaf,
  Plus,
  X,
  Clock,
  CheckCircle,
  Warning,
  Prohibit,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import {
  useCreateProductionRun,
  useDeleteProductionRun,
  useProductionRuns,
  useUpdateProductionRun,
  useProductionRunStats,
} from "@/hooks/use-production-runs";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { ProductionRunForm } from "./production-run-form";
import { ProductionIncidentTable } from "./production-incident-table";
import { ProductionSampleTable } from "./production-sample-table";
import {
  formatProductionRunStatus,
  getStatusColorClass,
  type ProductionRunFormData,
  type ProductionRunFilterData,
  type ProductionRunStatus,
} from "@/schemas/production-runs";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";

// ============================================
// Status Badge
// ============================================

function StatusBadge({ status }: { status: ProductionRunStatus }) {
  const colorClass = getStatusColorClass(status);
  const label = formatProductionRunStatus(status);
  const icons: Record<ProductionRunStatus, React.ReactNode> = {
    draft: <Warning size={14} weight="fill" />,
    running: <Clock size={14} weight="fill" />,
    complete: <CheckCircle size={14} weight="fill" />,
    void: <Prohibit size={14} weight="fill" />,
  };

  return (
    <span className={`inline-flex items-center gap-4 px-8 py-2 text-[var(--text-xs)] font-medium ${colorClass}`}>
      {icons[status]}
      {label}
    </span>
  );
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
      cell: ({ row }) => formatDateField(row.original.date),
    },
    {
      id: "facility",
      header: "Facility",
      accessorFn: (row) => row.facilityCode ?? "",
      cell: ({ row }) => (
        <Link
          href={`/facilities/${row.original.facilityId}`}
          className="text-[var(--clr-dark-purple)] hover:underline"
        >
          {row.original.facilityCode}
        </Link>
      ),
    },
    {
      id: "reactor",
      header: "Reactor",
      accessorFn: (row) => row.reactorCode ?? "",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "totalFeedstockMassKg",
      header: "Feedstock (kg)",
      cell: ({ row }) => row.original.totalFeedstockMassKg?.toLocaleString() ?? "\u2014",
    },
    {
      accessorKey: "biocharOutputKg",
      header: "Biochar (kg)",
      cell: ({ row }) => row.original.biocharOutputKg?.toLocaleString() ?? "\u2014",
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-8">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(row.original); }}
            className="h-32 px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small transition-colors"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(row.original.id); }}
            className="h-32 px-12 border border-[var(--color-signal-red)] text-[var(--color-signal-red)] rounded-none hover:bg-[var(--color-signal-red)]/10 body-small transition-colors"
          >
            Delete
          </button>
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

  const { data: runsData, isLoading, error: fetchError } = useProductionRuns(filters);
  const { data: statsData, isLoading: statsLoading } = useProductionRunStats(facilityId || undefined);

  const createRun = useCreateProductionRun();
  const updateRun = useUpdateProductionRun();
  const deleteRun = useDeleteProductionRun();
  const toast = useToast();

  const runs = runsData?.items ?? [];
  const totalPages = runsData?.totalPages ?? 0;

  const handleCreate = async (data: ProductionRunFormData) => {
    setCreateError(null);
    try {
      await createRun.mutateAsync(data);
      setSideSheet(null);
      toast.success("Production run created successfully");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create production run");
    }
  };

  const handleUpdate = async (data: ProductionRunFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      const { date, startTime, endTime, ...rest } = data;
      await updateRun.mutateAsync({
        productionRunId: sideSheet.entity.id,
        ...rest,
        date: date instanceof Date ? date : new Date(date),
        startTime: startTime instanceof Date ? startTime : new Date(startTime),
        endTime: endTime !== undefined
          ? endTime instanceof Date
            ? endTime
            : new Date(endTime)
          : undefined,
      });
      setSideSheet(null);
      toast.success("Production run updated successfully");
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Failed to update production run");
    }
  };

  const handleDelete = (runId: string) => setDeletingRunId(runId);

  const handleDeleteConfirm = async () => {
    if (!deletingRunId) return;
    setDeleteError(null);
    try {
      await deleteRun.mutateAsync(deletingRunId);
      setDeletingRunId(null);
      toast.success("Production run deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete production run");
    }
  };

  const openCreate = () => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: null, mode: "create" }); };
  const openView = (run: ProductionRunWithRelations) => { setSideSheet({ entity: run, mode: "view" }); };
  const openEdit = (run: ProductionRunWithRelations) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: run, mode: "edit" }); };
  const closeSideSheet = () => { setSideSheet(null); setCreateError(null); setUpdateError(null); };
  useOpenCreateIntent(openCreate);

  const clearFilters = () => { setSearchQuery(""); setStatusFilter(""); setCurrentPage(1); };
  const hasActiveFilters = searchQuery || statusFilter;

  const columns = createColumns(openEdit, handleDelete);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load production runs"} />
      </div>
    );
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <h1 className="title-heading-2">Production Runs</h1>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={20} weight="bold" />
          New Production Run
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        <StatCard title="Total Runs" value={statsData?.totalRuns ?? 0} icon={<Fire size={24} weight="bold" />} description="All production batches" isLoading={statsLoading} />
        <StatCard title="Biochar Output" value={`${((statsData?.totalBiocharKg ?? 0) / 1000).toFixed(1)} t`} icon={<Leaf size={24} weight="bold" />} description="Total biochar produced" isLoading={statsLoading} />
        <StatCard title="Running" value={statsData?.runningCount ?? 0} icon={<Clock size={24} weight="bold" />} description="Currently active runs" isLoading={statsLoading} />
        <StatCard title="Completed" value={statsData?.completedCount ?? 0} icon={<CheckCircle size={24} weight="bold" />} description="Finished production runs" isLoading={statsLoading} />
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
          <div className="flex flex-col items-center justify-center gap-24 py-48">
            <Fire size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">{hasActiveFilters ? "No production runs found" : "No production runs yet"}</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                {hasActiveFilters ? "Try adjusting your search or filters." : "Create your first production run to start tracking pyrolysis batches."}
              </p>
            </div>
            {!hasActiveFilters && (
              <Button variant="primary" onClick={openCreate}>
                <Plus size={20} weight="bold" />
                Create Production Run
              </Button>
            )}
          </div>
        }
      >
        <DataTable.Toolbar>
          <div className="relative max-w-[320px] flex-1">
            <MagnifyingGlass size={18} className="absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none" />
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
                <X size={16} weight="bold" />
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

      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
          title={sideSheet.mode === "create" ? "Create Production Run" : sideSheet.entity?.code ?? ""}
          subtitle={
            sideSheet.mode === "create"
              ? undefined
              : sideSheet.entity
                ? formatDateField(sideSheet.entity.date)
                : undefined
          }
          editLabel="Edit Production Run"
          size="wide"
          sections={sideSheet.entity ? [
            {
              title: "General",
              fields: [
                { label: "Code", value: sideSheet.entity.code },
                { label: "Date", value: formatDateField(sideSheet.entity.date) },
                { label: "Status", value: <StatusBadge status={sideSheet.entity.status} /> },
              ],
            },
            {
              title: "Location",
              fields: [
                { label: "Facility", value: sideSheet.entity.facilityName },
                { label: "Reactor", value: sideSheet.entity.reactorCode },
              ],
            },
            {
              title: "Operations",
              fields: [
                { label: "Operator", value: sideSheet.entity.operatorName },
                { label: "Feeding Rate", value: sideSheet.entity.feedingRateKgHr != null ? `${sideSheet.entity.feedingRateKgHr} kg/hr` : null },
                { label: "Residence Time", value: sideSheet.entity.residenceTimeMinutes != null ? `${sideSheet.entity.residenceTimeMinutes} min` : null },
              ],
            },
            {
              title: "Output",
              fields: [
                { label: "Total Feedstock Mass", value: sideSheet.entity.totalFeedstockMassKg != null ? `${sideSheet.entity.totalFeedstockMassKg.toLocaleString()} kg` : null },
                { label: "Biochar Output", value: sideSheet.entity.biocharOutputKg != null ? `${sideSheet.entity.biocharOutputKg.toLocaleString()} kg` : null },
              ],
            },
            {
              title: "Energy",
              fields: [
                { label: "Diesel Operation", value: sideSheet.entity.dieselOperationLiters != null ? `${sideSheet.entity.dieselOperationLiters} L` : null },
                { label: "Diesel Genset", value: sideSheet.entity.dieselGensetLiters != null ? `${sideSheet.entity.dieselGensetLiters} L` : null },
                { label: "Preprocessing Fuel", value: sideSheet.entity.preprocessingFuelLiters != null ? `${sideSheet.entity.preprocessingFuelLiters} L` : null },
                { label: "Electricity", value: sideSheet.entity.electricityKwh != null ? `${sideSheet.entity.electricityKwh} kWh` : null },
              ],
            },
            {
              title: "Storage",
              fields: [
                { label: "Biochar Storage", value: sideSheet.entity.biocharStorageLocationCode },
                { label: "Feedstock Storage", value: sideSheet.entity.feedstockStorageLocationCode },
              ],
            },
          ] : undefined}
        >
          {(createError || updateError) && <div className="mb-24"><ServerError message={createError || updateError || ""} /></div>}
          <ProductionRunForm
            key={sideSheet.entity?.id ?? "create"}
            productionRun={sideSheet.entity ?? undefined}
            onSubmit={sideSheet.entity && sideSheet.mode === "edit" ? handleUpdate : handleCreate}
            onCancel={closeSideSheet}
            isSubmitting={createRun.isPending || updateRun.isPending}
            submitLabel={sideSheet.entity && sideSheet.mode === "edit" ? "Save Changes" : "Create Production Run"}
          >
            {sideSheet.entity && sideSheet.mode === "edit" && (
              <>
                <ProductionSampleTable productionRunId={sideSheet.entity.id} />
                <ProductionIncidentTable
                  productionRunId={sideSheet.entity.id}
                  facilityId={sideSheet.entity.facilityId}
                  defaultReactorId={sideSheet.entity.reactorId}
                  defaultOperatorId={sideSheet.entity.operatorId}
                />
              </>
            )}
          </ProductionRunForm>
        </EntitySideSheet>
      )}
    </div>
  );
}
