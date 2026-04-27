/**
 * FeedstockList component
 * Main feedstock listing with CRUD operations via EntitySideSheet.
 */
"use client";

import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Calendar, Package, Plus } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { formatSafeDate, formatMass } from "@/lib/format-utils";
import { FeedstockForm } from "./feedstock-form";
import {
  useFeedstocks,
  useCreateFeedstock,
  useUpdateFeedstock,
  useDeleteFeedstock,
} from "@/hooks/use-feedstocks";
import type { FeedstockFormData } from "@/schemas/feedstocks";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (feedstock: FeedstockWithRelations) => void,
  onDelete: (id: string) => void,
): ColumnDef<FeedstockWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "deliveryDate",
      header: "Delivery Date",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--color-text-tertiary)]" />
          <span>{formatSafeDate(row.original.deliveryDate)}</span>
        </div>
      ),
    },
    {
      accessorKey: "supplierName",
      header: "Supplier",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.supplierName || "\u2014"}</span>
          {row.original.supplierCode && (
            <span className="body-small text-[var(--color-text-tertiary)]">
              {row.original.supplierCode}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "feedstockTypeName",
      header: "Feedstock Type",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.feedstockTypeName || "\u2014"}</span>
          {row.original.feedstockTypeCategory && (
            <span className="body-small text-[var(--color-text-tertiary)] capitalize">
              {row.original.feedstockTypeCategory}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "massWetKg",
      header: "Wet Mass",
      cell: ({ row }) => (
        <span className="font-mono">{formatMass(row.original.massWetKg)}</span>
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
      accessorKey: "storageLocationName",
      header: "Storage Bin",
      cell: ({ row }) => (
        <span>{row.original.storageLocationCode ?? row.original.storageLocationName ?? "\u2014"}</span>
      ),
    },
    {
      accessorKey: "moistureContentPercent",
      header: "Moisture",
      cell: ({ row }) => (
        <span className="font-mono">
          {row.original.moistureContentPercent !== null
            ? `${row.original.moistureContentPercent}%`
            : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-16">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(row.original); }}
            className="h-[32px] px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(row.original.id); }}
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
  const { facilityId: contextFacilityId } = useFacilityContext();

  // Side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: FeedstockWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Data
  const { data: feedstocksData, isLoading, error: fetchError } = useFeedstocks(
    contextFacilityId ? { facilityId: contextFacilityId } : undefined,
    { enabled: !!contextFacilityId },
  );
  const createFeedstock = useCreateFeedstock();
  const updateFeedstock = useUpdateFeedstock();
  const deleteFeedstock = useDeleteFeedstock();
  const toast = useToast();

  // Handlers
  const handleCreate = async (data: FeedstockFormData) => {
    setCreateError(null);
    try {
      const result = await createFeedstock.mutateAsync(data);
      setSideSheet(null);
      const count = result.feedstocks.length;
      const msg = result.warning
        ? `Feedstock created (${count} record${count > 1 ? "s" : ""}). Warning: ${result.warning}`
        : `Feedstock created successfully (${count} record${count > 1 ? "s" : ""})`;
      toast.success(msg);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create feedstock");
    }
  };

  const handleUpdate = async (data: FeedstockFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateFeedstock.mutateAsync({
        feedstockId: sideSheet.entity.id,
        facilityId: data.facilityId,
        deliveryDate: data.deliveryDate,
        supplierId: data.supplierId,
        vehicleId: data.vehicleId || null,
        gpsLatitude: data.gpsLatitude,
        gpsLongitude: data.gpsLongitude,
        feedstockTypeId: data.feedstockTypeId,
        massWetKg: data.allocations[0]?.allocatedWetMassKg ?? data.totalWetMassKg,
        moistureContentPercent: data.moisturePercent,
        massDryKg: deriveMassDryKg(
          data.allocations[0]?.allocatedWetMassKg ?? data.totalWetMassKg,
          data.moisturePercent
        ),
        storageLocationId: data.allocations[0]?.storageLocationId || null,
        overrideJustification: data.overrideJustification || null,
        notes: data.notes || null,
      });
      setSideSheet(null);
      toast.success("Feedstock updated successfully");
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Failed to update feedstock");
    }
  };

  const handleDelete = (id: string) => setDeletingId(id);

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteError(null);
    try {
      await deleteFeedstock.mutateAsync(deletingId);
      setDeletingId(null);
      toast.success("Feedstock deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete feedstock");
    }
  };

  const openCreate = () => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: null, mode: "create" }); };
  const openView = (feedstock: FeedstockWithRelations) => setSideSheet({ entity: feedstock, mode: "view" });
  const openEdit = (feedstock: FeedstockWithRelations) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: feedstock, mode: "edit" }); };
  const closeSideSheet = () => { setSideSheet(null); setCreateError(null); setUpdateError(null); };
  useOpenCreateIntent(openCreate);

  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  const feedstockItems = feedstocksData?.items ?? [];

  if (fetchError) {
    return (
      <div className="flex flex-col gap-32">
        <ServerError message={fetchError.message || "Failed to load feedstocks"} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <div>
          <h1 className="title-heading-2">Feedstocks</h1>
          <p className="body-small text-[var(--color-text-secondary)] mt-1">
            Track incoming biomass deliveries and bin allocations
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
                Create your first feedstock to get started
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

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        isOpen={!!deletingId}
        title="Delete Feedstock"
        message="Are you sure you want to delete this feedstock? This action cannot be undone. Note: Feedstocks used in production runs cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeletingId(null); setDeleteError(null); }}
        isPending={deleteFeedstock.isPending}
      />

      {/* Side Sheet */}
      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
          title={sideSheet.mode === "create" ? "Create Feedstock" : sideSheet.entity?.code ?? ""}
          subtitle={
            sideSheet.mode === "create"
              ? "Add a new biomass delivery with bin allocation"
              : sideSheet.entity
                ? [
                    sideSheet.entity.feedstockTypeName,
                    formatMass(sideSheet.entity.massDryKg),
                    sideSheet.entity.storageLocationCode,
                  ].filter(Boolean).join(" \u00B7 ") || "Feedstock"
                : undefined
          }
          editLabel="Edit Feedstock"
          sections={sideSheet.entity ? [
            {
              title: "Delivery Information",
              fields: [
                { label: "Facility", value: sideSheet.entity.facilityName },
                { label: "Delivery Date", value: formatSafeDate(sideSheet.entity.deliveryDate) },
                { label: "Supplier", value: sideSheet.entity.supplierName },
                { label: "Supplier Code", value: sideSheet.entity.supplierCode },
                { label: "Vehicle", value: sideSheet.entity.vehiclePlateNumber },
              ],
            },
            {
              title: "Material",
              fields: [
                { label: "Feedstock Type", value: sideSheet.entity.feedstockTypeName },
                { label: "Category", value: sideSheet.entity.feedstockTypeCategory ? <span className="capitalize">{sideSheet.entity.feedstockTypeCategory}</span> : null },
                {
                  label: "Wet Mass",
                  value: sideSheet.entity.massWetKg !== null
                    ? formatMass(sideSheet.entity.massWetKg)
                    : <StatusBadge status="pending" label="Missing" size="small" />,
                },
                { label: "Moisture", value: sideSheet.entity.moistureContentPercent !== null ? `${sideSheet.entity.moistureContentPercent}%` : null },
                { label: "Dry Mass", value: formatMass(sideSheet.entity.massDryKg) },
              ],
            },
            {
              title: "Storage",
              fields: [
                { label: "Storage Bin", value: sideSheet.entity.storageLocationCode ?? sideSheet.entity.storageLocationName },
              ],
            },
            ...(sideSheet.entity.overrideJustification ? [{
              title: "Override",
              fields: [{ label: "Justification", value: sideSheet.entity.overrideJustification }],
            }] : []),
            ...(sideSheet.entity.notes ? [{
              title: "Notes",
              fields: [{ label: "Notes", value: sideSheet.entity.notes }],
            }] : []),
          ] : undefined}
        >
          <FeedstockForm
            key={sideSheet.entity?.id ?? "create"}
            feedstock={sideSheet.entity ?? undefined}
            onSubmit={sideSheet.entity && sideSheet.mode === "edit" ? handleUpdate : handleCreate}
            onCancel={closeSideSheet}
            isSubmitting={createFeedstock.isPending || updateFeedstock.isPending}
            submitLabel={sideSheet.entity && sideSheet.mode === "edit" ? "Save Changes" : "Create Feedstock"}
            serverError={createError || updateError || undefined}
          />
        </EntitySideSheet>
      )}
    </div>
  );
}
