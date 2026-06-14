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
  useCreateCustomerLocation,
  useDeleteCustomer,
  useCustomers,
  useUpdateCustomer,
} from "@/hooks/use-customers";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { CustomerForm, type PendingLocation } from "./customer-form";
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
        <div className="flex items-center justify-end">
          <RowActionsMenu
            label={`Actions for ${row.original.code}`}
            actions={[
              { label: "Open details", href: `/customers/${row.original.id}` },
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
  const createLocation = useCreateCustomerLocation();
  const updateCustomer = useUpdateCustomer();
  const deleteCustomer = useDeleteCustomer();
  const toast = useToast();

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
  useOpenCreateIntent(openCreate);

  // Handlers
  const handleCreate = async (data: CustomerFormData, pendingLocations?: PendingLocation[]) => {
    setCreateError(null);
    try {
      const customer = await createCustomer.mutateAsync(data);
      if (pendingLocations?.length) {
        for (const loc of pendingLocations) {
          await createLocation.mutateAsync({
            customerId: customer.id,
            ...loc,
          });
        }
      }
      setSideSheet(null);
      toast.success("Customer created successfully");
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
      toast.success("Customer updated successfully");
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
      toast.success("Customer deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete customer");
    }
  };

  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <div className="border border-[var(--color-signal-red)] bg-[var(--color-signal-red)]/10 p-16 flex items-center gap-12" role="alert">
          <span className="text-[var(--color-signal-red)] body-small font-medium">Failed to load customers</span>
        </div>
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Customer" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create" ? undefined : sideSheetEntity?.name || undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="distribution"
        title="Customers"
        subtitle="Biochar buyers and their application locations"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus size={20} weight="bold" />
            New Customer
          </Button>
        }
      />

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
          <EmptyState
            padding="md"
            icon={<Users size={48} />}
            title="No customers yet"
            description="Create your first customer to get started."
            action={
              <Button variant="primary" onClick={openCreate}>
                <Plus size={20} weight="bold" />
                Create Customer
              </Button>
            }
          />
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

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Customer"
        sections={
          sideSheetEntity
            ? [
                {
                  title: "General Information",
                  fields: [
                    { label: "Code", value: sideSheetEntity.code },
                    { label: "Name", value: sideSheetEntity.name },
                    { label: "Crop Type", value: sideSheetEntity.cropType },
                    { label: "Address", value: sideSheetEntity.address },
                  ],
                },
                {
                  title: "Contact Information",
                  fields: [
                    { label: "Email", value: sideSheetEntity.contactEmail },
                    { label: "Phone", value: sideSheetEntity.contactPhone },
                  ],
                },
                {
                  title: "Locations",
                  fields: [
                    { label: "Count", value: String(sideSheetEntity.locationCount) },
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
          key={sideSheetEntity?.id ?? "create"}
          customer={sideSheet?.entity as Customer | undefined}
          customerId={sideSheetEntity && sideSheetMode === "edit" ? sideSheetEntity.id : undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createCustomer.isPending || createLocation.isPending || updateCustomer.isPending}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save Changes" : "Create Customer"}
        />
      </EntitySideSheet>
    </div>
  );
}
