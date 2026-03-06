/**
 * OrderList component
 * Main order listing with CRUD operations, filters, and DataTable
 */
"use client";

import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Package, MagnifyingGlass, Plus, X, Truck } from "@phosphor-icons/react";
import type { Order } from "@/db/schema";
import { useCreateOrder, useDeleteOrder, useOrders, useUpdateOrder } from "@/hooks/use-orders";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { OrderForm } from "./order-form";
import type { OrderFormData, OrderFilterData } from "@/schemas/orders";
import type { OrderWithRelations } from "@/data-access/orders";

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

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
      header: "Code",
      cell: ({ row }) => <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>,
    },
    {
      accessorKey: "orderDate",
      header: "Date",
      cell: ({ row }) => <span className="text-[var(--color-text-secondary)]">{formatDate(row.original.orderDate)}</span>,
    },
    {
      id: "customer",
      header: "Customer",
      accessorFn: (row) => row.customerName ?? "",
      cell: ({ row }) => row.original.customerName || "\u2014",
    },
    {
      id: "facility",
      header: "Facility",
      accessorFn: (row) => row.facilityName ?? "",
      cell: ({ row }) => <span className="text-[var(--color-text-secondary)]">{row.original.facilityName || "\u2014"}</span>,
    },
    {
      accessorKey: "quantityKg",
      header: "Quantity (kg)",
      cell: ({ row }) => row.original.quantityKg.toLocaleString(),
    },
    {
      accessorKey: "deliveryCount",
      header: "Deliveries",
      cell: ({ row }) => (
        <span className="inline-flex items-center justify-center min-w-[28px] px-8 py-2 bg-[var(--color-surface-light)] border border-[var(--color-border-tertiary)] text-[var(--text-s)] font-medium">
          {row.original.deliveryCount}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-8">
          <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(row.original); }} className="h-32 px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small transition-colors">Edit</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(row.original.id); }} className="h-32 px-12 border border-[var(--color-signal-red)] text-[var(--color-signal-red)] rounded-none hover:bg-[var(--color-signal-red)]/10 body-small transition-colors">Delete</button>
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

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

  const filters: Partial<OrderFilterData> = useMemo(() => ({
    search: searchQuery || undefined,
    facilityId: facilityId || undefined,
    page: currentPage,
    pageSize,
    sortBy: "orderDate",
    sortOrder: "desc",
  }), [searchQuery, facilityId, currentPage, pageSize]);

  const { data: ordersData, isLoading, error: fetchError } = useOrders(filters);

  const createOrder = useCreateOrder();
  const updateOrder = useUpdateOrder();
  const deleteOrder = useDeleteOrder();
  const toast = useToast();

  const orders = ordersData?.items ?? [];
  const totalOrders = ordersData?.total ?? 0;
  const totalPages = ordersData?.totalPages ?? 0;
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
      toast.success("Order created successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to create order");
    }
  };

  const handleUpdate = async (data: OrderFormData) => {
    if (!sideSheet?.entity) return;
    setFormError(null);
    try {
      await updateOrder.mutateAsync({ orderId: sideSheet.entity.id, ...data });
      closeSideSheet();
      toast.success("Order updated successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to update order");
    }
  };

  const handleDelete = (orderId: string) => setDeletingOrderId(orderId);

  const handleDeleteConfirm = async () => {
    if (!deletingOrderId) return;
    setDeleteError(null);
    try {
      await deleteOrder.mutateAsync(deletingOrderId);
      setDeletingOrderId(null);
      toast.success("Order deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete order");
    }
  };

  const clearFilters = () => { setSearchQuery(""); setCurrentPage(1); };
  const hasActiveFilters = !!searchQuery;

  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  if (fetchError) {
    return <div className="container-max py-32"><ServerError message={fetchError.message || "Failed to load orders"} /></div>;
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Order" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create"
      ? "Fill in the form to create a new order."
      : sideSheetEntity?.customerName || undefined;

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      <div className="flex items-center justify-between gap-24">
        <h1 className="title-heading-2">Orders</h1>
        <Button variant="primary" onClick={openCreate}><Plus size={20} weight="bold" />New Order</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard title="Total Orders" value={totalOrders} icon={<Package size={24} weight="bold" />} description="All orders" isLoading={isLoading} />
        <StatCard title="Total Deliveries" value={totalDeliveries} icon={<Truck size={24} weight="bold" />} description="Deliveries on this page" isLoading={isLoading} />
        <StatCard title="Total Quantity" value={`${totalQuantityKg.toLocaleString()} kg`} icon={<Package size={24} weight="bold" />} description="Quantity on this page" isLoading={isLoading} />
      </div>

      <DataTable
        columns={columns}
        data={orders}
        enableSorting
        enablePagination
        manualPagination
        pageCount={totalPages}
        pageSize={pageSize}
        pageIndex={currentPage - 1}
        onPaginationChange={(p) => {
          if (p.pageSize !== pageSize) { setPageSize(p.pageSize); setCurrentPage(1); }
          else { setCurrentPage(p.pageIndex + 1); }
        }}
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <div className="flex flex-col items-center justify-center gap-24 py-48">
            <Package size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">{hasActiveFilters ? "No orders found" : "No orders yet"}</h3>
              <p className="body-small text-[var(--color-text-secondary)]">{hasActiveFilters ? "Try adjusting your search or filters." : "Create your first order to get started."}</p>
            </div>
            {!hasActiveFilters && <Button variant="primary" onClick={openCreate}><Plus size={20} weight="bold" />Create Order</Button>}
          </div>
        }
      >
        <DataTable.Toolbar>
          <div className="relative max-w-[320px] flex-1">
            <MagnifyingGlass size={18} className="absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none" />
            <input type="text" placeholder="Search orders..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }} className="w-full h-40 pl-36 pr-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]" aria-label="Search table" />
          </div>
          <div className="flex items-center gap-8">
            {hasActiveFilters && <Button variant="noOutline" size="small" onClick={clearFilters}><X size={16} weight="bold" />Clear</Button>}
          </div>
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
        editLabel="Edit Order"
        sections={
          sideSheetEntity
            ? [
                {
                  title: "General",
                  fields: [
                    { label: "Code", value: sideSheetEntity.code },
                    { label: "Order Date", value: formatDate(sideSheetEntity.orderDate) },
                  ],
                },
                {
                  title: "Details",
                  fields: [
                    { label: "Customer", value: sideSheetEntity.customerName },
                    { label: "Facility", value: sideSheetEntity.facilityName },
                    { label: "Quantity", value: `${sideSheetEntity.quantityKg.toLocaleString()} kg` },
                  ],
                },
                {
                  title: "Deliveries",
                  fields: [
                    { label: "Delivery Count", value: String(sideSheetEntity.deliveryCount) },
                  ],
                },
              ]
            : undefined
        }
      >
        {formError && <div className="mb-24"><ServerError message={formError} /></div>}
        <OrderForm
          key={sideSheetEntity?.id ?? "create"}
          order={sideSheet?.entity as Order | undefined}
          onSubmit={sideSheetMode === "create" ? handleCreate : handleUpdate}
          onCancel={closeSideSheet}
          isSubmitting={createOrder.isPending || updateOrder.isPending}
          submitLabel={sideSheetMode === "create" ? "Create Order" : "Save Changes"}
        />
      </EntitySideSheet>

      {deleteError && <ServerError message={deleteError} />}
      <DeleteConfirmDialog isOpen={!!deletingOrderId} title="Delete Order" message="Are you sure you want to delete this order? This action cannot be undone. Note: Orders with deliveries cannot be deleted." onConfirm={handleDeleteConfirm} onCancel={() => { setDeletingOrderId(null); setDeleteError(null); }} isPending={deleteOrder.isPending} />
    </div>
  );
}
