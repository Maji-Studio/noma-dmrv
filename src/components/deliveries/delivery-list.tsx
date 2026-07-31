/**
 * DeliveryList component
 * Main delivery listing with CRUD operations using DataTable
 * Includes stat cards, status badges, and EntitySideSheet
 */
"use client";

import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  TruckIcon,
  CalendarIcon,
  PackageIcon,
  DropIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Delivery } from "@/db/schema";
import { DataTable } from "@/components/ui/data-table";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { DeliveryForm } from "./delivery-form";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import { TransportEvidencePanel } from "@/components/transport-legs";
import {
  useCreateDelivery,
  useDeleteDelivery,
  useDeliveries,
  useUpdateDelivery,
  useDeliveryStats,
  useDeliveryWithRelations,
} from "@/hooks/use-deliveries";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useCreateWithEvidence } from "@/hooks/use-create-with-evidence";
import { SelectFacilityEmptyState } from "@/components/navigation";
import type {
  DeliveryFormData,
  CreateDeliveryData,
} from "@/schemas/deliveries";
import type {
  DeliveryDetail,
  DeliveryWithRelations,
} from "@/data-access/deliveries";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import {
  formatDate,
  formatDateRange,
  formatDistanceKm,
  formatMassKg,
} from "@/lib/format-utils";
import {
  formatMoisturePercent,
  MOISTURE_FIELD_LABEL,
  WET_MASS_FIELD_LABEL,
} from "@/lib/mass-moisture";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { DEFAULT_TRIP_TYPE, TRIP_TYPE_LABELS } from "@/schemas/trip-type";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
import { parseAsString, useQueryState } from "nuqs";
import {
  ENTITY_DEEP_LINK_FOCUS_PARAM,
  ENTITY_DEEP_LINK_MODE_PARAM,
  parseEntityFocusTarget,
} from "@/lib/entity-deep-link";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";

// ============================================
// Helper Functions
// ============================================

function deliveryDetailToRelations(
  delivery: DeliveryDetail,
): DeliveryWithRelations {
  return {
    ...delivery,
    orderCode: delivery.order?.code ?? null,
    facilityName: delivery.facility?.name ?? null,
    customerName: delivery.customerName,
    biocharProductCode: delivery.biocharProduct?.code ?? null,
    driverName: delivery.driver?.name ?? null,
    vehicleName: delivery.vehicle?.name ?? null,
  };
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (delivery: DeliveryWithRelations) => void,
  onDelete: (deliveryId: string) => void,
): ColumnDef<DeliveryWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "deliveryDate",
      header: "Date",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <CalendarIcon size={16} className="text-[var(--color-text-tertiary)]" />
          <span>{formatDate(row.original.deliveryDate)}</span>
        </div>
      ),
    },
    {
      accessorKey: "orderCode",
      header: "Order",
      cell: ({ row }) => <span>{row.original.orderCode || "Not recorded"}</span>,
    },
    {
      accessorKey: "customerName",
      header: "Customer",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.customerName || "Not recorded"}
        </span>
      ),
    },
    // Every mass on this surface — these two columns, the KPI strip, the detail
    // sheet's wet-mass row and its MoistureSplit — goes through `formatMassKg`:
    // fixed kg, one decimal. Wet and dry sit next to each other and must stay
    // subtractable, and dry mass is derived (wet × (1 − moisture/100)), so it
    // routinely lands on a half kilo. `formatMass` would round that away in the
    // table while the split bar below still showed it.
    {
      accessorKey: "deliveredWetMassKg",
      header: "Wet mass",
      cell: ({ row }) => (
        <span className="font-mono text-right">{formatMassKg(row.original.deliveredWetMassKg)}</span>
      ),
    },
    {
      accessorKey: "massDryKg",
      header: "Dry mass",
      cell: ({ row }) => (
        <span className="font-mono text-right">{formatMassKg(row.original.massDryKg)}</span>
      ),
    },
    {
      accessorKey: "moistureContentPercent",
      header: "Moisture",
      cell: ({ row }) => (
        <span className="font-mono text-right">
          {formatMoisturePercent(row.original.moistureContentPercent)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} />
      ),
    },
    {
      id: "certifyReadiness",
      header: "Certification",
      cell: ({ row }) => (
        <EntityCertifyReadinessBadge
          readiness={deriveEntityCertifyReadiness("delivery", row.original)}
          readyLabel="Fields complete"
          readinessNoun="delivery fields"
        />
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

export function DeliveryList() {
  const [creditBatchFilterParam, setCreditBatchFilter] = useQueryState(
    "creditBatch",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const creditBatchFilter = creditBatchFilterParam ?? "";
  const [focusedDeliveryId, setFocusedDeliveryId] = useQueryState(
    "delivery",
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
  // Unified side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: DeliveryWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);

  // Delete state
  const [deletingDeliveryId, setDeletingDeliveryId] = useState<string | null>(null);

  // Error state
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Global facility context
  const { facilityId: contextFacilityId } = useFacilityContext();
  const [searchQuery, setSearchQuery] = useState("");
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination(`${contextFacilityId ?? ""}:${creditBatchFilter}`);
  const debouncedSearch = useDebounce(searchQuery, LIST_SEARCH_DEBOUNCE_MS);

  // Data fetching — scope to selected facility (only query when facility is selected)
  const { data: deliveriesData, isLoading, error: fetchError } = useDeliveries(
    contextFacilityId
      ? {
          facilityId: contextFacilityId,
          creditBatchId: creditBatchFilter || undefined,
          search: debouncedSearch || undefined,
          page: currentPage,
          pageSize,
        }
      : undefined,
    { enabled: !!contextFacilityId },
  );
  const { data: statsData, isLoading: statsLoading } = useDeliveryStats(
    contextFacilityId
      ? {
          facilityId: contextFacilityId,
          creditBatchId: creditBatchFilter || undefined,
        }
      : undefined,
    { enabled: !!contextFacilityId },
  );
  const { data: creditBatches } = useCreditBatches(
    contextFacilityId ?? undefined,
  );
  const focusedDelivery = useDeliveryWithRelations(
    focusedDeliveryId ?? "",
    !!focusedDeliveryId,
  );

  // Mutations
  const createDelivery = useCreateDelivery();
  const updateDelivery = useUpdateDelivery();
  const deleteDelivery = useDeleteDelivery();
  const toast = useToast();
  const createWithEvidence = useCreateWithEvidence({
    entityType: "delivery",
    entityNoun: "Delivery",
    executeCreate: async (data: DeliveryFormData) => {
      if (!contextFacilityId) {
        throw new Error("No facility selected. Select a facility and try again.");
      }
      const createData = {
        ...data,
        facilityId: contextFacilityId,
      } as CreateDeliveryData;
      const created = await createDelivery.mutateAsync(createData);
      const createdDelivery: DeliveryWithRelations = {
        ...created,
        orderCode: null,
        facilityName: null,
        customerName: null,
        biocharProductCode: null,
        driverName: null,
        vehicleName: null,
        effectiveDistanceKm: null,
        effectiveDistanceSource: null,
        transportEvidenceDocumentCount: 0,
      };
      return { entities: [createdDelivery], result: createdDelivery };
    },
    setError: setFormError,
    setUpdateError: setFormError,
    getCreateErrorMessage: (error) =>
      error instanceof Error ? error.message : "Delivery was not created. Check the form.",
    unresolvedUpdateMessage:
      "Resolve or remove the failed attachments before saving this delivery.",
    openEditOnFailure: (delivery) =>
      setSideSheet({ entity: delivery, mode: "edit" }),
    closeOnSuccess: () => setSideSheet(null),
    onSuccess: () => toast.success("Delivery created."),
  });
  const { deferredAttachments, isFlushing } = createWithEvidence;
  const deepLinkedSideSheet =
    focusedDeliveryId && focusedDelivery.data
      ? {
          entity: deliveryDetailToRelations(focusedDelivery.data),
          mode: deepLinkMode === "edit" ? "edit" as const : "view" as const,
        }
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;

  // Side sheet helpers
  const openCreate = () => {
    setFocusedDeliveryId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    createWithEvidence.reset();
    setSideSheet({ entity: null, mode: "create" });
  };

  const openView = (delivery: DeliveryWithRelations) => {
    setFocusedDeliveryId(delivery.id);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    setSideSheet({ entity: delivery, mode: "view" });
  };

  const openEdit = (delivery: DeliveryWithRelations) => {
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    createWithEvidence.reset();
    setSideSheet({ entity: delivery, mode: "edit" });
  };

  const closeSideSheet = () => {
    setFocusedDeliveryId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setSideSheet(null);
    setFormError(null);
    createWithEvidence.reset();
  };

  const confirmCreateClose = () =>
    createWithEvidence.confirmClose(displaySideSheet?.mode === "create");
  const attemptCloseSideSheet = () => {
    if (confirmCreateClose()) closeSideSheet();
  };

  useEffect(() => {
    if (!focusedDeliveryId || !focusedDelivery.isError) return;
    setFocusedDeliveryId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    toast.error("Linked delivery could not be opened");
  }, [
    focusedDelivery.isError,
    focusedDeliveryId,
    setDeepLinkFocus,
    setDeepLinkMode,
    setFocusedDeliveryId,
    toast,
  ]);

  // Handlers
  const handleCreate = async (data: DeliveryFormData) => {
    await createWithEvidence.handleCreate(data);
  };

  const handleUpdate = async (data: DeliveryFormData) => {
    if (!displaySideSheet?.entity) return;
    setFormError(null);
    if (createWithEvidence.guardUpdate()) return;
    try {
      await updateDelivery.mutateAsync({
        deliveryId: displaySideSheet.entity.id,
        ...data,
      });
      closeSideSheet();
      toast.success("Delivery updated.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Delivery was not saved. Try again.");
    }
  };

  const handleDelete = (deliveryId: string) => {
    setDeletingDeliveryId(deliveryId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingDeliveryId) return;
    setDeleteError(null);
    try {
      await deleteDelivery.mutateAsync(deletingDeliveryId);
      setDeletingDeliveryId(null);
      toast.success("Delivery deleted.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Delivery was not deleted. Try again.");
    }
  };

  const columns = createColumns(openEdit, handleDelete);

  const deliveries = deliveriesData?.items ?? [];
  const totalPages = deliveriesData?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });
  const hasActiveFilters = !!searchQuery || !!creditBatchFilter;
  const clearFilters = () => {
    setSearchQuery("");
    setCreditBatchFilter(null);
    setCurrentPage(1);
  };

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="distribution"
          title="Deliveries"
          subtitle="Track outbound biochar product deliveries"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its deliveries." />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "The deliveries could not be loaded. Refresh the page and try again."} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!displaySideSheet;
  const sideSheetMode = displaySideSheet?.mode ?? "create";
  const sideSheetEntity = displaySideSheet?.entity ?? null;
  const activeFocusTarget = parseEntityFocusTarget(deepLinkFocus);

  const sideSheetTitle =
    sideSheetMode === "create"
      ? "Create Delivery"
      : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create"
      ? undefined
      : sideSheetEntity?.customerName || sideSheetEntity?.orderCode || undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="distribution"
        title="Deliveries"
        subtitle="Track outbound biochar product deliveries"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={18} weight="bold" />
            New Delivery
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        <StatCard
          title="Total Deliveries"
          value={statsData?.totalDeliveries ?? 0}
          icon={<TruckIcon size={24} weight="bold" />}
          description="All deliveries"
          isLoading={statsLoading}
        />
        <StatCard
          title="Wet Mass Delivered"
          value={formatMassKg(statsData?.totalDeliveredWetMassKg ?? 0)}
          icon={<PackageIcon size={24} weight="bold" />}
          description="Total wet mass"
          isLoading={statsLoading}
        />
        <StatCard
          title="Dry Mass"
          value={formatMassKg(statsData?.totalMassDryKg ?? 0)}
          icon={<DropIcon size={24} weight="bold" />}
          description="Total dry mass"
          isLoading={statsLoading}
        />
        <StatCard
          title="Delivered"
          value={statsData?.deliveredCount ?? 0}
          icon={<TruckIcon size={24} weight="bold" />}
          description="Completed deliveries"
          isLoading={statsLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={deliveries}
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
        aria-label="Deliveries"
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<TruckIcon size={48} />}
            title={hasActiveFilters ? "No deliveries match" : "No deliveries yet"}
            description={
              hasActiveFilters
                ? "Try adjusting or clearing the search and filters."
                : "A delivery tracks biochar leaving the facility for a customer."
            }
            action={
              hasActiveFilters ? undefined : (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={18} weight="bold" />
                  Create your first delivery
                </Button>
              )
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search
            placeholder="Search by delivery code..."
            aria-label="Search deliveries by code"
          />
          <DataTable.Controls>
            <DataTable.FilterSelect
              value={creditBatchFilter}
              onChange={(event) => {
                setCreditBatchFilter(event.target.value || null);
                setCurrentPage(1);
              }}
              aria-label="Filter by credit batch"
            >
              <option value="">All credit batches</option>
              {creditBatches?.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {formatDateRange(batch.startDate, batch.endDate)}
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

      {/* Unified Side Sheet */}
      <EntitySideSheet
        numberedSections
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        onCloseAttempt={confirmCreateClose}
        mode={sideSheetMode}
        onModeChange={(mode) =>
          setSideSheet(
            displaySideSheet ? { ...displaySideSheet, mode } : null,
          )
        }
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Delivery"
        sections={
          sideSheetEntity
            ? [
                {
                  title: "Delivery information",
                  fields: [
                    { label: "Delivery date", value: formatDate(sideSheetEntity.deliveryDate) },
                    { label: "Status", value: <StatusBadge status={sideSheetEntity.status} /> },
                    { label: "Order", value: sideSheetEntity.orderCode },
                  ],
                },
                {
                  title: "Mass and moisture",
                  fields: [
                    {
                      label: WET_MASS_FIELD_LABEL,
                      ...certificationDetailField("delivery", "deliveredWetMassKg"),
                      value: formatMassKg(sideSheetEntity.deliveredWetMassKg),
                    },
                    {
                      label: MOISTURE_FIELD_LABEL,
                      value: formatMoisturePercent(sideSheetEntity.moistureContentPercent),
                    },
                  ],
                  content: (
                    <MoistureSplit
                      wetMassKg={sideSheetEntity.deliveredWetMassKg}
                      moisturePercent={sideSheetEntity.moistureContentPercent}
                      dryMassKg={sideSheetEntity.massDryKg}
                      wetLabel="Wet biochar product"
                      dryLabel="Dry biochar"
                    />
                  ),
                },
                {
                  title: "Transport",
                  fields: [
                    { label: "One-way distance (per leg, km)", value: formatDistanceKm(sideSheetEntity.effectiveDistanceKm) },
                    { label: "Trip type", value: TRIP_TYPE_LABELS[sideSheetEntity.tripType ?? DEFAULT_TRIP_TYPE] },
                    ...(sideSheetEntity.distanceKmOverride != null
                      ? [{ label: "Distance note", value: sideSheetEntity.distanceNote }]
                      : []),
                    {
                      label: "Distance source",
                      value: sideSheetEntity.effectiveDistanceSource
                        ? DISTANCE_SOURCE_LABELS[sideSheetEntity.effectiveDistanceSource]
                        : null,
                    },
                  ],
                },
                {
                  title: "Transport evidence",
                  fields: [],
                  content: (
                    <TransportEvidencePanel
                      entityType="delivery"
                      entityId={sideSheetEntity.id}
                      readOnly
                      embedded
                    />
                  ),
                },
              ]
            : undefined
        }
      >
        <DeliveryForm
          key={sideSheetEntity?.id ?? "create"}
          delivery={sideSheetEntity as Delivery | undefined}
          onSubmit={sideSheetMode === "create" ? handleCreate : handleUpdate}
          onCancel={attemptCloseSideSheet}
          isSubmitting={createDelivery.isPending || updateDelivery.isPending || isFlushing}
          errorMessage={formError ?? undefined}
          submitLabel={sideSheetMode === "create" ? "Create Delivery" : "Save Changes"}
          deferredAttachments={deferredAttachments}
          focusTarget={sideSheetMode === "edit" ? activeFocusTarget : null}
        />
      </EntitySideSheet>

      {/* Delete Error */}
      {deleteError && <ServerError message={deleteError} />}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingDeliveryId}
        title="Delete Delivery"
        message="Are you sure you want to delete this delivery? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingDeliveryId(null);
          setDeleteError(null);
        }}
        isPending={deleteDelivery.isPending}
      />
    </div>
  );
}
