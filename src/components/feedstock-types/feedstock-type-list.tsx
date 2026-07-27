"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArchiveIcon,
  DatabaseIcon,
  LeafIcon,
  PlusIcon,
  SealCheckIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { FeedstockType } from "@/db/schema";
import { ServerError } from "@/components/forms";
import { DataTable } from "@/components/ui/data-table";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import {
  Button,
  EmptyState,
  PageHeader,
  RowActionsMenu,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import {
  useArchiveFeedstockType,
  useCreateFeedstockType,
  useDeleteFeedstockType,
  useFeedstockTypeList,
  useUnarchiveFeedstockType,
  useUpdateFeedstockType,
} from "@/hooks/use-feedstock-types";
import type { FeedstockTypeFormData } from "@/schemas/feedstock-types";
import { FeedstockTypeForm } from "./feedstock-type-form";
import { FeedstockTypeSampling } from "./feedstock-type-sampling";

type ArchiveFilter = "all" | "active" | "archived";

interface FeedstockTypeListProps {
  canManage: boolean;
}

interface SideSheetState {
  entity: FeedstockType | null;
  mode: SideSheetMode;
}

function titleCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function shouldShowFeedstockTypeSampling(params: {
  feedstockType: FeedstockType | null;
  hasRegistryConnection: boolean;
  facilityId: string | null;
}) {
  return Boolean(
    params.feedstockType?.usage === "pyrolysis" &&
      params.hasRegistryConnection &&
      params.facilityId,
  );
}

function MutedValue({ archived, children }: { archived: boolean; children: React.ReactNode }) {
  return (
    <span
      className={archived ? "opacity-50" : undefined}
      data-archived={archived ? "true" : undefined}
    >
      {children}
    </span>
  );
}

export function IsometricLinkedBadge() {
  return (
    <span className="inline-flex items-center gap-4 rounded-full border border-[var(--st-ok-border)] bg-[var(--st-ok-bg)] px-8 py-2 body-caption text-[var(--st-ok)]">
      <SealCheckIcon size={14} weight="fill" aria-hidden />
      Isometric
    </span>
  );
}

export function FeedstockDeleteConflictNotice({
  name,
  onArchive,
  isPending,
}: {
  name: string;
  onArchive: () => void;
  isPending: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-12 border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] p-16 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-2">
        <p className="body-medium font-medium text-[var(--color-text-primary)]">
          {name} is in use and cannot be deleted.
        </p>
        <p className="body-small text-[var(--color-text-secondary)]">
          Archive it instead. Historical records keep the type, while active pickers hide it.
        </p>
      </div>
      <Button variant="default" onClick={onArchive} busy={isPending}>
        <ArchiveIcon size={16} weight="bold" />
        Archive instead
      </Button>
    </div>
  );
}

function createColumns(params: {
  canManage: boolean;
  onEdit: (feedstockType: FeedstockType) => void;
  onArchive: (feedstockType: FeedstockType) => void;
  onUnarchive: (feedstockType: FeedstockType) => void;
  onDelete: (feedstockType: FeedstockType) => void;
}): ColumnDef<FeedstockType>[] {
  const { canManage, onEdit, onArchive, onUnarchive, onDelete } = params;
  const columns: ColumnDef<FeedstockType>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <MutedValue archived={!!row.original.archivedAt}>
          <span className="font-medium text-[var(--color-text-primary)]">
            {row.original.name}
          </span>
        </MutedValue>
      ),
    },
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <MutedValue archived={!!row.original.archivedAt}>
          <span className="font-mono">{row.original.code}</span>
        </MutedValue>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => (
        <MutedValue archived={!!row.original.archivedAt}>
          {titleCase(row.original.category)}
        </MutedValue>
      ),
    },
    {
      accessorKey: "usage",
      header: "Usage",
      cell: ({ row }) => (
        <MutedValue archived={!!row.original.archivedAt}>
          {row.original.usage === "blend" ? "Blend" : "Pyrolysis"}
        </MutedValue>
      ),
    },
    {
      id: "isometric",
      header: "Registry",
      accessorFn: (row) => row.isometricFeedstockTypeId ?? "",
      cell: ({ row }) => (
        <MutedValue archived={!!row.original.archivedAt}>
          {row.original.isometricFeedstockTypeId ? <IsometricLinkedBadge /> : "—"}
        </MutedValue>
      ),
    },
    {
      id: "archiveState",
      header: "State",
      accessorFn: (row) => (row.archivedAt ? "Archived" : "Active"),
      cell: ({ row }) =>
        row.original.archivedAt ? (
          <span className="body-caption text-[var(--color-text-tertiary)]">Archived</span>
        ) : (
          <span className="body-caption text-[var(--color-text-secondary)]">Active</span>
        ),
    },
  ];

  if (canManage) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RowActionsMenu
            label={`Actions for ${row.original.code}`}
            actions={[
              { label: "Edit", onSelect: () => onEdit(row.original) },
              row.original.archivedAt
                ? { label: "Unarchive", onSelect: () => onUnarchive(row.original) }
                : { label: "Archive", onSelect: () => onArchive(row.original) },
              {
                label: "Delete",
                destructive: true,
                onSelect: () => onDelete(row.original),
              },
            ]}
          />
        </div>
      ),
      enableSorting: false,
    });
  }

  return columns;
}

export function FeedstockTypeList({ canManage }: FeedstockTypeListProps) {
  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all");
  const [deletingType, setDeletingType] = useState<FeedstockType | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<FeedstockType | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { facilityId } = useFacilityContext();
  const certifierSummary = useFacilityCertifierSummary(
    facilityId ?? "",
    !!facilityId,
  );
  const hasRegistryConnection = Boolean(certifierSummary.data?.mapping);
  const feedstockTypesQuery = useFeedstockTypeList();
  const createFeedstockType = useCreateFeedstockType();
  const updateFeedstockType = useUpdateFeedstockType();
  const archiveFeedstockType = useArchiveFeedstockType();
  const unarchiveFeedstockType = useUnarchiveFeedstockType();
  const deleteFeedstockType = useDeleteFeedstockType();
  const toast = useToast();

  const feedstockTypes = feedstockTypesQuery.data ?? [];
  const filteredFeedstockTypes = feedstockTypes.filter((feedstockType) => {
    if (archiveFilter === "active" && feedstockType.archivedAt) return false;
    if (archiveFilter === "archived" && !feedstockType.archivedAt) return false;
    return true;
  });
  const pyrolysisCount = feedstockTypes.filter((type) => type.usage === "pyrolysis").length;
  const archivedCount = feedstockTypes.filter((type) => !!type.archivedAt).length;
  const hasActiveFilters = Boolean(searchQuery) || archiveFilter !== "all";
  const clearFilters = () => {
    setSearchQuery("");
    setArchiveFilter("all");
  };

  const openCreate = () => {
    if (!canManage) return;
    setFormError(null);
    setSideSheet({ entity: null, mode: "create" });
  };
  useOpenCreateIntent(openCreate);

  const openView = (entity: FeedstockType) => {
    setFormError(null);
    setSideSheet({ entity, mode: "view" });
  };
  const openEdit = (entity: FeedstockType) => {
    if (!canManage) return;
    setFormError(null);
    setSideSheet({ entity, mode: "edit" });
  };
  const closeSideSheet = () => {
    setSideSheet(null);
    setFormError(null);
  };

  const handleCreate = async (data: FeedstockTypeFormData) => {
    setFormError(null);
    try {
      await createFeedstockType.mutateAsync(data);
      setSideSheet(null);
      toast.success("Feedstock type created successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to create feedstock type");
    }
  };

  const handleUpdate = async (data: FeedstockTypeFormData) => {
    if (!sideSheet?.entity) return;
    setFormError(null);
    try {
      await updateFeedstockType.mutateAsync({
        feedstockTypeId: sideSheet.entity.id,
        ...data,
      });
      setSideSheet(null);
      toast.success("Feedstock type updated successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to update feedstock type");
    }
  };

  const handleArchive = async (entity: FeedstockType) => {
    try {
      await archiveFeedstockType.mutateAsync(entity.id);
      setDeleteConflict(null);
      toast.success("Feedstock type archived");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to archive feedstock type");
    }
  };

  const handleUnarchive = async (entity: FeedstockType) => {
    try {
      await unarchiveFeedstockType.mutateAsync(entity.id);
      toast.success("Feedstock type unarchived");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to unarchive feedstock type");
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingType) return;
    try {
      await deleteFeedstockType.mutateAsync(deletingType.id);
      toast.success("Feedstock type deleted successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete feedstock type";
      if (message.toLowerCase().includes("archive it instead")) {
        setDeleteConflict(deletingType);
      } else {
        toast.error(message);
      }
    } finally {
      setDeletingType(null);
    }
  };

  const columns = createColumns({
    canManage,
    onEdit: openEdit,
    onArchive: handleArchive,
    onUnarchive: handleUnarchive,
    onDelete: setDeletingType,
  });

  if (feedstockTypesQuery.error) {
    return (
      <div className="container-max py-32">
        <ServerError message={feedstockTypesQuery.error.message} />
      </div>
    );
  }

  const sideSheetEntity = sideSheet?.entity ?? null;
  const showSampling = shouldShowFeedstockTypeSampling({
    feedstockType: sideSheetEntity,
    hasRegistryConnection,
    facilityId,
  });
  const detailSections = sideSheetEntity
    ? [
        {
          title: "Catalogue",
          fields: [
            { label: "Name", value: sideSheetEntity.name },
            { label: "Code", value: sideSheetEntity.code },
            { label: "Category", value: titleCase(sideSheetEntity.category) },
            { label: "Usage", value: sideSheetEntity.usage === "blend" ? "Blend" : "Pyrolysis" },
            { label: "State", value: sideSheetEntity.archivedAt ? "Archived" : "Active" },
            {
              label: "Isometric feedstock ID",
              value: sideSheetEntity.isometricFeedstockTypeId,
            },
            { label: "Registry URL", value: sideSheetEntity.registryUrl },
            { label: "Description", value: sideSheetEntity.description },
          ],
        },
        ...(showSampling && facilityId
          ? [
              {
                title: "Sampling",
                fields: [],
                content: (
                  <FeedstockTypeSampling
                    facilityId={facilityId}
                    feedstockTypeId={sideSheetEntity.id}
                    canManage={canManage}
                  />
                ),
              },
            ]
          : []),
      ]
    : undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="infrastructure"
        title="Feedstock Types"
        subtitle="Organization-wide catalogue for pyrolysis feedstocks and blend materials"
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-12">
              <Button variant="primary" onClick={openCreate}>
                <PlusIcon size={18} weight="bold" />
                New Feedstock Type
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-24 md:grid-cols-3">
        <StatCard
          title="Total Types"
          value={feedstockTypes.length}
          icon={<DatabaseIcon size={24} weight="bold" />}
          description="Pyrolysis and blend catalogue entries"
          isLoading={feedstockTypesQuery.isLoading}
        />
        <StatCard
          title="Pyrolysis Types"
          value={pyrolysisCount}
          icon={<LeafIcon size={24} weight="bold" />}
          description="Eligible for production feedstock selection"
          isLoading={feedstockTypesQuery.isLoading}
        />
        <StatCard
          title="Archived"
          value={archivedCount}
          icon={<ArchiveIcon size={24} weight="bold" />}
          description="Hidden from active entity pickers"
          isLoading={feedstockTypesQuery.isLoading}
        />
      </div>

      {deleteConflict && (
        <FeedstockDeleteConflictNotice
          name={deleteConflict.name}
          onArchive={() => handleArchive(deleteConflict)}
          isPending={archiveFeedstockType.isPending}
        />
      )}

      <DataTable
        columns={columns}
        data={filteredFeedstockTypes}
        onRowClick={openView}
        enableSorting
        enableFiltering
        enablePagination
        globalFilter={searchQuery}
        onGlobalFilterChange={setSearchQuery}
        aria-label="Feedstock types"
        isLoading={feedstockTypesQuery.isLoading}
        hoverable
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<LeafIcon size={48} />}
            title={hasActiveFilters ? "No matching feedstock types" : "No feedstock types yet"}
            description={
              hasActiveFilters
                ? "Try adjusting the search or archive-state filter."
                : "Create the first catalogue entry for feedstock and blend workflows."
            }
            action={
              canManage && !hasActiveFilters ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={18} weight="bold" />
                  Create your first feedstock type
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search
            placeholder="Search feedstock types..."
            aria-label="Search feedstock types"
          />
          <DataTable.Controls>
            <DataTable.FilterSelect
              aria-label="Filter feedstock types by archive state"
              value={archiveFilter}
              onChange={(event) => setArchiveFilter(event.target.value as ArchiveFilter)}
            >
              <option value="all">All states</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
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

      <DeleteConfirmDialog
        isOpen={!!deletingType}
        title="Delete Feedstock Type"
        message="Delete this feedstock type permanently? Types referenced by operational records cannot be deleted and should be archived instead."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingType(null)}
        isPending={deleteFeedstockType.isPending}
      />

      <EntitySideSheet
        open={!!sideSheet}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheet?.mode ?? "create"}
        onModeChange={(mode) =>
          setSideSheet((current) =>
            current ? { ...current, mode, entity: current.entity } : null,
          )
        }
        title={sideSheet?.mode === "create" ? "Create Feedstock Type" : sideSheetEntity?.code ?? ""}
        subtitle={sideSheet?.mode === "create" ? undefined : sideSheetEntity?.name}
        sections={sideSheet?.mode === "view" ? detailSections : undefined}
        editLabel="Edit Feedstock Type"
        canEdit={canManage}
      >
        <FeedstockTypeForm
          key={sideSheetEntity?.id ?? "create"}
          feedstockType={sideSheet?.mode === "edit" ? sideSheetEntity ?? undefined : undefined}
          onSubmit={sideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createFeedstockType.isPending || updateFeedstockType.isPending}
          errorMessage={formError ?? undefined}
          submitLabel={sideSheet?.mode === "edit" ? "Save Changes" : "Create Feedstock Type"}
        />
      </EntitySideSheet>
    </div>
  );
}
