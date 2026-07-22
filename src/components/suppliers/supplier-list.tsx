/**
 * SupplierList component
 * Main supplier listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { UsersIcon, PlusIcon } from "@phosphor-icons/react";
import type { Supplier } from "@/db/schema";
import {
  useCreateSupplierWithLocations,
  useDeleteSupplier,
  useSuppliers,
  useSupplierLocationsBySupplier,
  useUpdateSupplier,
} from "@/hooks/use-suppliers";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { SupplierForm, type PendingSupplierLocation } from "./supplier-form";
import type { SupplierFormData } from "@/schemas/suppliers";
import type { SupplierWithRelations } from "@/data-access/suppliers";
import { resolveSupplierLocationText } from "@/lib/supplier-location-display";
import { buildPartyLocationDetailFields } from "@/components/party-location-detail-fields";
import { buildSupplierFallbackDistanceField } from "./supplier-detail-fields";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (supplier: SupplierWithRelations) => void,
  onDelete: (supplierId: string) => void
): ColumnDef<SupplierWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <Link
          href={`/suppliers/${row.original.id}`}
          className="font-medium text-[var(--clr-dark-purple)] hover:underline"
        >
          {row.original.code}
        </Link>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      id: "location",
      header: "Location",
      accessorFn: (row) =>
        resolveSupplierLocationText(row.location, row.defaultLocationDisplay) || "",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {resolveSupplierLocationText(
            row.original.location,
            row.original.defaultLocationDisplay,
          ) || "\u2014"}
        </span>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      accessorFn: (row) => row.contactName || row.contactEmail || "",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.contactName || row.original.contactEmail || "\u2014"}
        </span>
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
              { label: "Open details", href: `/suppliers/${row.original.id}` },
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

export function SupplierList() {
  const [sideSheet, setSideSheet] = useState<{
    entity: SupplierWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingSupplierId, setDeletingSupplierId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: suppliersData, isLoading, error: fetchError } = useSuppliers();
  const { data: sideSheetLocations = [] } = useSupplierLocationsBySupplier(
    sideSheet?.entity?.id ?? "",
    !!sideSheet?.entity,
  );
  const createSupplier = useCreateSupplierWithLocations();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();
  const toast = useToast();

  const suppliers = suppliersData?.items ?? [];

  // Computed stats
  const totalSuppliers = suppliers.length;
  // Handlers
  const handleCreate = async (
    data: SupplierFormData,
    pendingLocations?: PendingSupplierLocation[]
  ) => {
    setCreateError(null);
    try {
      await createSupplier.mutateAsync({
        supplier: data,
        locations: pendingLocations ?? [],
      });
      setSideSheet(null);
      toast.success("Supplier created successfully");
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create supplier"
      );
    }
  };

  const handleUpdate = async (data: SupplierFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateSupplier.mutateAsync({
        supplierId: sideSheet.entity.id,
        ...data,
      });
      setSideSheet(null);
      toast.success("Supplier updated successfully");
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "Failed to update supplier"
      );
    }
  };

  const handleDelete = (supplierId: string) => {
    setDeletingSupplierId(supplierId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSupplierId) return;
    setDeleteError(null);
    try {
      await deleteSupplier.mutateAsync(deletingSupplierId);
      setDeletingSupplierId(null);
      toast.success("Supplier deleted successfully");
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete supplier"
      );
    }
  };

  const openCreate = () => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: null, mode: "create" }); };
  const openView = (supplier: SupplierWithRelations) => { setSideSheet({ entity: supplier, mode: "view" }); };
  const openEdit = (supplier: SupplierWithRelations) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: supplier, mode: "edit" }); };
  const closeSideSheet = () => { setSideSheet(null); setCreateError(null); setUpdateError(null); };
  useOpenCreateIntent(openCreate);

  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load suppliers"} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Supplier" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create" ? undefined : sideSheetEntity?.name || undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="distribution"
        title="Suppliers"
        subtitle="Biomass suppliers and their source sites"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New Supplier
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Suppliers"
          value={totalSuppliers}
          icon={<UsersIcon size={24} weight="bold" />}
          description="Biomass feedstock providers"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={suppliers}
        enableSorting
        enableFiltering
        enablePagination
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<UsersIcon size={48} />}
            title="No suppliers yet"
            description="Create your first supplier to get started tracking biomass feedstock providers."
            action={
              <Button variant="primary" onClick={openCreate}>
                <PlusIcon size={20} weight="bold" />
                Create Supplier
              </Button>
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search suppliers..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {/* Delete Error */}
      {deleteError && <ServerError message={deleteError} />}

      {/* Delete Confirm Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingSupplierId}
        title="Delete Supplier"
        message="Are you sure you want to delete this supplier? This action cannot be undone. Note: Suppliers with associated feedstock deliveries cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingSupplierId(null);
          setDeleteError(null);
        }}
        isPending={deleteSupplier.isPending}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Supplier"
        sections={sideSheetEntity ? [
          {
            title: "Required Information",
            fields: [
              { label: "Supplier Name", value: sideSheetEntity.name },
            ],
          },
          {
            title: "Locations",
            fields: buildPartyLocationDetailFields(sideSheetLocations, {
              distanceLabel: "One-way distance to facility (per leg, km)",
              defaultLabel: "Default source location",
              positionLabel: "Source location position",
            }),
          },
          {
            title: "Contact Information",
            fields: [
              { label: "Contact Name", value: sideSheetEntity.contactName },
              { label: "Contact Email", value: sideSheetEntity.contactEmail },
              { label: "Contact Phone", value: sideSheetEntity.contactPhone },
            ],
          },
          {
            title: "Sourcing Information",
            fields: [
              { label: "Location", value: sideSheetEntity.location },
              { label: "Source Region", value: sideSheetEntity.sourceRegion },
              { label: "Address", value: sideSheetEntity.address },
              buildSupplierFallbackDistanceField(
                sideSheetEntity.distanceToFacilityKm,
              ),
            ],
          },
        ] : undefined}
      >
        {(createError || updateError) && <div className="mb-24"><ServerError message={createError || updateError || ""} /></div>}
        <SupplierForm
          key={sideSheetEntity?.id ?? "create"}
          supplier={sideSheet?.entity as Supplier | undefined}
          supplierId={sideSheetEntity && sideSheetMode === "edit" ? sideSheetEntity.id : undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createSupplier.isPending || updateSupplier.isPending}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save Changes" : "Create Supplier"}
        />
      </EntitySideSheet>
    </div>
  );
}
