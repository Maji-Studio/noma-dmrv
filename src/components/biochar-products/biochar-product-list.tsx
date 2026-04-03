/**
 * BiocharProductList component
 * Main biochar product listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Cube, Plus, Scales } from "@phosphor-icons/react";
import {
  useCreateBiocharProduct,
  useDeleteBiocharProduct,
  useBiocharProducts,
  useUpdateBiocharProduct,
} from "@/hooks/use-biochar-products";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { BiocharProductForm } from "./biochar-product-form";
import type { BiocharProductFormData } from "@/schemas/biochar-products";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";

// ============================================
// Helpers
// ============================================

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMass(massKg: number | null): string {
  if (massKg === null || massKg === undefined) return "\u2014";
  return `${massKg.toLocaleString()} kg`;
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (product: BiocharProductWithRelations) => void,
  onDelete: (productId: string) => void
): ColumnDef<BiocharProductWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "productionDate",
      header: "Production Date",
      cell: ({ row }) => formatDate(row.original.productionDate),
    },
    {
      id: "facility",
      header: "Facility",
      accessorFn: (row) => row.facility?.name ?? "",
      cell: ({ row }) => row.original.facility?.name || "\u2014",
    },
    {
      id: "formulation",
      header: "Formulation",
      accessorFn: (row) => row.formulation?.name ?? "",
      cell: ({ row }) => row.original.formulation?.name || "\u2014",
    },
    {
      accessorKey: "massKg",
      header: "Wet Mass",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {formatMass(row.original.massKg)}
        </span>
      ),
    },
    {
      id: "moistureContentPercent",
      header: "Moisture %",
      accessorFn: (row) => row.moistureContentPercent,
      cell: ({ row }) => {
        const mc = row.original.moistureContentPercent;
        return mc !== null && mc !== undefined ? `${mc}%` : "\u2014";
      },
    },
    {
      id: "dryMass",
      header: "Dry Mass",
      cell: ({ row }) => {
        const { massKg, moistureContentPercent } = row.original;
        if (massKg == null || moistureContentPercent == null) return "\u2014";
        return formatMass(deriveMassDryKg(massKg, moistureContentPercent));
      },
    },
    {
      id: "storageLocation",
      header: "Storage",
      accessorFn: (row) => row.storageLocation?.name ?? "",
      cell: ({ row }) => row.original.storageLocation?.name || "\u2014",
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
// Side Sheet State
// ============================================

type SideSheetState =
  | { mode: "create"; entity: null }
  | { mode: "view"; entity: BiocharProductWithRelations }
  | { mode: "edit"; entity: BiocharProductWithRelations };

// ============================================
// Component
// ============================================

export function BiocharProductList() {
  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: productsData, isLoading, error: fetchError } = useBiocharProducts();
  const createProduct = useCreateBiocharProduct();
  const updateProduct = useUpdateBiocharProduct();
  const deleteProduct = useDeleteBiocharProduct();
  const toast = useToast();

  const products = productsData?.items ?? [];

  // Computed stats
  const totalProducts = products.length;
  const totalMassKg = products.reduce((sum, p) => sum + (p.massKg ?? 0), 0);

  // Handlers
  const handleCreate = async (data: BiocharProductFormData) => {
    setFormError(null);
    try {
      await createProduct.mutateAsync(data);
      setSideSheet(null);
      toast.success("Biochar product created successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to create biochar product");
    }
  };

  const handleUpdate = async (data: BiocharProductFormData) => {
    if (sideSheet?.mode !== "edit") return;
    setFormError(null);
    try {
      await updateProduct.mutateAsync({ productId: sideSheet.entity.id, ...data });
      setSideSheet(null);
      toast.success("Biochar product updated successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to update biochar product");
    }
  };

  const handleDelete = (productId: string) => setDeletingProductId(productId);

  const handleDeleteConfirm = async () => {
    if (!deletingProductId) return;
    setDeleteError(null);
    try {
      await deleteProduct.mutateAsync(deletingProductId);
      setDeletingProductId(null);
      toast.success("Biochar product deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete biochar product");
    }
  };

  const openCreate = () => { setFormError(null); setSideSheet({ mode: "create", entity: null }); };
  const openView = (product: BiocharProductWithRelations) => { setFormError(null); setSideSheet({ mode: "view", entity: product }); };
  const openEdit = (product: BiocharProductWithRelations) => { setFormError(null); setSideSheet({ mode: "edit", entity: product }); };
  const closeSideSheet = () => { setSideSheet(null); setFormError(null); };

  const handleModeChange = (mode: SideSheetMode) => {
    if (!sideSheet) return;
    setFormError(null);
    if (mode === "edit" && sideSheet.entity) {
      setSideSheet({ mode: "edit", entity: sideSheet.entity });
    } else if (mode === "view" && sideSheet.entity) {
      setSideSheet({ mode: "view", entity: sideSheet.entity });
    }
  };

  const editingEntity = sideSheet?.mode === "edit" ? sideSheet.entity : null;
  const isSubmitting = createProduct.isPending || updateProduct.isPending;

  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load biochar products"} />
      </div>
    );
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <h1 className="title-heading-2">Biochar Products</h1>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={20} weight="bold" />
          New Product
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Products"
          value={totalProducts}
          icon={<Cube size={24} weight="bold" />}
          description="Finished product batches"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Mass"
          value={`${totalMassKg.toLocaleString()} kg`}
          icon={<Scales size={24} weight="bold" />}
          description="Combined product mass"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={products}
        enableSorting
        enableFiltering
        enablePagination
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <div className="flex flex-col items-center justify-center gap-24 py-48">
            <Cube size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">No biochar products yet</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                Create your first biochar product to start tracking finished product batches.
              </p>
            </div>
            <Button variant="primary" onClick={openCreate}>
              <Plus size={20} weight="bold" />
              Create Product
            </Button>
          </div>
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search products..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteError && <ServerError message={deleteError} />}

      <DeleteConfirmDialog
        isOpen={!!deletingProductId}
        title="Delete Biochar Product"
        message="Are you sure you want to delete this biochar product? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingProductId(null);
          setDeleteError(null);
        }}
        isPending={deleteProduct.isPending}
      />

      <EntitySideSheet
        open={!!sideSheet}
        onOpenChange={(open) => { if (!open) closeSideSheet(); }}
        mode={sideSheet?.mode ?? "create"}
        onModeChange={handleModeChange}
        title={sideSheet?.mode === "create" ? "Create Biochar Product" : (sideSheet?.entity?.code ?? "")}
        subtitle={sideSheet?.mode === "create" ? "Fill in the form to create a new biochar product." : (sideSheet?.entity ? formatDate(sideSheet.entity.productionDate) : undefined)}
        editLabel="Edit Product"
        sections={sideSheet?.mode === "view" && sideSheet.entity ? [
          {
            title: "Product",
            fields: [
              { label: "Code", value: sideSheet.entity.code },
              { label: "Production Date", value: formatDate(sideSheet.entity.productionDate) },
              { label: "Formulation", value: sideSheet.entity.formulation?.name },
              { label: "Wet Mass", value: formatMass(sideSheet.entity.massKg) },
              { label: "Moisture", value: sideSheet.entity.moistureContentPercent != null ? `${sideSheet.entity.moistureContentPercent}%` : undefined },
              { label: "Dry Mass", value: sideSheet.entity.massKg != null && sideSheet.entity.moistureContentPercent != null ? formatMass(deriveMassDryKg(sideSheet.entity.massKg, sideSheet.entity.moistureContentPercent)) : undefined },
            ],
          },
          {
            title: "Source & Storage",
            fields: [
              { label: "Production Run", value: sideSheet.entity.linkedProductionRun?.code },
              { label: "Product Bin", value: sideSheet.entity.storageLocation?.name },
              { label: "Facility", value: sideSheet.entity.facility?.name },
            ],
          },
        ] : undefined}
      >
        {formError && <div className="mb-24"><ServerError message={formError} /></div>}
        <BiocharProductForm
          key={editingEntity?.id ?? "create"}
          product={editingEntity ?? undefined}
          onSubmit={sideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={isSubmitting}
          submitLabel={sideSheet?.mode === "edit" ? "Save Changes" : "Create Product"}
        />
      </EntitySideSheet>
    </div>
  );
}
