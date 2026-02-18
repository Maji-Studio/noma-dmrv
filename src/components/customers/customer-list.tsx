/**
 * CustomerList component
 * Main customer listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Users, Plus, MapTrifold } from "@phosphor-icons/react";
import type { Customer } from "@/db/schema";
import {
  useCreateCustomer,
  useDeleteCustomer,
  useCustomers,
  useUpdateCustomer,
} from "@/hooks/use-customers";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { CustomerForm } from "./customer-form";
import type { CustomerFormData } from "@/schemas/customers";
import type { CustomerWithRelations } from "@/data-access/customers";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (customer: CustomerWithRelations) => void,
  onDelete: (customerId: string) => void
): ColumnDef<CustomerWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <Link
          href={`/customers/${row.original.id}`}
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
      accessorKey: "cropType",
      header: "Crop Type",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.cropType || "\u2014"}
        </span>
      ),
    },
    {
      accessorKey: "locationCount",
      header: "Locations",
      cell: ({ row }) => (
        <span className="inline-flex items-center justify-center min-w-[28px] px-8 py-2 bg-[var(--color-surface-light)] border border-[var(--color-border-tertiary)] text-[var(--text-s)] font-medium">
          {row.original.locationCount}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-8">
          <Link
            href={`/customers/${row.original.id}`}
            className="h-32 px-12 inline-flex items-center border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            View
          </Link>
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

export function CustomerList() {
  // UI state
  const [sideSheet, setSideSheet] = useState<{
    entity: CustomerWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingCustomerId, setDeletingCustomerId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: customersData, isLoading, error: fetchError } = useCustomers();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const deleteCustomer = useDeleteCustomer();

  const customers = customersData?.items ?? [];

  // Computed stats
  const totalCustomers = customers.length;
  const totalLocations = customers.reduce((sum, c) => sum + c.locationCount, 0);

  // Side sheet helpers
  const openCreate = () => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: null, mode: "create" });
  };

  const openView = (customer: CustomerWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: customer, mode: "view" });
  };

  const openEdit = (customer: CustomerWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: customer, mode: "edit" });
  };

  const closeSideSheet = () => {
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
  };

  // Handlers
  const handleCreate = async (data: CustomerFormData) => {
    setCreateError(null);
    try {
      await createCustomer.mutateAsync(data);
      setSideSheet(null);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create customer");
    }
  };

  const handleUpdate = async (data: CustomerFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateCustomer.mutateAsync({ customerId: sideSheet.entity.id, ...data });
      setSideSheet(null);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Failed to update customer");
    }
  };

  const handleDelete = (customerId: string) => setDeletingCustomerId(customerId);

  const handleDeleteConfirm = async () => {
    if (!deletingCustomerId) return;
    setDeleteError(null);
    try {
      await deleteCustomer.mutateAsync(deletingCustomerId);
      setDeletingCustomerId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete customer");
    }
  };

  const columns = useMemo(() => createColumns(openEdit, handleDelete), []);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load customers"} />
      </div>
    );
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <h1 className="title-heading-2">Customers</h1>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={20} weight="bold" />
          New Customer
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Customers"
          value={totalCustomers}
          icon={<Users size={24} weight="bold" />}
          description="Biochar application customers"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Locations"
          value={totalLocations}
          icon={<MapTrifold size={24} weight="bold" />}
          description="Application field locations"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={customers}
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
              <h3 className="title-heading-3 mb-1">No customers yet</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                Create your first customer to get started.
              </p>
            </div>
            <Button variant="primary" onClick={openCreate}>
              <Plus size={20} weight="bold" />
              Create Customer
            </Button>
          </div>
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search customers..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteError && <ServerError message={deleteError} />}

      <DeleteConfirmDialog
        isOpen={!!deletingCustomerId}
        title="Delete Customer"
        message="Are you sure you want to delete this customer? This action cannot be undone. Note: Customers with locations cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingCustomerId(null);
          setDeleteError(null);
        }}
        isPending={deleteCustomer.isPending}
      />

      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
          title={sideSheet.mode === "create" ? "Create Customer" : sideSheet.entity?.code ?? ""}
          subtitle={
            sideSheet.mode === "create"
              ? "Fill in the form to create a new customer."
              : sideSheet.entity?.name
          }
          editLabel="Edit Customer"
          sections={
            sideSheet.entity
              ? [
                  {
                    title: "General Information",
                    fields: [
                      { label: "Code", value: sideSheet.entity.code },
                      { label: "Name", value: sideSheet.entity.name },
                      { label: "Crop Type", value: sideSheet.entity.cropType },
                    ],
                  },
                  {
                    title: "Stats",
                    fields: [
                      { label: "Locations", value: String(sideSheet.entity.locationCount) },
                    ],
                  },
                ]
              : undefined
          }
        >
          {(createError || updateError) && (
            <div className="mb-24">
              <ServerError message={createError || updateError || ""} />
            </div>
          )}
          <CustomerForm
            key={sideSheet.entity?.id ?? "create"}
            customer={sideSheet.entity as Customer | undefined}
            onSubmit={sideSheet.entity && sideSheet.mode === "edit" ? handleUpdate : handleCreate}
            onCancel={closeSideSheet}
            isSubmitting={createCustomer.isPending || updateCustomer.isPending}
            submitLabel={sideSheet.entity && sideSheet.mode === "edit" ? "Save Changes" : "Create Customer"}
          />
        </EntitySideSheet>
      )}
    </div>
  );
}
