/**
 * DeliveryList component
 * Main delivery listing with CRUD operations using DataTable
 * Includes stat cards, status badges, and EntitySideSheet
 */
"use client";

import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { TruckIcon, CalendarIcon, PackageIcon, DropIcon, PlusIcon } from "@phosphor-icons/react";
import type { Delivery } from "@/db/schema";
import { DataTable } from "@/components/ui/data-table";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { DeliveryForm } from "./delivery-form";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import { TransportEvidencePanel } from "@/components/transport-legs";
import {
  useCreateDelivery,
  useDeleteDelivery,
  useDeliveries,
  useUpdateDelivery,
  useDeliveryStats,
} from "@/hooks/use-deliveries";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { SelectFacilityEmptyState } from "@/components/navigation";
import type {
  DeliveryFormData,
  CreateDeliveryData,
} from "@/schemas/deliveries";
import type { DeliveryWithRelations } from "@/data-access/deliveries";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { formatSafeDate } from "@/lib/format-utils";

// ============================================
// Helper Functions
// ============================================

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
          <CalendarIcon size={16} className="text-[var(--color-text-tertiary)]" />
          <span>{formatSafeDate(row.original.deliveryDate)}</span>
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
      id: "certifyReadiness",
      header: "Certification",
      cell: ({ row }) => (
        <EntityCertifyReadinessBadge
          readiness={deriveEntityCertifyReadiness("delivery", row.original)}
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

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="distribution"
          title="Deliveries"
          subtitle="Track outbound biochar product deliveries"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its deliveries." />
      </div>
    );
  }

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
      ? undefined
      : sideSheetEntity?.customerName || sideSheetEntity?.orderCode || undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="distribution"
        title="Deliveries"
        subtitle="Track outbound biochar product deliveries"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={18} weight="bold" />
            New Delivery
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        <StatCard
          title="Total Deliveries"
          value={statsData?.totalDeliveries ?? 0}
          icon={<TruckIcon size={24} weight="bold" />}
          description="All deliveries"
          isLoading={statsLoading}
        />
        <StatCard
          title="Wet Mass Delivered"
          value={`${(statsData?.totalDeliveredWetMassKg ?? 0).toLocaleString()} kg`}
          icon={<PackageIcon size={24} weight="bold" />}
          description="Total wet mass"
          isLoading={statsLoading}
        />
        <StatCard
          title="Dry Mass"
          value={`${(statsData?.totalMassDryKg ?? 0).toLocaleString()} kg`}
          icon={<DropIcon size={24} weight="bold" />}
          description="Total dry mass"
          isLoading={statsLoading}
        />
        <StatCard
          title="Delivered"
          value={statsData?.deliveredCount ?? 0}
          icon={<TruckIcon size={24} weight="bold" />}
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
          <EmptyState
            padding="md"
            icon={<TruckIcon size={48} />}
            title="No deliveries yet"
            description="Create your first delivery to get started"
            action={
              <Button variant="primary" onClick={openCreate}>
                <PlusIcon size={18} weight="bold" />
                New Delivery
              </Button>
            }
          />
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
                    { label: "Delivery Date", value: formatSafeDate(sideSheetEntity.deliveryDate) },
                    {
                      label: "Status",
                      value: (
                        <StatusBadge status={sideSheetEntity.status} />
                      ),
                    },
                    {
                      label: "Certification",
                      value: (
                        <EntityCertifyReadinessBadge
                          readiness={deriveEntityCertifyReadiness(
                            "delivery",
                            sideSheetEntity,
                          )}
                        />
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
                      label:
                        sideSheetEntity.status === "delivered"
                          ? "Delivered Wet Mass"
                          : "Planned Wet Mass",
                      ...certificationDetailField("delivery", "deliveredWetMassKg"),
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
        viewModeChildren={
          sideSheetMode === "view" && sideSheetEntity ? (
            <TransportEvidencePanel
              entityType="delivery"
              entityId={sideSheetEntity.id}
            />
          ) : null
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
