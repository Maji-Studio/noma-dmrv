/**
 * BiocharProductList component
 * Main biochar product listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Cube, Plus, Scales } from "@phosphor-icons/react";
import { parseAsString, useQueryState } from "nuqs";
import {
  useBiocharProduct,
  useCreateBiocharProduct,
  useDeleteBiocharProduct,
  useBiocharProducts,
  useUpdateBiocharProduct,
} from "@/hooks/use-biochar-products";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { TransportLegsSummary } from "@/components/transport-legs";
import { BiocharProductForm } from "./biochar-product-form";
import type { BiocharProductFormData } from "@/schemas/biochar-products";
import { deriveMassDryKgWithAddedWater } from "@/lib/calculations/mass-dry";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";

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

function deriveBiocharProductDryMass(product: BiocharProductWithRelations): number | null {
  const { massKg, moistureContentPercent, waterAddedKg } = product;

  if (massKg == null || moistureContentPercent == null) return null;
  if (massKg < 0 || moistureContentPercent < 0 || moistureContentPercent > 100) return null;
  if (waterAddedKg != null && waterAddedKg < 0) return null;

  return deriveMassDryKgWithAddedWater(massKg, moistureContentPercent, waterAddedKg);
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
      accessorFn: (row) => row.formulation?.name ?? PURE_BIOCHAR_LABEL,
      cell: ({ row }) => row.original.formulation?.name || PURE_BIOCHAR_LABEL,
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
        return formatMass(deriveBiocharProductDryMass(row.original));
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
  const { facilityId: contextFacilityId } = useFacilityContext();
  const [focusedProductId, setFocusedProductId] = useQueryState(
    "biocharProduct",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: productsData, isLoading, error: fetchError } = useBiocharProducts(
    contextFacilityId ? { facilityId: contextFacilityId } : undefined,
    { enabled: !!contextFacilityId },
  );
  const focusedProduct = useBiocharProduct(
    focusedProductId ?? "",
    !!focusedProductId,
  );
  const createProduct = useCreateBiocharProduct();
  const updateProduct = useUpdateBiocharProduct();
  const deleteProduct = useDeleteBiocharProduct();
  const toast = useToast();

  const products = productsData?.items ?? [];
  const deepLinkedSideSheet =
    focusedProductId && focusedProduct.data
      ? ({ mode: "view", entity: focusedProduct.data } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;

  useEffect(() => {
    if (!focusedProductId) return;
    if (focusedProduct.isLoading) return;
    if (!focusedProduct.isError && focusedProduct.data) return;

    toast.error("Couldn't load the linked biochar product");
    queueMicrotask(() => {
      setFocusedProductId(null);
    });
  }, [
    focusedProduct.data,
    focusedProduct.isError,
    focusedProduct.isLoading,
    focusedProductId,
    setFocusedProductId,
    toast,
  ]);

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

  const openCreate = () => {
    setFocusedProductId(null);
    setFormError(null);
    setSideSheet({ mode: "create", entity: null });
  };
  const openView = (product: BiocharProductWithRelations) => {
    setFocusedProductId(product.id);
    setFormError(null);
    setSideSheet({ mode: "view", entity: product });
  };
  const openEdit = (product: BiocharProductWithRelations) => { setFormError(null); setSideSheet({ mode: "edit", entity: product }); };
  const closeSideSheet = () => {
    setFocusedProductId(null);
    setSideSheet(null);
    setFormError(null);
  };

  const handleModeChange = (mode: SideSheetMode) => {
    if (!displaySideSheet?.entity) return;
    setFormError(null);
    if (mode === "edit") {
      setSideSheet({ mode: "edit", entity: displaySideSheet.entity });
    } else if (mode === "view") {
      setSideSheet({ mode: "view", entity: displaySideSheet.entity });
    }
  };

  const editingEntity =
    displaySideSheet?.mode === "edit" ? displaySideSheet.entity : null;
  const isSubmitting = createProduct.isPending || updateProduct.isPending;

  const columns = createColumns(openEdit, handleDelete);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load biochar products"} />
      </div>
    );
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      <PageHeader
        area="production"
        title="Biochar Products"
        subtitle="Finished biochar inventory and certifications"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus size={20} weight="bold" />
            New Product
          </Button>
        }
      />

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
          <EmptyState
            padding="md"
            icon={<Cube size={48} />}
            title="No biochar products yet"
            description="Create your first biochar product to start tracking finished product batches."
            action={
              <Button variant="primary" onClick={openCreate}>
                <Plus size={20} weight="bold" />
                Create Product
              </Button>
            }
          />
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
        open={!!displaySideSheet}
        onOpenChange={(open) => { if (!open) closeSideSheet(); }}
        mode={displaySideSheet?.mode ?? "create"}
        onModeChange={handleModeChange}
        title={displaySideSheet?.mode === "create" ? "Create Biochar Product" : (displaySideSheet?.entity?.code ?? "")}
        subtitle={displaySideSheet?.mode === "create" ? undefined : (displaySideSheet?.entity ? formatDate(displaySideSheet.entity.productionDate) : undefined)}
        editLabel="Edit Product"
        sections={displaySideSheet?.mode === "view" && displaySideSheet.entity ? [
          {
            title: "Product",
            fields: [
              { label: "Code", value: displaySideSheet.entity.code },
              { label: "Production Date", value: formatDate(displaySideSheet.entity.productionDate) },
              { label: "Formulation", value: displaySideSheet.entity.formulation?.name ?? PURE_BIOCHAR_LABEL },
              { label: "Wet Mass", value: formatMass(displaySideSheet.entity.massKg) },
              { label: "Moisture", value: displaySideSheet.entity.moistureContentPercent != null ? `${displaySideSheet.entity.moistureContentPercent}%` : undefined },
              { label: "Water Added", value: displaySideSheet.entity.waterAddedKg != null ? formatMass(displaySideSheet.entity.waterAddedKg) : undefined },
              { label: "Dry Mass", value: formatMass(deriveBiocharProductDryMass(displaySideSheet.entity)) },
              { label: "Density", value: displaySideSheet.entity.densityKgM3 != null ? `${displaySideSheet.entity.densityKgM3} kg/m³` : undefined },
            ],
          },
          {
            title: "Source & Storage",
            fields: [
              { label: "Production Run", value: displaySideSheet.entity.linkedProductionRun?.code },
              { label: "Product Bin", value: displaySideSheet.entity.storageLocation?.name },
              { label: "Facility", value: displaySideSheet.entity.facility?.name },
            ],
          },
        ] : undefined}
        viewModeChildren={
          displaySideSheet?.mode === "view" && displaySideSheet.entity ? (
            // Read-only: the distribution leg is auto-derived from this
            // product's deliveries (customer-location distance + delivered
            // mass) — there is nothing to manage by hand.
            <TransportLegsSummary
              entityType="biochar"
              entityId={displaySideSheet.entity.id}
              emptyMessage="Derived automatically from this product's deliveries — record a delivery whose destination has a distance from the facility."
            />
          ) : null
        }
      >
        {formError && <div className="mb-24"><ServerError message={formError} /></div>}
        <BiocharProductForm
          key={editingEntity?.id ?? "create"}
          product={editingEntity ?? undefined}
          onSubmit={displaySideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={isSubmitting}
          submitLabel={displaySideSheet?.mode === "edit" ? "Save Changes" : "Create Product"}
        />
      </EntitySideSheet>
    </div>
  );
}
