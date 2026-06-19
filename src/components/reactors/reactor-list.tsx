/**
 * ReactorList component
 * Main reactor listing with CRUD operations using DataTable
 * Includes stat cards, Method B eligibility, and unified EntitySideSheet
 */
"use client";

import { useState } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import type { ColumnDef } from "@tanstack/react-table";
import { Lightning, Flask, Plus, CheckCircle, Warning } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { InfoHint } from "@/components/ui/tooltip";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { ReactorForm } from "./reactor-form";
import {
  useCreateReactor,
  useDeleteReactor,
  useReactors,
  useUpdateReactor,
} from "@/hooks/use-reactors";
import {
  formatReactorType,
  formatSamplingMethod,
  type CreateReactorData,
  type SamplingMethod,
} from "@/schemas/reactors";
import type { ReactorWithRelations } from "@/data-access/reactors";
import type { SamplingRequirement } from "@/lib/certification/sampling-requirements";
import type { Reactor } from "@/db/schema";

// ============================================
// Sampling Cadence Badge (decision D6)
// ============================================

/**
 * Compact verdict for a reactor's CURRENT-method sampling cadence — how many of
 * its runs are sampled against the method's requirement, plus the ≥3-replicate
 * rule. Green only when the cadence is met AND no sampled run is under-
 * replicated (the same two conditions the submission gate enforces); amber
 * otherwise. A reactor with no runs has nothing to sample yet (neutral).
 */
function SamplingCadenceBadge({
  requirement,
}: {
  requirement: SamplingRequirement;
}) {
  const { totalRuns, sampledRuns, requiredSampledRuns, underReplicatedRunIds } =
    requirement;

  if (totalRuns === 0) {
    return (
      <StatusBadge status="draft" label="No runs" size="small" />
    );
  }

  const underReplicated = underReplicatedRunIds.length;
  const ok = requirement.met && underReplicated === 0;
  const countLabel = `${sampledRuns}/${requiredSampledRuns}`;

  const detail =
    requirement.method === "method_a"
      ? `Method A samples every run: ${sampledRuns} of ${totalRuns} sampled.`
      : `Method B samples ≥1 per 10 runs: ${sampledRuns} of ${requiredSampledRuns} required (${totalRuns} runs).`;
  const replicateNote =
    underReplicated > 0
      ? ` ${underReplicated} sampled run(s) carry <3 replicates — submission requires ≥3.`
      : "";

  return (
    <span className="inline-flex items-center gap-6">
      <StatusBadge
        status={ok ? "ready" : "pending"}
        label={countLabel}
        size="small"
        icon={
          ok ? (
            <CheckCircle size={14} weight="fill" />
          ) : (
            <Warning size={14} weight="fill" />
          )
        }
      />
      <InfoHint side="top" size={13}>
        {detail}
        {replicateNote}
      </InfoHint>
    </span>
  );
}

// ============================================
// Method B Eligibility Badge
// ============================================

function MethodBEligibilityBadge({
  isEligible,
  sampleCount,
  minimumRequired,
}: {
  isEligible: boolean;
  sampleCount: number;
  minimumRequired: number;
}) {
  if (isEligible) {
    return (
      <StatusBadge
        status="ready"
        label={`Eligible (${sampleCount})`}
        icon={<CheckCircle size={14} weight="fill" />}
      />
    );
  }

  return (
    <StatusBadge
      status="pending"
      label={`${sampleCount}/${minimumRequired}`}
      icon={<Warning size={14} weight="fill" />}
    />
  );
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (reactor: ReactorWithRelations) => void,
  onDelete: (reactorId: string) => void,
): ColumnDef<ReactorWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "identifier",
      header: "Identifier",
      cell: ({ row }) => <span>{row.original.identifier}</span>,
    },
    {
      accessorKey: "facilityName",
      header: "Facility",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.facilityName || "—"}</span>
          {row.original.facilityCode && (
            <span className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
              {row.original.facilityCode}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "reactorType",
      header: "Type",
      cell: ({ row }) => <span>{formatReactorType(row.original.reactorType)}</span>,
    },
    {
      accessorKey: "samplingMethod",
      header: "Sampling Method",
      cell: ({ row }) => (
        <span className={row.original.samplingMethod === "method_b" ? "text-[var(--color-signal-green)]" : ""}>
          {formatSamplingMethod(row.original.samplingMethod as SamplingMethod)}
        </span>
      ),
    },
    {
      id: "methodBStatus",
      header: "Method B Status",
      cell: ({ row }) => (
        <MethodBEligibilityBadge
          isEligible={row.original.methodBEligibility?.isEligible ?? false}
          sampleCount={row.original.methodBEligibility?.priorMethodASampleCount ?? 0}
          minimumRequired={row.original.methodBEligibility?.minimumMethodASampleCount ?? 30}
        />
      ),
      enableSorting: false,
    },
    {
      id: "samplingCadence",
      header: () => (
        <span className="inline-flex items-center gap-4">
          Sampling Cadence
          <InfoHint side="top" size={13}>
            Sampled runs vs. the current method&apos;s requirement (Method A:
            every run; Method B: ≥1 per 10). Green only when the cadence is met
            and every sampled run carries ≥3 replicates.
          </InfoHint>
        </span>
      ),
      cell: ({ row }) => (
        <SamplingCadenceBadge requirement={row.original.samplingRequirement} />
      ),
      enableSorting: false,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <RowActionsMenu
            label={`Actions for ${row.original.code}`}
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
// Component
// ============================================

export function ReactorList() {
  const { facilityId: contextFacilityId } = useFacilityContext();

  // Unified side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: ReactorWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingReactorId, setDeletingReactorId] = useState<string | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Server-side search: debounce the search input before querying
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 250);
  const filters = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(contextFacilityId ? { facilityId: contextFacilityId } : {}),
    pageSize: 100,
  };

  // Data fetching — pass search filter so the server does the filtering
  const { data: reactorsData, isLoading, error: fetchError } = useReactors(
    filters,
    { enabled: !!contextFacilityId },
  );
  const createReactor = useCreateReactor();
  const updateReactor = useUpdateReactor();
  const deleteReactor = useDeleteReactor();
  const toast = useToast();

  // Side sheet helpers
  const openCreate = () => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: null, mode: "create" });
  };
  const openView = (reactor: ReactorWithRelations) => {
    setSideSheet({ entity: reactor, mode: "view" });
  };
  const openEdit = (reactor: ReactorWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: reactor, mode: "edit" });
  };
  const closeSideSheet = () => {
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
  };
  useOpenCreateIntent(openCreate);

  // Handlers
  const handleCreate = async (data: CreateReactorData) => {
    setCreateError(null);
    try {
      await createReactor.mutateAsync(data);
      setSideSheet(null);
      toast.success("Reactor created successfully");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create reactor");
    }
  };

  const handleUpdate = async (data: CreateReactorData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateReactor.mutateAsync({ reactorId: sideSheet.entity.id, ...data });
      setSideSheet(null);
      toast.success("Reactor updated successfully");
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Failed to update reactor");
    }
  };

  const handleDelete = (reactorId: string) => {
    setDeletingReactorId(reactorId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingReactorId) return;
    setDeleteError(null);
    try {
      await deleteReactor.mutateAsync(deletingReactorId);
      setDeletingReactorId(null);
      toast.success("Reactor deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete reactor");
    }
  };

  const columns = createColumns(openEdit, handleDelete);

  const reactors = reactorsData?.items ?? [];
  const totalReactors = reactorsData?.total ?? 0;
  const methodBEligibleCount = reactors.filter((r) => r.methodBEligibility?.isEligible).length;
  const totalThroughputTph = reactors.reduce((sum, r) => sum + (r.nominalThroughputTph || 0), 0);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load reactors"} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Reactor" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create" ? undefined : sideSheetEntity?.identifier;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="infrastructure"
        title="Reactors"
        subtitle="Pyrolysis equipment and sampling configuration"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus size={18} weight="bold" />
            New Reactor
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Reactors"
          value={totalReactors}
          icon={<Lightning size={24} weight="bold" />}
          description="Pyrolysis equipment units"
          isLoading={isLoading}
        />
        <StatCard
          title="Method B Eligible"
          value={methodBEligibleCount}
          icon={<CheckCircle size={24} weight="bold" />}
          description="Eligible reactors on this page"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Throughput"
          value={`${totalThroughputTph.toLocaleString()} tph`}
          icon={<Flask size={24} weight="bold" />}
          description="Combined nominal throughput on this page"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={reactors}
        onRowClick={openView}
        enableSorting
        enablePagination
        globalFilter={searchInput}
        onGlobalFilterChange={setSearchInput}
        isLoading={isLoading}
        hoverable
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<Lightning size={48} />}
            title={contextFacilityId ? "No reactors yet" : "Select a facility"}
            description={
              contextFacilityId
                ? "Create your first reactor to get started"
                : "Choose a facility from the sidebar to view reactors"
            }
            action={
              contextFacilityId ? (
                <Button variant="primary" onClick={openCreate}>
                  <Plus size={18} weight="bold" />
                  New Reactor
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search reactors..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {/* Delete Error */}
      {deleteError && <ServerError message={deleteError} />}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingReactorId}
        title="Delete Reactor"
        message="Are you sure you want to delete this reactor? This action cannot be undone. Note: Reactors with associated production runs cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingReactorId(null);
          setDeleteError(null);
        }}
        isPending={deleteReactor.isPending}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Reactor"
        sections={sideSheetEntity ? [
          {
            title: "General Information",
            fields: [
              { label: "Code", value: sideSheetEntity.code },
              { label: "Identifier", value: sideSheetEntity.identifier },
              { label: "Reactor Type", value: formatReactorType(sideSheetEntity.reactorType) },
              { label: "Sampling Method", value: formatSamplingMethod(sideSheetEntity.samplingMethod as SamplingMethod) },
            ],
          },
          {
            title: "Facility",
            fields: [
              { label: "Facility Name", value: sideSheetEntity.facilityName },
              { label: "Facility Code", value: sideSheetEntity.facilityCode },
            ],
          },
          {
            title: "Method B Eligibility",
            fields: [
              { label: "Status", value: sideSheetEntity.methodBEligibility?.isEligible ? "Eligible" : "Not Eligible" },
              { label: "Prior Method A Samples", value: (sideSheetEntity.methodBEligibility?.priorMethodASampleCount ?? 0) + " samples" },
              { label: "Minimum Required", value: (sideSheetEntity.methodBEligibility?.minimumMethodASampleCount ?? 30) + " samples" },
            ],
          },
          {
            title: "Sampling Cadence",
            fields: [
              {
                label: "Status",
                value:
                  sideSheetEntity.samplingRequirement.totalRuns === 0
                    ? "No production runs yet"
                    : sideSheetEntity.samplingRequirement.met &&
                        sideSheetEntity.samplingRequirement.underReplicatedRunIds
                          .length === 0
                      ? "Met"
                      : "Action needed",
              },
              {
                label: "Sampled Runs",
                value: `${sideSheetEntity.samplingRequirement.sampledRuns} / ${sideSheetEntity.samplingRequirement.requiredSampledRuns} required`,
              },
              {
                label: "Total Runs",
                value: `${sideSheetEntity.samplingRequirement.totalRuns}`,
              },
              {
                label: "Under-replicated Runs",
                value: `${sideSheetEntity.samplingRequirement.underReplicatedRunIds.length} (need ≥3 replicates each)`,
              },
            ],
          },
        ] : undefined}
      >
        {(createError || updateError) && (
          <div className="mb-24">
            <ServerError message={createError || updateError || ""} />
          </div>
        )}
        <ReactorForm
          key={sideSheetEntity?.id ?? "create"}
          reactor={sideSheetEntity as Reactor | undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createReactor.isPending || updateReactor.isPending}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save Changes" : "Create Reactor"}
        />
      </EntitySideSheet>
    </div>
  );
}
