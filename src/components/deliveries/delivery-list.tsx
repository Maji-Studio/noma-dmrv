/**
 * DeliveryList component
 * Main delivery listing with CRUD operations using DataTable
 * Includes stat cards, status badges, and EntitySideSheet
 */
"use client";

import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Truck, Calendar, Package, Drop, Plus } from "@phosphor-icons/react";
import type { Delivery } from "@/db/schema";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/dashboard/stat-card";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { DeliveryForm } from "./delivery-form";
import {
  useCreateDelivery,
  useDeleteDelivery,
  useDeliveries,
  useUpdateDelivery,
  useDeliveryStats,
} from "@/hooks/use-deliveries";
import { useFacilityContext } from "@/hooks/use-facility-context";
import type {
  DeliveryFormData,
  CreateDeliveryData,
} from "@/schemas/deliveries";
import type { DeliveryWithRelations } from "@/data-access/deliveries";

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

function formatMass(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString()} kg`;
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (delivery: DeliveryWithRelations) => void,
  onDelete: (deliveryId: string) => void,
): ColumnDef<DeliveryWithRelations>[] {
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
      header: "Date",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--color-text-tertiary)]" />
          <span>{formatDate(row.original.deliveryDate)}</span>
        </div>
      ),
    },
    {
      accessorKey: "orderCode",
      header: "Order",
      cell: ({ row }) => <span>{row.original.orderCode || "—"}</span>,
    },
    {
      accessorKey: "customerName",
      header: "Customer",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.customerName || "—"}
        </span>
      ),
    },
    {
      accessorKey: "deliveredWetMassKg",
      header: "Wet Mass",
      cell: ({ row }) => (
        <span className="font-mono text-right">{formatMass(row.original.deliveredWetMassKg)}</span>
      ),
    },
    {
      accessorKey: "massDryKg",
      header: "Dry Mass",
      cell: ({ row }) => (
        <span className="font-mono text-right">{formatMass(row.original.massDryKg)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} />
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

export function DeliveryList() {
  // Unified side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: DeliveryWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);

  // Delete state
  const [deletingDeliveryId, setDeletingDeliveryId] = useState<string | null>(null);

  // Error state
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Global facility context
  const { facilityId: contextFacilityId } = useFacilityContext();

  // Data fetching — scope to selected facility (only query when facility is selected)
  const { data: deliveriesData, isLoading, error: fetchError } = useDeliveries(
    contextFacilityId ? { facilityId: contextFacilityId } : undefined,
    { enabled: !!contextFacilityId },
  );
  const { data: statsData, isLoading: statsLoading } = useDeliveryStats(
    contextFacilityId ? { facilityId: contextFacilityId } : undefined,
    { enabled: !!contextFacilityId },
  );

  // Mutations
  const createDelivery = useCreateDelivery();
  const updateDelivery = useUpdateDelivery();
  const deleteDelivery = useDeleteDelivery();
  const toast = useToast();

  // Side sheet helpers
  const openCreate = () => {
    setFormError(null);
    setSideSheet({ entity: null, mode: "create" });
  };

  const openView = (delivery: DeliveryWithRelations) => {
    setFormError(null);
    setSideSheet({ entity: delivery, mode: "view" });
  };

  const openEdit = (delivery: DeliveryWithRelations) => {
    setFormError(null);
    setSideSheet({ entity: delivery, mode: "edit" });
  };

  const closeSideSheet = () => {
    setSideSheet(null);
    setFormError(null);
  };

  // Handlers
  const handleCreate = async (data: DeliveryFormData) => {
    setFormError(null);
    try {
      if (!contextFacilityId) {
        setFormError("No facility selected. Please select a facility first.");
        return;
      }
      const createData = { ...data, facilityId: contextFacilityId } as CreateDeliveryData;
      await createDelivery.mutateAsync(createData);
      closeSideSheet();
      toast.success("Delivery created successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to create delivery");
    }
  };

  const handleUpdate = async (data: DeliveryFormData) => {
    if (!sideSheet?.entity) return;
    setFormError(null);
    try {
      await updateDelivery.mutateAsync({ deliveryId: sideSheet.entity.id, ...data });
      closeSideSheet();
      toast.success("Delivery updated successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to update delivery");
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
      toast.success("Delivery deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete delivery");
    }
  };

  // Memoize columns
  const columns = useMemo(
    () => createColumns((delivery) => openEdit(delivery), handleDelete),
    [openEdit, handleDelete],
  );

  const deliveries = deliveriesData?.items ?? [];

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load deliveries"} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create"
      ? "Create Delivery"
      : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create"
      ? "Add a new outbound product delivery"
      : sideSheetEntity?.customerName || sideSheetEntity?.orderCode || undefined;

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <div>
          <h1 className="title-heading-2">Deliveries</h1>
          <p className="body-small text-[var(--color-text-secondary)] mt-1">
            Track outbound biochar product deliveries
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={18} weight="bold" />
          New Delivery
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        <StatCard
          title="Total Deliveries"
          value={statsData?.totalDeliveries ?? 0}
          icon={<Truck size={24} weight="bold" />}
          description="All deliveries"
          isLoading={statsLoading}
        />
        <StatCard
          title="Wet Mass Delivered"
          value={`${(statsData?.totalDeliveredWetMassKg ?? 0).toLocaleString()} kg`}
          icon={<Package size={24} weight="bold" />}
          description="Total wet mass"
          isLoading={statsLoading}
        />
        <StatCard
          title="Dry Mass"
          value={`${(statsData?.totalMassDryKg ?? 0).toLocaleString()} kg`}
          icon={<Drop size={24} weight="bold" />}
          description="Total dry mass"
          isLoading={statsLoading}
        />
        <StatCard
          title="Delivered"
          value={statsData?.deliveredCount ?? 0}
          icon={<Truck size={24} weight="bold" />}
          description="Completed deliveries"
          isLoading={statsLoading}
        />
      </div>

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
            <Truck size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">No deliveries yet</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                Create your first delivery to get started
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

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Delivery"
        sections={
          sideSheetEntity
            ? [
                {
                  title: "General",
                  fields: [
                    { label: "Code", value: sideSheetEntity.code },
                    { label: "Delivery Date", value: formatDate(sideSheetEntity.deliveryDate) },
                    {
                      label: "Status",
                      value: (
                        <StatusBadge status={sideSheetEntity.status} />
                      ),
                    },
                  ],
                },
                {
                  title: "Details",
                  fields: [
                    { label: "Order", value: sideSheetEntity.orderCode },
                    { label: "Customer", value: sideSheetEntity.customerName },
                    { label: "Facility", value: sideSheetEntity.facilityName },
                  ],
                },
                {
                  title: "Mass",
                  fields: [
                    {
                      label: "Delivered Wet Mass",
                      value:
                        sideSheetEntity.deliveredWetMassKg != null
                          ? `${sideSheetEntity.deliveredWetMassKg.toLocaleString()} kg`
                          : null,
                    },
                    {
                      label: "Dry Mass",
                      value:
                        sideSheetEntity.massDryKg != null
                          ? `${sideSheetEntity.massDryKg.toLocaleString()} kg`
                          : null,
                    },
                    { label: "Biochar Product", value: sideSheetEntity.biocharProductCode },
                  ],
                },
                {
                  title: "Transport",
                  fields: [
                    { label: "Driver", value: sideSheetEntity.driverName },
                    { label: "Vehicle", value: sideSheetEntity.vehicleName },
                  ],
                },
              ]
            : undefined
        }
      >
        {formError && <ServerError message={formError} />}
        <DeliveryForm
          key={sideSheetEntity?.id ?? "create"}
          delivery={sideSheet?.entity as Delivery | undefined}
          onSubmit={sideSheetMode === "create" ? handleCreate : handleUpdate}
          onCancel={closeSideSheet}
          isSubmitting={createDelivery.isPending || updateDelivery.isPending}
          submitLabel={sideSheetMode === "create" ? "Create Delivery" : "Save Changes"}
        />
      </EntitySideSheet>

      {/* Delete Error */}
      {deleteError && <ServerError message={deleteError} />}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingDeliveryId}
        title="Delete Delivery"
        message="Are you sure you want to delete this delivery? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingDeliveryId(null);
          setDeleteError(null);
        }}
        isPending={deleteDelivery.isPending}
      />
    </div>
  );
}
