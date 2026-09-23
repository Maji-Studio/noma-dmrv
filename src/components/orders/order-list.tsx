/**
 * OrderList component
 * Main order listing with CRUD operations, filters, and DataTable
 */
"use client";

import { EntitySelect, ServerError } from "@/components/forms";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import type { OrderWithRelations } from "@/data-access/orders";
import type { Order } from "@/db/schema";
import { useDebounce } from "@/hooks/use-debounce";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import { useCreateOrder, useDeleteOrder, useOrders, useUpdateOrder } from "@/hooks/use-orders";
import { MISSING_VALUE, pluralize } from "@/lib/copy-utils";
import { formatDate } from "@/lib/format-utils";
import {
  ORDER_FULFILLMENT_DISPLAY,
  orderFulfillmentStatuses,
  type OrderFulfillmentStatus,
} from "@/lib/orders/fulfillment";
import type { OrderFilterData, OrderFormData } from "@/schemas/orders";
import { PackageIcon, PlusIcon, TruckIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { OrderForm } from "./order-form";
import { orderSheetSections } from "./order-read-sections";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (order: OrderWithRelations) => void,
  onDelete: (orderId: string) => void
): ColumnDef<OrderWithRelations>[] {
  return [
    {
      accessorKey: "code",
      meta: { nowrap: true },
      header: "Code",
      cell: ({ row }) => <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>,
    },
    {
      accessorKey: "orderDate",
      meta: { nowrap: true },
      header: "Date",
      cell: ({ row }) => <span className="text-[var(--color-text-secondary)]">{formatDate(row.original.orderDate)}</span>,
    },
    {
      id: "customer",
      header: "Customer",
      accessorFn: (row) => row.customerName ?? "",
      cell: ({ row }) => row.original.customerName || MISSING_VALUE.notRecorded,
    },
    {
      id: "facility",
      header: "Facility",
      accessorFn: (row) => row.facilityName ?? "",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.facilityName || MISSING_VALUE.notAvailable}
        </span>
      ),
    },
    {
      accessorKey: "quantityKg",
      header: "Requested wet mass (kg)",
      cell: ({ row }) => row.original.quantityKg.toLocaleString(),
    },
    {
      accessorKey: "deliveryCount",
      header: "Deliveries",
      cell: ({ row }) => {
        const { deliveredCount, deliveryCount } = row.original;
        return (
          <span
            className="inline-flex items-center justify-center min-w-[40px] px-8 py-2 bg-[var(--color-surface-light)] border border-[var(--color-border-tertiary)] text-[var(--text-s)] font-medium font-mono"
            title={
              deliveryCount > 0
                ? `${deliveredCount} of ${deliveryCount} ${pluralize(deliveryCount, "delivery", "deliveries")} delivered`
                : "No deliveries scheduled"
            }
          >
            {deliveryCount > 0
              ? `${deliveredCount}/${deliveryCount}`
              : MISSING_VALUE.none}
          </span>
        );
      },
    },
    {
      id: "fulfillment",
      header: "Status",
      accessorFn: (row) => row.fulfillmentStatus,
      cell: ({ row }) => {
        const { label, badgeStatus } = ORDER_FULFILLMENT_DISPLAY[row.original.fulfillmentStatus];
        return <StatusBadge status={badgeStatus} label={label} />;
      },
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

export function OrderList() {
  // Global facility context
  const { facilityId } = useFacilityContext();

  // Filter / pagination state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderFulfillmentStatus | "">("");
  const [customerFilter, setCustomerFilter] = useState("");
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination(facilityId);
  const debouncedSearch = useDebounce(searchQuery, LIST_SEARCH_DEBOUNCE_MS);

  // Unified side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: OrderWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);

  // Delete state
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);

  // Error state
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filters: Partial<OrderFilterData> = {
    search: debouncedSearch || undefined,
    facilityId: facilityId || undefined,
    status: statusFilter || undefined,
    customerId: customerFilter || undefined,
    page: currentPage,
    pageSize,
    sortBy: "orderDate",
    sortOrder: "desc",
  };

  const { data: ordersData, isLoading, error: fetchError } = useOrders(
    filters,
    { enabled: !!facilityId },
  );

  const createOrder = useCreateOrder();
  const updateOrder = useUpdateOrder();
  const deleteOrder = useDeleteOrder();
  const toast = useToast();

  const orders = ordersData?.items ?? [];
  const totalOrders = ordersData?.total ?? 0;
  const totalPages = ordersData?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });
  const totalDeliveries = orders.reduce((sum, o) => sum + o.deliveryCount, 0);
  const totalQuantityKg = orders.reduce((sum, o) => sum + o.quantityKg, 0);

  // Side sheet helpers
  const openCreate = () => {
    setFormError(null);
    setSideSheet({ entity: null, mode: "create" });
  };

  const openView = (order: OrderWithRelations) => {
    setFormError(null);
    setSideSheet({ entity: order, mode: "view" });
  };

  const openEdit = (order: OrderWithRelations) => {
    setFormError(null);
    setSideSheet({ entity: order, mode: "edit" });
  };

  const closeSideSheet = () => {
    setSideSheet(null);
    setFormError(null);
  };

  // Handlers
  const handleCreate = async (data: OrderFormData) => {
    setFormError(null);
    try {
      await createOrder.mutateAsync(data);
      closeSideSheet();
      toast.success("Order created.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Order was not created. Check the form.");
    }
  };

  const handleUpdate = async (data: OrderFormData) => {
    if (!sideSheet?.entity) return;
    setFormError(null);
    try {
      await updateOrder.mutateAsync({ orderId: sideSheet.entity.id, ...data });
      closeSideSheet();
      toast.success("Order updated.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Order was not saved. Try again.");
    }
  };

  const handleDelete = (orderId: string) => setDeletingOrderId(orderId);

  const handleDeleteConfirm = async () => {
    if (!deletingOrderId) return;
    setDeleteError(null);
    try {
      await deleteOrder.mutateAsync(deletingOrderId);
      setDeletingOrderId(null);
      toast.success("Order deleted.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Order was not deleted. Try again.");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setCustomerFilter("");
    setCurrentPage(1);
  };
  const hasActiveFilters = !!searchQuery || !!statusFilter || !!customerFilter;

  const columns = createColumns(openEdit, handleDelete);

  if (!facilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="distribution"
          title="Orders"
          subtitle="Customer orders for biochar products"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its orders." />
      </div>
    );
  }

  if (fetchError) {
    return <div className="container-max py-32"><ServerError message={fetchError.message || "The orders could not be loaded. Refresh the page and try again."} /></div>;
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Order" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create"
      ? undefined
      : sideSheetEntity?.customerName || undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="distribution"
        title="Orders"
        subtitle="Customer orders for biochar products"
        actions={
          <Button variant="primary" onClick={openCreate}><PlusIcon size={20} weight="bold" />New Order</Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard title="Total Orders" value={totalOrders} icon={<PackageIcon size={24} weight="bold" />} description="All orders" isLoading={isLoading} />
        <StatCard title="Total Deliveries" value={totalDeliveries} icon={<TruckIcon size={24} weight="bold" />} description="Deliveries on this page" isLoading={isLoading} />
        <StatCard title="Total Quantity" value={`${totalQuantityKg.toLocaleString()} kg`} icon={<PackageIcon size={24} weight="bold" />} description="Quantity on this page" isLoading={isLoading} />
      </div>

      <DataTable
        columns={columns}
        data={orders}
        enableSorting={false}
        enablePagination
        manualPagination
        pageCount={totalPages}
        pageSize={pageSize}
        pageIndex={currentPage - 1}
        globalFilter={searchQuery}
        onGlobalFilterChange={(value) => {
          setSearchQuery(value);
          setCurrentPage(1);
        }}
        onPaginationChange={onPaginationChange}
        aria-label="Orders"
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<PackageIcon size={48} />}
            title={hasActiveFilters ? "No orders found" : "No orders yet"}
            description={hasActiveFilters ? "Try adjusting your search or filters." : undefined}
            action={!hasActiveFilters ? <Button variant="primary" onClick={openCreate}><PlusIcon size={20} weight="bold" />Create your first order</Button> : undefined}
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search
            placeholder="Search by order code..."
            aria-label="Search orders by code"
          />
          <DataTable.Controls>
            <DataTable.FilterSelect
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as OrderFulfillmentStatus | ""); setCurrentPage(1); }}
              aria-label="Filter by fulfillment status"
            >
              <option value="">All statuses</option>
              {orderFulfillmentStatuses.map((s) => (
                <option key={s} value={s}>{ORDER_FULFILLMENT_DISPLAY[s].label}</option>
              ))}
            </DataTable.FilterSelect>
            {/*
              Searchable rather than a native select: an organization can hold
              more customers than any fixed page would list, and a truncated
              filter silently hides orders (#774). The "All customers" row is
              the unfiltered state, so it reads as a choice, not a blank.
            */}
            <EntitySelect
              entityType="customer"
              value={customerFilter || undefined}
              onChange={(value) => { setCustomerFilter(value ?? ""); setCurrentPage(1); }}
              placeholder="Filter by customer"
              noneOption={{ label: "All customers" }}
              alwaysShowSearch
              className="w-full sm:w-[200px]"
            />
            {hasActiveFilters && <Button variant="noOutline" size="small" onClick={clearFilters}><XIcon size={16} weight="bold" />Clear</Button>}
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {/* Unified Side Sheet */}
      {/* Both modes: the form hides matching stock in Simple too. */}
      <EntitySideSheet
        numberedSections
        detailToggle
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={(mode) => {
          // Mode changes are navigation; a submit error from the previous
          // visit must not resurface on the next edit entry.
          setFormError(null);
          setSideSheet((prev) => (prev ? { ...prev, mode } : null));
        }}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Order"
        sections={sideSheetEntity ? orderSheetSections(sideSheetEntity) : undefined}
      >
        <OrderForm
          key={sideSheetEntity?.id ?? "create"}
          order={sideSheet?.entity as Order | undefined}
          onSubmit={sideSheetMode === "create" ? handleCreate : handleUpdate}
          onCancel={closeSideSheet}
          isSubmitting={createOrder.isPending || updateOrder.isPending}
          errorMessage={formError ?? undefined}
          submitLabel={sideSheetMode === "create" ? "Create Order" : "Save Changes"}
        />
      </EntitySideSheet>

      {deleteError && <ServerError message={deleteError} />}
      <DeleteConfirmDialog isOpen={!!deletingOrderId} title="Delete Order" message="Are you sure you want to delete this order? This action cannot be undone. Note: Orders with deliveries cannot be deleted." onConfirm={handleDeleteConfirm} onCancel={() => { setDeletingOrderId(null); setDeleteError(null); }} isPending={deleteOrder.isPending} />
    </div>
  );
}
