/**
 * BiocharProductList component
 * Main biochar product listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CubeIcon,
  PlusIcon,
  ScalesIcon,
  XIcon,
} from "@phosphor-icons/react";
import { parseAsString, useQueryState } from "nuqs";
import {
  useBiocharProduct,
  useCreateBiocharProduct,
  useDeleteBiocharProduct,
  useBiocharProducts,
  useUpdateBiocharProduct,
} from "@/hooks/use-biochar-products";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { TransportLegsSummary } from "@/components/transport-legs";
import { BiocharProductForm } from "./biochar-product-form";
import type { BiocharProductFormData } from "@/schemas/biochar-products";
import { deriveMassDryKgWithAddedWater } from "@/lib/calculations/mass-dry";
import {
  ENTITY_DEEP_LINK_FOCUS_PARAM,
  ENTITY_DEEP_LINK_MODE_PARAM,
  parseEntityFocusTarget,
} from "@/lib/entity-deep-link";
import { fromCompositionJsonb } from "@/lib/biochar-composition";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL } from "@/lib/mass-moisture";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { EntityDetailValue } from "@/components/ui/entity-detail-value";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";

// ============================================
// Helpers
// ============================================

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
      header: "Production date",
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
      header: "Wet mass",
      cell: ({ row }) => (
        <span className="font-mono">{formatMassKg(row.original.massKg)}</span>
      ),
    },
    {
      id: "moistureContentPercent",
      header: "Moisture",
      accessorFn: (row) => row.moistureContentPercent,
      cell: ({ row }) => (
        <span className="font-mono">
          {formatMoisturePercent(row.original.moistureContentPercent)}
        </span>
      ),
    },
    {
      id: "dryMass",
      header: "Dry mass",
      cell: ({ row }) => (
        <span className="font-mono">
          {formatMassKg(deriveBiocharProductDryMass(row.original))}
        </span>
      ),
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
  const [deepLinkMode, setDeepLinkMode] = useQueryState(
    ENTITY_DEEP_LINK_MODE_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [deepLinkFocus, setDeepLinkFocus] = useQueryState(
    ENTITY_DEEP_LINK_FOCUS_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [creditBatchFilterParam, setCreditBatchFilter] = useQueryState(
    "creditBatch",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const creditBatchFilter = creditBatchFilterParam ?? "";
  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination(`${contextFacilityId ?? ""}:${creditBatchFilter}`);
  const debouncedSearch = useDebounce(
    searchInput,
    LIST_SEARCH_DEBOUNCE_MS,
  );

  const { data: productsData, isLoading, error: fetchError } = useBiocharProducts(
    {
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(contextFacilityId ? { facilityId: contextFacilityId } : {}),
      ...(creditBatchFilter ? { creditBatchId: creditBatchFilter } : {}),
      page: currentPage,
      pageSize,
    },
    { enabled: !!contextFacilityId },
  );
  const focusedProduct = useBiocharProduct(
    focusedProductId ?? "",
    !!focusedProductId,
  );
  const { data: creditBatches } = useCreditBatches(
    contextFacilityId || undefined,
  );
  const createProduct = useCreateBiocharProduct();
  const updateProduct = useUpdateBiocharProduct();
  const deleteProduct = useDeleteBiocharProduct();
  const toast = useToast();

  const products = productsData?.items ?? [];
  const deepLinkedSideSheet =
    focusedProductId && focusedProduct.data
      ? ({
          mode: deepLinkMode === "edit" ? "edit" : "view",
          entity: focusedProduct.data,
        } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;
  const activeFocusTarget = sideSheet
    ? null
    : parseEntityFocusTarget(deepLinkFocus);

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
  const totalProducts = productsData?.total ?? 0;
  const totalPages = productsData?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });
  const totalMassKg = products.reduce((sum, p) => sum + (p.massKg ?? 0), 0);
  const hasActiveFilters =
    searchInput.trim().length > 0 || Boolean(creditBatchFilter);

  const clearFilters = () => {
    setSearchInput("");
    setCreditBatchFilter(null);
    setCurrentPage(1);
  };

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
    // Deep-linked edits render via `displaySideSheet` while `sideSheet` state
    // is still null — resolving the target here keeps dashboard edit links
    // saveable, not just list-opened sheets.
    const editing =
      displaySideSheet?.mode === "edit" ? displaySideSheet.entity : null;
    if (!editing) return;
    setFormError(null);
    try {
      await updateProduct.mutateAsync({ productId: editing.id, ...data });
      setSideSheet(null);
      setFocusedProductId(null);
      setDeepLinkMode(null);
      setDeepLinkFocus(null);
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
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    setSideSheet({ mode: "create", entity: null });
  };
  const openView = (product: BiocharProductWithRelations) => {
    setFocusedProductId(product.id);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    setSideSheet({ mode: "view", entity: product });
  };
  const openEdit = (product: BiocharProductWithRelations) => { setDeepLinkMode(null); setDeepLinkFocus(null); setFormError(null); setSideSheet({ mode: "edit", entity: product }); };
  const closeSideSheet = () => {
    setFocusedProductId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
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

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="production"
          title="Biochar Products"
          subtitle="Finished biochar inventory and certifications"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its biochar products." />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load biochar products"} />
      </div>
    );
  }

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="production"
        title="Biochar Products"
        subtitle="Finished biochar inventory and certifications"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New Product
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Products"
          value={totalProducts}
          icon={<CubeIcon size={24} weight="bold" />}
          description="Finished product batches"
          isLoading={isLoading}
        />
        <StatCard
          title="Mass on This Page"
          value={`${totalMassKg.toLocaleString()} kg`}
          icon={<ScalesIcon size={24} weight="bold" />}
          description="Combined product mass on this page"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={products}
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
        aria-label="Biochar products"
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<CubeIcon size={48} />}
            title={
              creditBatchFilter
                ? "No biochar products in this credit batch"
                : hasActiveFilters
                  ? "No matching biochar products"
                  : "No biochar products yet"
            }
            description={
              hasActiveFilters
                ? "Try adjusting or clearing the filters."
                : "Create your first biochar product to start tracking finished product batches."
            }
            action={
              !hasActiveFilters ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={20} weight="bold" />
                  Create your first product
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search
            placeholder="Search products..."
            aria-label="Search biochar products"
          />
          <DataTable.Controls>
            <DataTable.FilterSelect
              value={creditBatchFilter}
              onChange={(event) => {
                setCreditBatchFilter(event.target.value || null);
                setCurrentPage(1);
              }}
              aria-label="Filter biochar products by credit batch"
            >
              <option value="">All Credit Batches</option>
              {creditBatches?.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code}
                </option>
              ))}
            </DataTable.FilterSelect>
            {hasActiveFilters && (
              <Button variant="noOutline" size="small" onClick={clearFilters}>
                <XIcon size={16} weight="bold" />
                Clear
              </Button>
            )}
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
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
        numberedSections
        open={!!displaySideSheet}
        onOpenChange={(open) => { if (!open) closeSideSheet(); }}
        mode={displaySideSheet?.mode ?? "create"}
        onModeChange={handleModeChange}
        title={displaySideSheet?.mode === "create" ? "Create Biochar Product" : (displaySideSheet?.entity?.code ?? "")}
        subtitle={displaySideSheet?.mode === "create" ? undefined : (displaySideSheet?.entity ? formatDate(displaySideSheet.entity.productionDate) : undefined)}
        editLabel="Edit Product"
        sections={displaySideSheet?.mode === "view" && displaySideSheet.entity ? [
          {
            title: "Source",
            fields: [
              { label: "Production run", value: displaySideSheet.entity.linkedProductionRun?.code },
              { label: "Wet mass (kg)", value: formatMassKg(displaySideSheet.entity.massKg) },
              { label: MOISTURE_FIELD_LABEL, value: formatMoisturePercent(displaySideSheet.entity.moistureContentPercent) },
              { label: "Water added (kg)", value: formatMassKg(displaySideSheet.entity.waterAddedKg) },
              { label: "Density (kg/m³)", value: displaySideSheet.entity.densityKgM3 != null ? `${displaySideSheet.entity.densityKgM3} kg/m³` : null },
            ],
            content: (
              <MoistureSplit
                wetMassKg={displaySideSheet.entity.massKg}
                moisturePercent={displaySideSheet.entity.moistureContentPercent}
                materialLabel="Biochar"
              />
            ),
          },
          {
            title: "Destination & product",
            fields: [
              { label: "Formulation", value: displaySideSheet.entity.formulation?.name ?? PURE_BIOCHAR_LABEL },
              ...fromCompositionJsonb(displaySideSheet.entity.composition).flatMap((ingredient, index) => {
                const prefix = `Ingredient ${index + 1}`;
                return [
                  {
                    label: `${prefix} · Blend material`,
                    value: ingredient.feedstockTypeName,
                  },
                  {
                    label: `${prefix} · Mass (kg)`,
                    value: ingredient.massKg != null ? formatMassKg(ingredient.massKg) : null,
                  },
                  {
                    label: `${prefix} · Source bin`,
                    value: (
                      <EntityDetailValue
                        entityType="storageLocation"
                        id={ingredient.storageLocationId}
                      />
                    ),
                  },
                ];
              }),
              { label: "Product bin", value: displaySideSheet.entity.storageLocation?.name },
            ],
          },
          {
            title: "Derived transport",
            fields: [],
            content: (
              <TransportLegsSummary
                entityType="biochar"
                entityId={displaySideSheet.entity.id}
                emptyMessage="Derived automatically from this product's deliveries — record a delivery whose destination has a distance from the facility."
              />
            ),
          },
        ] : undefined}
      >
        <BiocharProductForm
          key={editingEntity?.id ?? "create"}
          product={editingEntity ?? undefined}
          onSubmit={displaySideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={isSubmitting}
          errorMessage={formError ?? undefined}
          submitLabel={displaySideSheet?.mode === "edit" ? "Save Changes" : "Create Product"}
          focusTarget={
            displaySideSheet?.mode === "edit" ? activeFocusTarget : null
          }
        />
      </EntitySideSheet>
    </div>
  );
}
