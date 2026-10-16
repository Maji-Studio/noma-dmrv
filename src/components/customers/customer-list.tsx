/**
 * CustomerList component
 * Main customer listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { ArchiveIcon, UsersIcon, PlusIcon, MapTrifoldIcon } from "@phosphor-icons/react/dist/ssr";
import type { Customer } from "@/db/schema";
import {
  useArchiveCustomer,
  useCustomerWithRelations,
  useCreateCustomerWithLocations,
  useDeleteCustomer,
  useRestoreCustomer,
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
import { DeleteConflictNotice, isInUseDeleteRefusal } from "@/components/ui/lifecycle-notices";
import { ArchivedCustomerNotice } from "@/components/parties";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { CustomerForm, type PendingLocation } from "./customer-form";
import type { CustomerFormData } from "@/schemas/customers";
import type { CustomerWithRelations } from "@/data-access/customers";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { toSaveErrorMessage, StaleVersionError, toDeleteErrorMessage, toArchiveRestoreErrorMessage } from "@/lib/stale-version";
import { ENTITY_DEEP_LINK_EDIT_MODE, ENTITY_DEEP_LINK_MODE_PARAM, LOCATION_DEEP_LINK_PARAM } from "@/lib/entity-deep-link";
import { CUSTOMER_DEEP_LINK_PARAM } from "@/lib/customer-links";
import { customerSheetSections } from "./customer-read-sections";
import { Notice } from "@/components/ui/notice";
import { ILLUSTRATION_SIZE, CustomerArt } from "@/components/ui/illustrations";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onView: (customer: CustomerWithRelations) => void,
  onEdit: (customer: CustomerWithRelations) => void,
  onArchive: (customer: CustomerWithRelations) => void,
  onRestore: (customer: CustomerWithRelations) => void,
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
              ...(row.original.archivedAt
                ? [{ label: "Restore", onSelect: () => onRestore(row.original) }]
                : [
                    { label: "Edit", onSelect: () => onEdit(row.original) },
                    { label: "Archive", onSelect: () => onArchive(row.original) },
                  ]),
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
  const [deepLinkMode, setDeepLinkMode] = useQueryState(
    ENTITY_DEEP_LINK_MODE_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [, setLocationIntent] = useQueryState(LOCATION_DEEP_LINK_PARAM, parseAsString.withOptions({ shallow: true, history: "replace" }));
  const handledInvalidCustomerIdRef = useRef<string | null>(null);
  const [sideSheet, setSideSheet] = useState<{
    entity: CustomerWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<CustomerWithRelations | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<CustomerWithRelations | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination(showArchived ? "archived" : "active");
  const debouncedSearch = useDebounce(
    searchInput,
    LIST_SEARCH_DEBOUNCE_MS,
  );

  const { data: customersData, isLoading, error: fetchError } = useCustomers({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    archived: showArchived,
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
          // An archived customer is read-only, whatever mode the link asks for.
          mode: deepLinkMode === ENTITY_DEEP_LINK_EDIT_MODE && !focusedCustomer.data.archivedAt ? "edit" : "view",
        } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;
  const sideSheetLocationsQuery = useCustomerLocations(
    displaySideSheet?.entity?.id ?? "",
    !!displaySideSheet?.entity,
  );
  const createCustomer = useCreateCustomerWithLocations();
  const updateCustomer = useUpdateCustomer();
  const deleteCustomer = useDeleteCustomer();
  const archiveCustomer = useArchiveCustomer();
  const restoreCustomer = useRestoreCustomer();
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
    void setFocusedCustomerId(null);
    void setDeepLinkMode(null);
    void setLocationIntent(null);
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
    void setDeepLinkMode(null);
    // An unconsumed `location=` (archived customers open read-only) must not
    // pop a dialog once the customer is restored and edited.
    void setLocationIntent(null);
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
    setLifecycleError(null);
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
      void setDeepLinkMode(null);
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
    setDeepLinkMode,
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
        expectedVersion: displaySideSheet.entity.version,
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

  const handleDelete = (customerId: string) => {
    setDeleteConflict(null);
    setDeleteError(null);
    setDeletingCustomer((customersData?.items ?? []).find((row) => row.id === customerId) ?? null);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingCustomer) return;
    setDeleteError(null);
    try {
      await deleteCustomer.mutateAsync({ customerId: deletingCustomer.id, expectedVersion: deletingCustomer.version });
      setDeletingCustomer(null);
      toast.success("Customer deleted.");
    } catch (error) {
      const message = toDeleteErrorMessage(error, `Customer ${deletingCustomer.code}`, "Customer was not deleted. Try again.");
      if (isInUseDeleteRefusal(message) && !deletingCustomer.archivedAt) {
        // In use: the dialog gives way to a notice that offers Archive instead.
        setDeleteConflict(deletingCustomer);
        setDeletingCustomer(null);
        return;
      }
      if (error instanceof StaleVersionError) setDeletingCustomer(null);
      setDeleteError(message);
    }
  };

  const handleArchive = async (customer: CustomerWithRelations) => {
    // Act on the list's current row: the snapshot a notice or sheet holds goes stale after a refused version.
    const fresh = (customersData?.items ?? []).find((row) => row.id === customer.id);
    const target = fresh ?? customer;
    setLifecycleError(null);
    try {
      await archiveCustomer.mutateAsync({ customerId: customer.id, expectedVersion: target.version });
      setDeleteConflict(null);
      toast.success(`Customer ${customer.code} archived. Restore it from the archived view.`);
    } catch (error) {
      // Without a fresh row the notice would keep the stale version, so drop it.
      if (error instanceof StaleVersionError && !fresh) setDeleteConflict(null);
      setLifecycleError(toArchiveRestoreErrorMessage(error, `Customer ${customer.code}`, "archive", "The customer was not archived. Try again."));
    }
  };

  const handleRestore = async (customer: CustomerWithRelations) => {
    // Act on the list's current row: the snapshot a notice or sheet holds goes stale after a refused version.
    const fresh = (customersData?.items ?? []).find((row) => row.id === customer.id);
    const target = fresh ?? customer;
    setLifecycleError(null);
    try {
      await restoreCustomer.mutateAsync({ customerId: customer.id, expectedVersion: target.version });
      closeSideSheet();
      toast.success(`Customer ${customer.code} restored.`);
    } catch (error) {
      setLifecycleError(toArchiveRestoreErrorMessage(error, `Customer ${customer.code}`, "restore", "The customer was not restored. Try again."));
    }
  };

  const toggleShowArchived = () => {
    setShowArchived((current) => !current);
    setCurrentPage(1);
    closeSideSheet();
    setDeleteConflict(null);
    setLifecycleError(null);
  };

  const columns = createColumns(openView, openEdit, handleArchive, handleRestore, handleDelete);

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

  const viewedEntity = sideSheetMode === "view" ? sideSheetEntity : null;

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
          title={showArchived ? "Archived customers" : "Active customers"}
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
            icon={hasActiveSearch ? <UsersIcon size={48} /> : <CustomerArt size={ILLUSTRATION_SIZE.empty} />}
            title={
              hasActiveSearch
                ? showArchived ? "No archived customers match" : "No matching customers"
                : showArchived ? "No archived customers" : "No customers yet"
            }
            description={
              hasActiveSearch
                ? "Try clearing your search."
                : showArchived ? "Customers you archive will appear here and can be restored." : undefined
            }
            action={
              !hasActiveSearch && !showArchived ? (
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
            <Button
              variant={showArchived ? "primary" : "default"}
              size="small"
              onClick={toggleShowArchived}
              aria-pressed={showArchived}
            >
              <ArchiveIcon size={16} weight="bold" />
              Archived
            </Button>
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteConflict && (
        <DeleteConflictNotice
          label={deleteConflict.code}
          onArchive={() => handleArchive(deleteConflict)}
          isPending={archiveCustomer.isPending}
        />
      )}

      {((lifecycleError && !viewedEntity) || (deleteError && !deletingCustomer)) && (
        <ServerError message={(!viewedEntity ? lifecycleError : null) ?? deleteError ?? ""} />
      )}

      <DeleteConfirmDialog
        isOpen={!!deletingCustomer}
        title="Delete customer"
        message="Are you sure you want to delete this customer and its locations? This action cannot be undone. Note: Customers used by orders, or with a location registered with Isometric as a storage site, cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingCustomer(null);
          setDeleteError(null);
        }}
        isPending={deleteCustomer.isPending}
        errorMessage={deleteError ?? undefined}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        // An archived customer stays in view mode: Restore is the way back to editing.
        onModeChange={(mode) => setSideSheet(displaySideSheet ? { entity: displaySideSheet.entity, mode: mode === "edit" && displaySideSheet.entity?.archivedAt ? "view" : mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit customer"
        canEdit={!viewedEntity?.archivedAt}
        viewModeNotice={
          viewedEntity?.archivedAt ? (
            <>
              <ArchivedCustomerNotice
                onRestore={() => handleRestore(viewedEntity)}
                isPending={restoreCustomer.isPending}
              />
              {lifecycleError && <ServerError message={lifecycleError} />}
            </>
          ) : undefined
        }
        sections={
          sideSheetEntity
            ? customerSheetSections(sideSheetEntity, sideSheetLocationsQuery)
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
