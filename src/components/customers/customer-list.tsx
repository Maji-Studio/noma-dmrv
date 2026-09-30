/**
 * CustomerList component
 * Main customer listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { UsersIcon, PlusIcon, MapTrifoldIcon } from "@phosphor-icons/react/dist/ssr";
import type { Customer } from "@/db/schema";
import {
  useCustomerWithRelations,
  useCreateCustomerWithLocations,
  useDeleteCustomer,
  useCustomerLocations,
  useCustomers,
  useUpdateCustomer,
} from "@/hooks/use-customers";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
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
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { CUSTOMER_DEEP_LINK_PARAM } from "@/lib/customer-links";
import { customerSheetSections } from "./customer-read-sections";
import { Notice } from "@/components/ui/notice";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onView: (customer: CustomerWithRelations) => void,
  onEdit: (customer: CustomerWithRelations) => void,
  onDelete: (customerId: string) => void
): ColumnDef<CustomerWithRelations>[] {
  return [
    {
      accessorKey: "code",
      meta: { nowrap: true },
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
      accessorKey: "cropType",
      header: "Crop type",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.cropType || MISSING_VALUE.notRecorded}
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
      meta: { stickyEnd: true },
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <RowActionsMenu
            label={`Actions for ${row.original.code}`}
            actions={[
              { label: "Open details", onSelect: () => onView(row.original) },
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
  // `?customer=<id>` deep-links the view sheet (credit-batch convention); local
  // state handles sheets opened by clicks.
  const [focusedCustomerId, setFocusedCustomerId] = useQueryState(
    CUSTOMER_DEEP_LINK_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const handledInvalidCustomerIdRef = useRef<string | null>(null);
  const [sideSheet, setSideSheet] = useState<{
    entity: CustomerWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingCustomerId, setDeletingCustomerId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination();
  const debouncedSearch = useDebounce(
    searchInput,
    LIST_SEARCH_DEBOUNCE_MS,
  );

  const { data: customersData, isLoading, error: fetchError } = useCustomers({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    page: currentPage,
    pageSize,
  });
  const focusedCustomer = useCustomerWithRelations(focusedCustomerId ?? "");
  const deepLinkedSideSheet =
    focusedCustomerId && focusedCustomer.data
      ? ({
          entity: {
            ...focusedCustomer.data,
            locationCount: focusedCustomer.data.locations.length,
          },
          mode: "view",
        } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;
  const { data: sideSheetLocations = [] } = useCustomerLocations(
    displaySideSheet?.entity?.id ?? "",
    !!displaySideSheet?.entity,
  );
  const createCustomer = useCreateCustomerWithLocations();
  const updateCustomer = useUpdateCustomer();
  const deleteCustomer = useDeleteCustomer();
  const toast = useToast();

  const customers = customersData?.items ?? [];

  // Computed stats
  const totalCustomers = customersData?.total ?? 0;
  const totalPages = customersData?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });
  const totalLocations = customers.reduce((sum, c) => sum + c.locationCount, 0);
  const hasActiveSearch = searchInput.trim().length > 0;

  // Side sheet helpers
  const openCreate = () => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: null, mode: "create" });
  };

  const openView = (customer: CustomerWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    void setFocusedCustomerId(customer.id);
    setSideSheet({ entity: customer, mode: "view" });
  };

  const openEdit = (customer: CustomerWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: customer, mode: "edit" });
  };

  const closeSideSheet = () => {
    void setFocusedCustomerId(null);
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
  };
  useOpenCreateIntent(openCreate);

  // Clear a deep-linked `?customer=` that cannot be opened (deleted or
  // cross-org), with the same guard as the credit-batch list.
  useEffect(() => {
    if (!focusedCustomerId) {
      handledInvalidCustomerIdRef.current = null;
      return;
    }
    if (focusedCustomer.isLoading || focusedCustomer.isFetching || focusedCustomer.isPending) return;
    if (handledInvalidCustomerIdRef.current === focusedCustomerId) return;
    if (focusedCustomer.isError || (focusedCustomer.isSuccess && !focusedCustomer.data)) {
      handledInvalidCustomerIdRef.current = focusedCustomerId;
      toast.error("Linked customer could not be opened");
      void setFocusedCustomerId(null);
    }
  }, [
    focusedCustomer.data,
    focusedCustomer.isError,
    focusedCustomer.isFetching,
    focusedCustomer.isLoading,
    focusedCustomer.isPending,
    focusedCustomer.isSuccess,
    focusedCustomerId,
    setFocusedCustomerId,
    toast,
  ]);

  // Handlers
  const handleCreate = async (data: CustomerFormData, pendingLocations?: PendingLocation[]) => {
    setCreateError(null);
    try {
      // One transaction on the server: a location that fails takes the customer
      // with it, so the operator never keeps a half-saved customer.
      await createCustomer.mutateAsync({
        customer: data,
        locations: pendingLocations ?? [],
      });
      closeSideSheet();
      toast.success("Customer created.");
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "The customer and its locations were not created. Check the form and save again.",
      );
    }
  };

  const handleUpdate = async (data: CustomerFormData) => {
    if (!displaySideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateCustomer.mutateAsync({
        customerId: displaySideSheet.entity.id,
        // The version the side sheet opened on, never a refetched one, so a
        // concurrent edit is refused instead of silently overwritten (#768).
        expectedUpdatedAt: displaySideSheet.entity.updatedAt,
        ...data,
      });
      closeSideSheet();
      toast.success("Customer updated.");
    } catch (error) {
      // The side sheet stays open on every failure, so the operator's draft
      // survives an expected-version refusal untouched.
      setUpdateError(toSaveErrorMessage(error, "Customer was not saved. Try again."));
    }
  };

  const handleDelete = (customerId: string) => setDeletingCustomerId(customerId);

  const handleDeleteConfirm = async () => {
    if (!deletingCustomerId) return;
    setDeleteError(null);
    try {
      await deleteCustomer.mutateAsync(deletingCustomerId);
      setDeletingCustomerId(null);
      toast.success("Customer deleted.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Customer was not deleted. Try again.");
    }
  };

  const columns = createColumns(openView, openEdit, handleDelete);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <Notice tone="error">
          Customers could not be loaded. Refresh the page and try again.
        </Notice>
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!displaySideSheet;
  const sideSheetMode = displaySideSheet?.mode ?? "create";
  const sideSheetEntity = displaySideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create customer" : sideSheetEntity?.code ?? "";

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
            <PlusIcon size={20} weight="bold" />
            New customer
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total customers"
          value={totalCustomers}
          icon={<UsersIcon size={24} weight="bold" />}
          description="Biochar application customers"
          isLoading={isLoading}
        />
        <StatCard
          title="Locations on this page"
          value={totalLocations}
          icon={<MapTrifoldIcon size={24} weight="bold" />}
          description="Application field locations on this page"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={customers}
        enableSorting={false}
        enablePagination
        manualPagination
        pageCount={totalPages}
        pageSize={pageSize}
        pageIndex={currentPage - 1}
        globalFilter={searchInput}
        onGlobalFilterChange={(value) => {
          setSearchInput(value);
          setCurrentPage(1);
        }}
        onPaginationChange={onPaginationChange}
        aria-label="Customers"
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<UsersIcon size={48} />}
            title={hasActiveSearch ? "No matching customers" : "No customers yet"}
            description={hasActiveSearch ? "Try clearing your search." : undefined}
            action={
              !hasActiveSearch ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={20} weight="bold" />
                  Create your first customer
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search
            placeholder="Search customers..."
            aria-label="Search customers"
          />
          <DataTable.Controls>
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteError && <ServerError message={deleteError} />}

      <DeleteConfirmDialog
        isOpen={!!deletingCustomerId}
        title="Delete customer"
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
        onModeChange={(mode) => setSideSheet(displaySideSheet ? { entity: displaySideSheet.entity, mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit customer"
        sections={
          sideSheetEntity
            ? customerSheetSections(sideSheetEntity, sideSheetLocations)
            : undefined
        }
      >
        <CustomerForm
          key={sideSheetEntity?.id ?? "create"}
          customer={displaySideSheet?.entity as Customer | undefined}
          customerId={sideSheetEntity && sideSheetMode === "edit" ? sideSheetEntity.id : undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createCustomer.isPending || updateCustomer.isPending}
          errorMessage={createError || updateError || undefined}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save changes" : "Create customer"}
        />
      </EntitySideSheet>
    </div>
  );
}
