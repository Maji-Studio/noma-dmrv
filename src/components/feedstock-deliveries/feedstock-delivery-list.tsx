/**
 * FeedstockDeliveryList component
 * Main feedstock delivery listing with CRUD operations
 * Includes DataTable with sorting, filtering, pagination
 */
"use client";

import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Calendar, Package, Gauge, Plus } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { ServerError } from "@/components/forms";
import { FeedstockDeliveryForm } from "./feedstock-delivery-form";
import {
  useCreateFeedstockDelivery,
  useDeleteFeedstockDelivery,
  useFeedstockDeliveries,
  useUpdateFeedstockDelivery,
} from "@/hooks/use-feedstock-deliveries";
import type { FeedstockDeliveryFormData } from "@/schemas/feedstock-deliveries";
import type { FeedstockDeliveryWithRelations } from "@/data-access/feedstock-deliveries";


// ============================================
// Helper Functions
// ============================================

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatWeight(weightKg: number | null): string {
  if (weightKg === null) return "—";
  if (weightKg >= 1000) {
    return `${(weightKg / 1000).toFixed(2)} t`;
  }
  return `${weightKg.toFixed(1)} kg`;
}

function formatMoisture(moisturePercent: number | null): string {
  if (moisturePercent === null) return "—";
  return `${moisturePercent.toFixed(1)}%`;
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (delivery: FeedstockDeliveryWithRelations) => void,
  onDelete: (deliveryId: string) => void,
): ColumnDef<FeedstockDeliveryWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>,
    },
    {
      accessorKey: "deliveryDate",
      header: "Delivery Date",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--color-text-tertiary)]" />
          <span>{formatDate(row.original.deliveryDate)}</span>
        </div>
      ),
    },
    {
      accessorKey: "supplierName",
      header: "Supplier",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.supplierName || "—"}</span>
          {row.original.supplierCode && (
            <span className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">{row.original.supplierCode}</span>
          )}
        </div>
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
      accessorKey: "weightKg",
      header: "Weight",
      cell: ({ row }) => <span className="font-mono">{formatWeight(row.original.weightKg)}</span>,
    },
    {
      accessorKey: "moisturePercent",
      header: "Moisture",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-[var(--color-text-tertiary)]" />
          <span className="font-mono">{formatMoisture(row.original.moisturePercent)}</span>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status === "complete" ? "complete" : "pending"}
          label={row.original.status === "complete" ? "Complete" : "Missing Data"}
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

export function FeedstockDeliveryList({ stats }: { stats?: React.ReactNode }) {
  // Side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: FeedstockDeliveryWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingDeliveryId, setDeletingDeliveryId] = useState<string | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Data fetching
  const { data: deliveriesData, isLoading } = useFeedstockDeliveries();
  const createDelivery = useCreateFeedstockDelivery();
  const updateDelivery = useUpdateFeedstockDelivery();
  const deleteDelivery = useDeleteFeedstockDelivery();

  // Handlers
  const handleCreate = async (data: FeedstockDeliveryFormData) => {
    setCreateError(null);
    try {
      await createDelivery.mutateAsync(data);
      setSideSheet(null);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create feedstock delivery");
    }
  };

  const handleUpdate = async (data: FeedstockDeliveryFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateDelivery.mutateAsync({
        deliveryId: sideSheet.entity.id,
        ...data,
      });
      setSideSheet(null);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Failed to update feedstock delivery");
    }
  };

  const handleDelete = (deliveryId: string) => {
    setDeletingDeliveryId(deliveryId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingDeliveryId) return;
    setDeleteError(null);
    try {
      await deleteDelivery.mutateAsync(deletingDeliveryId);
      setDeletingDeliveryId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete feedstock delivery");
    }
  };

  const openCreate = () => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: null, mode: "create" }); };
  const openView = (delivery: FeedstockDeliveryWithRelations) => { setSideSheet({ entity: delivery, mode: "view" }); };
  const openEdit = (delivery: FeedstockDeliveryWithRelations) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: delivery, mode: "edit" }); };
  const closeSideSheet = () => { setSideSheet(null); setCreateError(null); setUpdateError(null); };

  // Memoize columns
  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  const deliveries = deliveriesData?.items ?? [];

  return (
    <div className="flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <div>
          <h1 className="title-heading-2">Feedstock Deliveries</h1>
          <p className="body-small text-[var(--color-text-secondary)] mt-1">
            Track incoming biomass feedstock shipments
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={18} weight="bold" />
          New Delivery
        </Button>
      </div>

      {/* Stats */}
      {stats}

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={deliveries}
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
              <h3 className="title-heading-3 mb-1">No deliveries yet</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                Create your first feedstock delivery to get started
              </p>
            </div>
            <Button variant="primary" onClick={openCreate}>
              <Plus size={18} weight="bold" />
              New Delivery
            </Button>
          </div>
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search deliveries..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {/* Delete Error */}
      {deleteError && <ServerError message={deleteError} />}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingDeliveryId}
        title="Delete Feedstock Delivery"
        message="Are you sure you want to delete this feedstock delivery? This action cannot be undone. Note: Deliveries with associated feedstocks cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingDeliveryId(null);
          setDeleteError(null);
        }}
        isPending={deleteDelivery.isPending}
      />

      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
          title={sideSheet.mode === "create" ? "Create Feedstock Delivery" : sideSheet.entity?.code ?? ""}
          subtitle={
            sideSheet.mode === "create"
              ? "Add a new incoming biomass feedstock shipment"
              : sideSheet.entity
                ? [
                    sideSheet.entity.feedstockTypeName,
                    sideSheet.entity.weightKg !== null ? formatWeight(sideSheet.entity.weightKg) : null,
                  ].filter(Boolean).join(" \u00B7 ") || "Feedstock delivery"
                : undefined
          }
          editLabel="Edit Delivery"
          sections={sideSheet.entity ? [
            {
              title: "Delivery Information",
              fields: [
                { label: "Facility", value: sideSheet.entity.facilityName },
                { label: "Delivery Date", value: formatDate(sideSheet.entity.deliveryDate) },
                { label: "Supplier", value: sideSheet.entity.supplierName },
                { label: "Supplier Code", value: sideSheet.entity.supplierCode },
                { label: "Driver", value: sideSheet.entity.driverName },
                { label: "Vehicle", value: sideSheet.entity.vehicleName },
              ],
            },
            {
              title: "Feedstock Details",
              fields: [
                { label: "Feedstock Type", value: sideSheet.entity.feedstockTypeName },
                { label: "Weight", value: sideSheet.entity.weightKg !== null ? formatWeight(sideSheet.entity.weightKg) : null },
                { label: "Moisture", value: sideSheet.entity.moisturePercent !== null ? formatMoisture(sideSheet.entity.moisturePercent) : <StatusBadge status="pending" label="Missing" size="small" /> },
                { label: "Category", value: sideSheet.entity.feedstockTypeCategory ? <span className="capitalize">{sideSheet.entity.feedstockTypeCategory}</span> : null },
                { label: "Status", value: <StatusBadge status={sideSheet.entity.status === "complete" ? "complete" : "pending"} label={sideSheet.entity.status === "complete" ? "Complete" : "Missing Data"} /> },
              ],
            },
            ...(sideSheet.entity.notes ? [{
              title: "Notes",
              fields: [{ label: "Notes", value: sideSheet.entity.notes }],
            }] : []),
          ] : undefined}
        >
          {(createError || updateError) && <div className="mb-24"><ServerError message={createError || updateError || ""} /></div>}
          <FeedstockDeliveryForm
            key={sideSheet.entity?.id ?? "create"}
            delivery={sideSheet.entity ?? undefined}
            onSubmit={sideSheet.entity && sideSheet.mode === "edit" ? handleUpdate : handleCreate}
            onCancel={closeSideSheet}
            isSubmitting={createDelivery.isPending || updateDelivery.isPending}
            submitLabel={sideSheet.entity && sideSheet.mode === "edit" ? "Save Changes" : "Create Delivery"}
          />
        </EntitySideSheet>
      )}
    </div>
  );
}
