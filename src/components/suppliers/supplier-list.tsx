/**
 * SupplierList component
 * Main supplier listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Users, Plus } from "@phosphor-icons/react";
import type { Supplier } from "@/db/schema";
import {
  useCreateSupplier,
  useDeleteSupplier,
  useSuppliers,
  useUpdateSupplier,
} from "@/hooks/use-suppliers";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { SupplierForm } from "./supplier-form";
import type { SupplierFormData } from "@/schemas/suppliers";
import type { SupplierWithRelations } from "@/data-access/suppliers";

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
        <span className="font-medium text-[var(--clr-dark-purple)]">
          {row.original.code}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.location || "\u2014"}
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
        <div className="flex items-center justify-end gap-8">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(row.original);
            }}
            className="h-32 px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small transition-colors"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row.original.id);
            }}
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
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();
  const toast = useToast();

  const suppliers = suppliersData?.items ?? [];

  // Computed stats
  const totalSuppliers = suppliers.length;
  // Handlers
  const handleCreate = async (data: SupplierFormData) => {
    setCreateError(null);
    try {
      await createSupplier.mutateAsync(data);
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

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <h1 className="title-heading-2">Suppliers</h1>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={20} weight="bold" />
          New Supplier
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Suppliers"
          value={totalSuppliers}
          icon={<Users size={24} weight="bold" />}
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
          <div className="flex flex-col items-center justify-center gap-24 py-48">
            <Users size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">No suppliers yet</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                Create your first supplier to get started tracking biomass feedstock providers.
              </p>
            </div>
            <Button variant="primary" onClick={openCreate}>
              <Plus size={20} weight="bold" />
              Create Supplier
            </Button>
          </div>
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

      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
          title={sideSheet.mode === "create" ? "Create Supplier" : sideSheet.entity?.code ?? ""}
          subtitle={sideSheet.mode === "create" ? "Fill in the form to create a new supplier." : sideSheet.entity?.name}
          editLabel="Edit Supplier"
          sections={sideSheet.entity ? [
            {
              title: "General Information",
              fields: [
                { label: "Code", value: sideSheet.entity.code },
                { label: "Name", value: sideSheet.entity.name },
                { label: "Location", value: sideSheet.entity.location },
                { label: "Source Region", value: sideSheet.entity.sourceRegion },
                { label: "Address", value: sideSheet.entity.address },
              ],
            },
            {
              title: "Contact",
              fields: [
                { label: "Contact Name", value: sideSheet.entity.contactName },
                { label: "Contact Email", value: sideSheet.entity.contactEmail },
                { label: "Contact Phone", value: sideSheet.entity.contactPhone },
              ],
            },
          ] : undefined}
        >
          {(createError || updateError) && <div className="mb-24"><ServerError message={createError || updateError || ""} /></div>}
          <SupplierForm
            key={sideSheet.entity?.id ?? "create"}
            supplier={sideSheet.entity as Supplier | undefined}
            onSubmit={sideSheet.entity && sideSheet.mode === "edit" ? handleUpdate : handleCreate}
            onCancel={closeSideSheet}
            isSubmitting={createSupplier.isPending || updateSupplier.isPending}
            submitLabel={sideSheet.entity && sideSheet.mode === "edit" ? "Save Changes" : "Create Supplier"}
          />
        </EntitySideSheet>
      )}
    </div>
  );
}
