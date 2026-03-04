/**
 * FeedstockList component
 * Main feedstock listing with CRUD operations
 */
"use client";

import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Gauge, Plus, Package } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { ServerError } from "@/components/forms";
import { FeedstockForm } from "./feedstock-form";
import {
  useCreateFeedstock,
  useDeleteFeedstock,
  useFeedstocks,
  useUpdateFeedstock,
} from "@/hooks/use-feedstocks";
import type { FeedstockFormData } from "@/schemas/feedstocks";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";

// ============================================
// Helper Functions
// ============================================

function formatMass(massKg: number | null): string {
  if (massKg === null) return "—";
  if (massKg >= 1000) {
    return `${(massKg / 1000).toFixed(2)} t`;
  }
  return `${massKg.toFixed(1)} kg`;
}

function formatMoisture(moisturePercent: number | null): string {
  if (moisturePercent === null) return "—";
  return `${moisturePercent.toFixed(1)}%`;
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (feedstock: FeedstockWithRelations) => void,
  onDelete: (feedstockId: string) => void
): ColumnDef<FeedstockWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">
          {row.original.code}
        </span>
      ),
    },
    {
      accessorKey: "feedstockDeliveryCode",
      header: "Delivery",
      cell: ({ row }) => (
        <span>{row.original.feedstockDeliveryCode || "—"}</span>
      ),
    },
    {
      accessorKey: "feedstockTypeName",
      header: "Feedstock Type",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.feedstockTypeName || "—"}</span>
          {row.original.feedstockTypeCategory && (
            <span className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] capitalize">
              {row.original.feedstockTypeCategory}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "massDryKg",
      header: "Dry Mass",
      cell: ({ row }) => (
        <span className="font-mono">{formatMass(row.original.massDryKg)}</span>
      ),
    },
    {
      accessorKey: "moistureContentPercent",
      header: "Moisture",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-[var(--color-text-tertiary)]" />
          <span className="font-mono">
            {formatMoisture(row.original.moistureContentPercent)}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "storageLocationName",
      header: "Storage",
      cell: ({ row }) => (
        <span>{row.original.storageLocationName || "—"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status === "complete" ? "complete" : "pending"}
          label={
            row.original.status === "complete" ? "Complete" : "Missing Data"
          }
        />
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-16">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(row.original);
            }}
            className="h-[32px] px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row.original.id);
            }}
            className="h-[32px] px-12 border border-[var(--color-signal-red)] text-[var(--color-signal-red)] rounded-none hover:bg-[var(--color-signal-red)]/10 body-small"
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

export function FeedstockList({ stats }: { stats?: React.ReactNode }) {
  const [sideSheet, setSideSheet] = useState<{
    entity: FeedstockWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingFeedstockId, setDeletingFeedstockId] = useState<string | null>(null);

  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: feedstocksData, isLoading } = useFeedstocks();
  const createFeedstock = useCreateFeedstock();
  const updateFeedstock = useUpdateFeedstock();
  const deleteFeedstock = useDeleteFeedstock();

  const handleCreate = async (data: FeedstockFormData) => {
    setCreateError(null);
    try {
      await createFeedstock.mutateAsync(data);
      setSideSheet(null);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create feedstock"
      );
    }
  };

  const handleUpdate = async (data: FeedstockFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateFeedstock.mutateAsync({
        feedstockId: sideSheet.entity.id,
        ...data,
      });
      setSideSheet(null);
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "Failed to update feedstock"
      );
    }
  };

  const handleDelete = (feedstockId: string) => {
    setDeletingFeedstockId(feedstockId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingFeedstockId) return;
    setDeleteError(null);
    try {
      await deleteFeedstock.mutateAsync(deletingFeedstockId);
      setDeletingFeedstockId(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete feedstock"
      );
    }
  };

  const openCreate = () => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: null, mode: "create" });
  };
  const openView = (feedstock: FeedstockWithRelations) => {
    setSideSheet({ entity: feedstock, mode: "view" });
  };
  const openEdit = (feedstock: FeedstockWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: feedstock, mode: "edit" });
  };
  const closeSideSheet = () => {
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
  };

  const columns = useMemo(
    () => createColumns(openEdit, handleDelete),
    [openEdit, handleDelete]
  );

  const feedstockItems = feedstocksData?.items ?? [];

  return (
    <div className="flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <div>
          <h1 className="title-heading-2">Feedstocks</h1>
          <p className="body-small text-[var(--color-text-secondary)] mt-1">
            Track individual biomass batches linked to deliveries
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={18} weight="bold" />
          New Feedstock
        </Button>
      </div>

      {/* Stats */}
      {stats}

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={feedstockItems}
        enableSorting
        enableFiltering
        enablePagination
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <div className="flex flex-col items-center justify-center gap-24 py-48">
            <Package size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">No feedstocks yet</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                Create your first feedstock record to get started
              </p>
            </div>
            <Button variant="primary" onClick={openCreate}>
              <Plus size={18} weight="bold" />
              New Feedstock
            </Button>
          </div>
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search feedstocks..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {/* Delete Error */}
      {deleteError && <ServerError message={deleteError} />}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingFeedstockId}
        title="Delete Feedstock"
        message="Are you sure you want to delete this feedstock? This action cannot be undone. Note: Feedstocks used in production runs cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingFeedstockId(null);
          setDeleteError(null);
        }}
        isPending={deleteFeedstock.isPending}
      />

      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) =>
            setSideSheet((prev) => (prev ? { ...prev, mode } : null))
          }
          title={
            sideSheet.mode === "create"
              ? "Create Feedstock"
              : sideSheet.entity?.code ?? ""
          }
          subtitle={
            sideSheet.mode === "create"
              ? "Add a new biomass feedstock batch"
              : sideSheet.entity
                ? [
                    sideSheet.entity.feedstockTypeName,
                    formatMass(sideSheet.entity.massDryKg),
                  ]
                    .filter(Boolean)
                    .join(" \u00B7 ") || "Feedstock"
                : undefined
          }
          editLabel="Edit Feedstock"
          sections={
            sideSheet.entity
              ? [
                  {
                    title: "Reference",
                    fields: [
                      { label: "Facility", value: sideSheet.entity.facilityName },
                      { label: "Delivery", value: sideSheet.entity.feedstockDeliveryCode },
                      { label: "Feedstock Type", value: sideSheet.entity.feedstockTypeName },
                      {
                        label: "Category",
                        value: sideSheet.entity.feedstockTypeCategory ? (
                          <span className="capitalize">
                            {sideSheet.entity.feedstockTypeCategory}
                          </span>
                        ) : null,
                      },
                    ],
                  },
                  {
                    title: "Mass & Moisture",
                    fields: [
                      { label: "Dry Mass", value: formatMass(sideSheet.entity.massDryKg) },
                      {
                        label: "Wet Mass",
                        value: sideSheet.entity.massWetKg !== null
                          ? formatMass(sideSheet.entity.massWetKg)
                          : null,
                      },
                      {
                        label: "Moisture",
                        value: sideSheet.entity.moistureContentPercent !== null
                          ? formatMoisture(sideSheet.entity.moistureContentPercent)
                          : (
                            <StatusBadge
                              status="pending"
                              label="Missing"
                              size="small"
                            />
                          ),
                      },
                    ],
                  },
                  {
                    title: "Storage",
                    fields: [
                      { label: "Storage Location", value: sideSheet.entity.storageLocationName },
                      { label: "Source Region", value: sideSheet.entity.feedstockSourceRegion },
                    ],
                  },
                  {
                    title: "Status",
                    fields: [
                      {
                        label: "Status",
                        value: (
                          <StatusBadge
                            status={sideSheet.entity.status === "complete" ? "complete" : "pending"}
                            label={sideSheet.entity.status === "complete" ? "Complete" : "Missing Data"}
                          />
                        ),
                      },
                    ],
                  },
                  ...(sideSheet.entity.notes
                    ? [
                        {
                          title: "Notes",
                          fields: [
                            { label: "Notes", value: sideSheet.entity.notes },
                          ],
                        },
                      ]
                    : []),
                ]
              : undefined
          }
        >
          {(createError || updateError) && (
            <div className="mb-24">
              <ServerError message={createError || updateError || ""} />
            </div>
          )}
          <FeedstockForm
            key={sideSheet.entity?.id ?? "create"}
            feedstock={sideSheet.entity ?? undefined}
            onSubmit={
              sideSheet.entity && sideSheet.mode === "edit"
                ? handleUpdate
                : handleCreate
            }
            onCancel={closeSideSheet}
            isSubmitting={createFeedstock.isPending || updateFeedstock.isPending}
            submitLabel={
              sideSheet.entity && sideSheet.mode === "edit"
                ? "Save Changes"
                : "Create Feedstock"
            }
          />
        </EntitySideSheet>
      )}
    </div>
  );
}
