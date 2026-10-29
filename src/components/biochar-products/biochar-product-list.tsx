/**
 * BiocharProductList component
 * Main biochar product listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { recordHref, BIOCHAR_PRODUCT_DEEP_LINK_PARAM } from "@/lib/record-links";
import { useLinkedRecordFacility } from "@/hooks/use-linked-record-facility";
import { StaleVersionError, toDeleteErrorMessage } from "@/lib/stale-version";

import { ServerError } from "@/components/forms";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { archivedFacilityReadOnlyReason } from "@/lib/linked-record-read-only";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { recordLockSheetProps, recordLockTitleMark, RecordLockListNotice } from "@/components/record-locks";
import { useRecordLock, useRecordLocks } from "@/hooks/use-record-locks";
import { isRecordDeletable, isRecordEditable, type RecordLockViews } from "@/lib/record-lock-view";
import { MassPair } from "@/components/ui/mass-pair";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import {
  PURE_BIOCHAR_LABEL,
} from "@/config/product-labels";
import type { BiocharProductStats } from "@/data-access/biochar-product-stats";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import {
  useBiocharProduct,
  useBiocharProducts,
  useBiocharProductStats,
  useCreateBiocharProduct,
  useDeleteBiocharProduct,
  useUpdateBiocharProduct,
} from "@/hooks/use-biochar-products";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useDebounce } from "@/hooks/use-debounce";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { resolveFacilityTimezone } from "@/lib/date-utils";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import {
  deriveBlendEffectiveMoisturePercent,
  fromCompositionJsonb,
} from "@/lib/biochar-composition";
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  ENTITY_DEEP_LINK_FOCUS_PARAM,
  ENTITY_DEEP_LINK_MODE_PARAM,
  parseEntityFocusTarget,
} from "@/lib/entity-deep-link";
import { formatDayString } from "@/lib/format-utils";
import { creditBatchOptionLabel } from "@/lib/credit-batch-option-label";
import {
  formatMoisturePercent,
} from "@/lib/mass-moisture";
import { finalWetProductMassKg, sourceBiocharDryMassKg } from "@/lib/biochar-product-mass";
import type { BiocharProductFormData } from "@/schemas/biochar-products";
import {
  CubeIcon,
  PlusIcon,
  ScalesIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ColumnDef } from "@tanstack/react-table";
import { parseAsString, useQueryState } from "nuqs";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { useEffect, useState } from "react";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { BiocharProductForm } from "./biochar-product-form";
import { formatSavedMassKg, productSheetSections } from "./product-read-details";
import { ILLUSTRATION_SIZE, BiocharProductArt } from "@/components/ui/illustrations";

const WET_PRODUCT_LABEL = "Wet product";
const DRY_BIOCHAR_LABEL = "Dry biochar";

function productEffectiveMoisturePercent(
  product: Pick<
    BiocharProductWithRelations,
    | "massKg"
    | "waterAddedKg"
    | "moistureContentPercent"
    | "composition"
    | "sourceAllocatedDryMassKg"
  >,
): number | null {
  return deriveBlendEffectiveMoisturePercent({
    blendMassKg: product.massKg,
    waterAddedKg: product.waterAddedKg,
    biocharMoisturePercent: product.moistureContentPercent,
    ingredients: fromCompositionJsonb(product.composition),
    sourceAllocatedDryMassKg: product.sourceAllocatedDryMassKg,
  });
}

/** Water added and density are optional detail an operator can add from the Columns menu. */
const PRODUCT_COLUMNS_HIDDEN_BY_DEFAULT = {
  waterAddedKg: false,
  densityKgM3: false,
};

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (product: BiocharProductWithRelations) => void,
  onDelete: (productId: string) => void,
  locks: RecordLockViews,
): ColumnDef<BiocharProductWithRelations>[] {
  return [
    {
      accessorKey: "code",
      meta: { nowrap: true, recordLink: true, recordLinkBefore: recordLockTitleMark(locks) },
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "productionDate",
      meta: { nowrap: true },
      header: "Production date",
      cell: ({ row }) => formatDayString(row.original.productionDate),
    },
    {
      id: "formulation",
      header: "Formulation",
      accessorFn: (row) => row.formulation?.name ?? PURE_BIOCHAR_LABEL,
      cell: ({ row }) => row.original.formulation?.name || PURE_BIOCHAR_LABEL,
    },
    {
      accessorKey: "massKg",
      header: "Mass",
      cell: ({ row }) => {
        return (
          <MassPair
            wetKg={finalWetProductMassKg(row.original)}
            dryKg={sourceBiocharDryMassKg(row.original)}
            wetLabel={WET_PRODUCT_LABEL}
            dryLabel={DRY_BIOCHAR_LABEL}
            layout="stacked"
            variant="compact"
          />
        );
      },
    },
    {
      id: "moistureContentPercent",
      header: "Blend moisture",
      // Composition-aware blend moisture: massKg is the blend total (biochar
      // plus ingredient solids), so the single-material helper must not see
      // it — that produced the 26.1% vs 34.3% contradiction (BP-26-001).
      accessorFn: productEffectiveMoisturePercent,
      cell: ({ row }) => (
        <span className="font-mono">
          {formatMoisturePercent(productEffectiveMoisturePercent(row.original))}
        </span>
      ),
    },
    {
      accessorKey: "waterAddedKg",
      header: "Water added",
      cell: ({ row }) => (
        <span className="font-mono">{formatSavedMassKg(row.original.waterAddedKg)}</span>
      ),
    },
    {
      accessorKey: "densityKgM3",
      header: "Density",
      cell: ({ row }) => (
        <span className="font-mono">
          {row.original.densityKgM3 == null
            ? MISSING_VALUE.notRecorded
            : `${row.original.densityKgM3} kg/m³`}
        </span>
      ),
    },
    {
      id: "storageLocation",
      header: "Storage",
      accessorFn: (row) => row.storageLocation?.name ?? "",
      cell: ({ row }) =>
        row.original.storageLocation?.name || MISSING_VALUE.notSet,
    },
    {
      id: "actions",
      meta: { stickyEnd: true },
      header: "",
      // Edit until Sent; Delete only while Open (the server archives the product).
      cell: ({ row }) => {
        const lock = locks[row.original.id];
        const actions = [
          ...(isRecordEditable(lock) ? [{ label: "Edit", onSelect: () => onEdit(row.original) }] : []),
          ...(isRecordDeletable(lock)
            ? [{ label: "Delete", destructive: true, onSelect: () => onDelete(row.original.id) }]
            : []),
        ];
        return (
          <div className="flex items-center justify-end">
            {actions.length > 0 && <RowActionsMenu label={`Actions for ${row.original.code}`} actions={actions} />}
          </div>
        );
      },
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

interface BiocharProductMassSummaryProps {
  stats: Pick<BiocharProductStats, "totalWetMassKg" | "totalDryBiocharMassKg"> | undefined;
  isLoading?: boolean;
  isError?: boolean;
}

export function BiocharProductMassSummary({
  stats,
  isLoading = false,
  isError = false,
}: BiocharProductMassSummaryProps) {
  return (
    <StatCard
      title="Total mass"
      description="Across all products in this facility"
      value={
        <MassPair
          wetKg={stats?.totalWetMassKg ?? null}
          dryKg={stats?.totalDryBiocharMassKg ?? null}
          wetLabel={WET_PRODUCT_LABEL}
          dryLabel={DRY_BIOCHAR_LABEL}
        />
      }
      valueLayout="breakdown"
      icon={<ScalesIcon size={24} weight="bold" />}
      isLoading={isLoading}
      isError={isError}
    />
  );
}

// ============================================
// Component
// ============================================

export function BiocharProductList() {
  const { facilityId: contextFacilityId, facilities } = useFacilityContext();
  const [focusedProductId, setFocusedProductId] = useQueryState(
    BIOCHAR_PRODUCT_DEEP_LINK_PARAM,
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
  const [deleting, setDeleting] = useState<BiocharProductWithRelations | null>(null);
  const deletingProductId = deleting?.id;
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
  const linkedRecord = useLinkedRecordFacility(focusedProduct.data, focusedProduct.isLoading);
  const linkedFacilityReady = linkedRecord.ready;
  // A link into an archived facility opens the record read only, even an edit link.
  const linkOpensEdit = deepLinkMode === "edit" && !linkedRecord.archivedFacility;
  const { data: creditBatches } = useCreditBatches(
    contextFacilityId || undefined,
  );
  const createProduct = useCreateBiocharProduct();
  const updateProduct = useUpdateBiocharProduct();
  const deleteProduct = useDeleteBiocharProduct();
  const toast = useToast();

  const products = productsData?.items ?? [];
  const setDeletingProductId = (id: string | null) => {
    setDeleteError(null);
    setDeleting(products.find(row => row.id === id) ?? null);
  };
  // Freeze the version beneath a deep-linked edit draft across refetches.
  const [deepLinkSnapshot, setDeepLinkSnapshot] = useState<BiocharProductWithRelations | null>(null);
  if (!focusedProductId && deepLinkSnapshot) setDeepLinkSnapshot(null);
  if (focusedProductId && focusedProduct.data && deepLinkSnapshot?.id !== focusedProductId) {
    setDeepLinkSnapshot(focusedProduct.data);
  }
  const deepLinkedSideSheet =
    linkedFacilityReady && focusedProductId && focusedProduct.data
      ? ({
          mode: linkOpensEdit ? "edit" : "view",
          entity: linkOpensEdit ? deepLinkSnapshot ?? focusedProduct.data : focusedProduct.data,
        } as const)
      : null;
  const localSideSheet = sideSheet?.entity?.facilityId && sideSheet.entity.facilityId !== contextFacilityId ? null : sideSheet;
  // A row the operator opened shows at once; only a link waits for its facility.
  const displaySideSheet = focusedProductId && !linkedFacilityReady && !localSideSheet ? null : localSideSheet ?? deepLinkedSideSheet;
  const productLocks = useRecordLocks("biocharProduct", products.map((product) => product.id));
  // A lock that arrives as Sent keeps an open draft, read-only, with the way
  // back (`submitBlock`).
  const { lock: sheetLock, status: sheetLockStatus, retry: retrySheetLock, retrying: sheetLockRetrying } = useRecordLock("biocharProduct", displaySideSheet?.entity?.id);
  const activeFocusTarget = sideSheet
    ? null
    : parseEntityFocusTarget(deepLinkFocus);

  useEffect(() => {
    if (!focusedProductId) return;
    if (focusedProduct.isLoading) return;
    if (!focusedProduct.isError && focusedProduct.data) return;

    toast.error(
      "The linked biochar product could not be loaded. Refresh the page and try again.",
    );
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

  const { data: statsData, isLoading: statsLoading, isError: statsError } = useBiocharProductStats(
    contextFacilityId || undefined,
    { enabled: !!contextFacilityId },
  );
  const totalPages = productsData?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });
  const hasActiveFilters =
    searchInput.trim().length > 0 || Boolean(creditBatchFilter);

  const clearFilters = () => {
    setSearchInput("");
    setCreditBatchFilter(null);
    setCurrentPage(1);
  };

  // Handlers
  const handleCreate = async (data: BiocharProductFormData, onRefusal: SaveRefusalHandler) => {
    setFormError(null);
    try {
      await createProduct.mutateAsync(data);
      setSideSheet(null);
      toast.success("Biochar product created.");
    } catch (error) {
      setFormError(onRefusal(error, error instanceof Error ? error.message : "Biochar product was not created. Check the form."));
    }
  };

  const handleUpdate = async (data: BiocharProductFormData, onRefusal: SaveRefusalHandler) => {
    // Deep-linked edits render via `displaySideSheet` while `sideSheet` state
    // is still null — resolving the target here keeps dashboard edit links
    // saveable, not just list-opened sheets.
    const editing =
      displaySideSheet?.mode === "edit" ? displaySideSheet.entity : null;
    if (!editing) return;
    setFormError(null);
    try {
      await updateProduct.mutateAsync({ productId: editing.id, expectedVersion: editing.version, ...data });
      setSideSheet(null);
      setFocusedProductId(null);
      setDeepLinkMode(null);
      setDeepLinkFocus(null);
      toast.success("Biochar product updated.");
    } catch (error) {
      setFormError(onRefusal(error, error instanceof Error ? error.message : "Biochar product was not saved. Try again."));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await deleteProduct.mutateAsync({ productId: deleting.id, expectedVersion: deleting.version });
      setDeletingProductId(null);
      toast.success("Biochar product deleted.");
    } catch (error) {
      if (error instanceof StaleVersionError) setDeleting(null);
      setDeleteError(toDeleteErrorMessage(error, `Biochar product ${deleting.code}`, "Biochar product was not deleted. Try again."));
    }
  };

  const openCreate = () => {
    setFocusedProductId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    setSideSheet({ mode: "create", entity: null });
  };
  useOpenCreateIntent(openCreate);
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
  const viewedEntity =
    displaySideSheet?.mode === "view" ? displaySideSheet.entity : null;
  const isSubmitting = createProduct.isPending || updateProduct.isPending;

  const columns = createColumns(openEdit, setDeletingProductId, productLocks.locks);

  // A link into an archived facility opens its record read only, over the
  // "Select a facility" empty state too when no facility is active.
  const sideSheetElement = (
    <EntitySideSheet
      numberedSections
      open={!!displaySideSheet}
      onOpenChange={(open) => { if (!open) closeSideSheet(); }}
      mode={displaySideSheet?.mode ?? "create"}
      onModeChange={handleModeChange}
      title={displaySideSheet?.mode === "create" ? "Create biochar product" : (displaySideSheet?.entity?.code ?? "")}
      subtitle={displaySideSheet?.mode === "create" ? undefined : (displaySideSheet?.entity ? formatDayString(displaySideSheet.entity.productionDate) : undefined)}
      {...recordLockSheetProps({ lock: sheetLock, status: sheetLockStatus, retry: retrySheetLock, retrying: sheetLockRetrying })}
      canEdit={isRecordEditable(sheetLock)}
      editLabel="Edit product"
      readOnlyReason={archivedFacilityReadOnlyReason(linkedRecord, displaySideSheet?.entity, "biochar product")}
      sections={viewedEntity ? productSheetSections(viewedEntity, resolveFacilityTimezone(facilities, viewedEntity.facilityId)) : undefined}
    >
      <BiocharProductForm
        key={editingEntity?.id ?? "create"}
        product={editingEntity ?? undefined}
        lock={sheetLock}
        onSubmit={displaySideSheet?.mode === "edit" ? handleUpdate : handleCreate}
        onCancel={closeSideSheet}
        isSubmitting={isSubmitting}
        errorMessage={formError ?? undefined}
        submitLabel={displaySideSheet?.mode === "edit" ? "Save changes" : "Create product"}
        focusTarget={
          displaySideSheet?.mode === "edit" ? activeFocusTarget : null
        }
      />
    </EntitySideSheet>
  );

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="records"
          title="Biochar products"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its biochar products." />
        {linkedRecord.archivedFacility && sideSheetElement}
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "The biochar products could not be loaded. Refresh the page and try again."} />
      </div>
    );
  }

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="records"
        title="Biochar products"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New product
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total products"
          value={statsData?.totalProducts ?? 0}
          description="All products in this facility"
          icon={<CubeIcon size={24} weight="bold" />}
          isLoading={statsLoading}
          isError={statsError}
        />
        <BiocharProductMassSummary stats={statsData} isLoading={statsLoading} isError={statsError} />
      </div>

      <RecordLockListNotice read={productLocks} />

      {/* Data Table */}
      <DataTable
        defaultColumnVisibility={PRODUCT_COLUMNS_HIDDEN_BY_DEFAULT}
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
        getRowHref={(row) => recordHref("biocharProduct", row.id, { facilityId: row.facilityId })}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={creditBatchFilter || hasActiveFilters ? <CubeIcon size={48} /> : <BiocharProductArt size={ILLUSTRATION_SIZE.empty} />}
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
                : "A biochar product is a finished batch, blended and packed for an order."
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
              <option value="">All credit batches</option>
              {creditBatches?.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {creditBatchOptionLabel(batch)}
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

      {deleteError && !deleting && <ServerError message={deleteError} />}

      <DeleteConfirmDialog
        isOpen={!!deletingProductId}
        title="Delete biochar product"
        message="Are you sure you want to delete this biochar product? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingProductId(null);
          setDeleteError(null);
        }}
        isPending={deleteProduct.isPending}
        errorMessage={deleteError ?? undefined}
      />

      {sideSheetElement}
    </div>
  );
}
