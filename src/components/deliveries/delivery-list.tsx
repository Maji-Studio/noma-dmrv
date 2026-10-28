"use client";

/**
 * DeliveryList component
 * Main delivery listing with CRUD operations using DataTable
 * Includes stat cards, status badges, and EntitySideSheet
 */

import { deliveryDeepLinkHref } from "@/lib/delivery-links";
import { CertificationScopeHeader } from "@/components/certification/certification-scope-header";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import { ServerError } from "@/components/forms";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { recordLockSheetProps, recordLockTitleMark, RecordLockListNotice } from "@/components/record-locks";
import { useRecordLock, useRecordLocks } from "@/hooks/use-record-locks";
import { isRecordDeletable, isRecordEditable, type RecordLockViews } from "@/lib/record-lock-view";
import { StaleVersionError, toDeleteErrorMessage } from "@/lib/stale-version";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { MassPair } from "@/components/ui/mass-pair";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import type {
  DeliveryDetail,
  DeliveryWithRelations,
} from "@/data-access/deliveries";
import type { Delivery } from "@/db/schema";
import { useCreateWithEvidence } from "@/hooks/use-create-with-evidence";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useCreateDelivery,
  useDeleteDelivery,
  useDeliveries,
  useDeliveryStats,
  useDeliveryWithRelations,
  useFetchDeliveryWithRelations,
  useUpdateDelivery,
} from "@/hooks/use-deliveries";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { resolveFacilityTimezone } from "@/lib/date-utils";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { DELIVERY_DEEP_LINK_PARAM } from "@/lib/delivery-links";
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  ENTITY_DEEP_LINK_FOCUS_PARAM,
  ENTITY_DEEP_LINK_MODE_PARAM,
  parseEntityFocusTarget,
} from "@/lib/entity-deep-link";
import { formatDistanceKm, formatFacilityDay, formatMassKg } from "@/lib/format-utils";
import { creditBatchOptionLabel } from "@/lib/credit-batch-option-label";
import { DISTANCE_FIELD_LABEL, DISTANCE_SOURCE_FIELD_LABEL, sourceLabel } from "@/components/transport-legs/distance-override";
import { formatMoisturePercent, MASS_MOISTURE_LABELS, qualifyMassLabel } from "@/lib/mass-moisture";
import type {
  CreateDeliveryData,
  DeliveryFormData,
} from "@/schemas/deliveries";
import {
  PlusIcon,
  ScalesIcon,
  TruckIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ColumnDef } from "@tanstack/react-table";
import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useState } from "react";
import { DeliveryForm } from "./delivery-form";
import { useDocumentsCertStatus } from "@/components/forms/use-documents-cert-status";
import { isProofOfDeliveryDocument } from "@/lib/certification/delivery-evidence";
import { deliverySheetSections, type DeliverySheetRecord } from "./delivery-read-sections";
import { ILLUSTRATION_SIZE, DeliveryTruckArt } from "@/components/ui/illustrations";

// ============================================
// Helper Functions
// ============================================

function deliveryDetailToRelations(
  delivery: DeliveryDetail,
): DeliverySheetRecord {
  return {
    ...delivery,
    status: "delivered",
    orderCode: delivery.order?.code ?? null,
    facilityName: delivery.facility?.name ?? null,
    customerName: delivery.customerName,
    driverName: delivery.driver?.name ?? null,
    vehicleName: delivery.vehicle?.name ?? null,
  };
}

/** Record details an operator can add from the Columns menu. */
const DELIVERY_COLUMNS_HIDDEN_BY_DEFAULT = {
  destinationName: false,
  driverName: false,
  vehicleName: false,
  effectiveDistanceKm: false,
  effectiveDistanceSource: false,
};

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (delivery: DeliverySheetRecord) => void,
  onDelete: (delivery: DeliverySheetRecord) => void,
  facilities: readonly { id: string; timezone: string }[],
  locks: RecordLockViews,
): ColumnDef<DeliveryWithRelations>[] {
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
      accessorKey: "deliveryDate",
      meta: { nowrap: true },
      header: "Date",
      cell: ({ row }) => (
        <span>{formatFacilityDay(row.original.deliveryDate, resolveFacilityTimezone(facilities, row.original.facilityId))}</span>
      ),
    },
    {
      accessorKey: "orderCode",
      header: "Order",
      cell: ({ row }) => (
        <span>{row.original.orderCode || MISSING_VALUE.notRecorded}</span>
      ),
    },
    {
      accessorKey: "customerName",
      header: "Customer",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.customerName || MISSING_VALUE.notRecorded}
        </span>
      ),
    },
    {
      accessorKey: "destinationName",
      header: "Customer location",
      cell: ({ row }) => <span className="block max-w-xs truncate">{row.original.destinationName || MISSING_VALUE.notSet}</span>,
    },
    // Every mass on this surface — these two columns, the KPI strip, the detail
    // sheet's wet-mass row and composition preview go through `formatMassKg`:
    // fixed kg, one decimal. Wet product and its tracked dry-biochar allocation
    // sit next to each other and must keep compatible precision. `formatMass`
    // would round allocation detail away in the table while the preview below
    // still showed it.
    {
      accessorKey: "deliveredWetMassKg",
      header: qualifyMassLabel(MASS_MOISTURE_LABELS.wet, "Biochar product"),
      cell: ({ row }) => (
        <span className="font-mono text-right">{formatMassKg(row.original.deliveredWetMassKg)}</span>
      ),
    },
    {
      accessorKey: "massDryKg",
      header: "Dry biochar",
      cell: ({ row }) => (
        <span className="font-mono text-right">{formatMassKg(row.original.massDryKg)}</span>
      ),
    },
    {
      accessorKey: "moistureContentPercent",
      header: qualifyMassLabel(
        MASS_MOISTURE_LABELS.moisture,
        "Biochar product",
      ),
      cell: ({ row }) => (
        <span className="font-mono text-right">
          {formatMoisturePercent(row.original.moistureContentPercent)}
        </span>
      ),
    },
    {
      accessorKey: "driverName",
      header: "Driver",
      cell: ({ row }) => <span className="block max-w-xs truncate">{row.original.driverName || MISSING_VALUE.notSet}</span>,
    },
    {
      accessorKey: "vehicleName",
      header: "Vehicle",
      cell: ({ row }) => <span className="block max-w-xs truncate">{row.original.vehicleName || MISSING_VALUE.notSet}</span>,
    },
    {
      accessorKey: "effectiveDistanceKm",
      header: DISTANCE_FIELD_LABEL,
      cell: ({ row }) => (
        <span className="font-mono">{formatDistanceKm(row.original.effectiveDistanceKm)}</span>
      ),
    },
    {
      accessorKey: "effectiveDistanceSource",
      header: DISTANCE_SOURCE_FIELD_LABEL,
      cell: ({ row }) => (
        <span>{sourceLabel(row.original.effectiveDistanceSource) ?? MISSING_VALUE.notRecorded}</span>
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
      header: () => <CertificationScopeHeader />,
      cell: ({ row }) => (
        <EntityCertifyReadinessBadge
          readiness={deriveEntityCertifyReadiness("delivery", row.original)}
          readyLabel="Fields complete"
          readinessNoun="delivery fields and proof"
        />
      ),
    },
    {
      id: "actions",
      meta: { stickyEnd: true },
      header: "",
      // Edit until Sent; Delete only while Open (the server restores the bin stock).
      cell: ({ row }) => {
        const lock = locks[row.original.id];
        const actions = [
          ...(isRecordEditable(lock) ? [{ label: "Edit", onSelect: () => onEdit(row.original) }] : []),
          ...(isRecordDeletable(lock)
            ? [{ label: "Delete", destructive: true, onSelect: () => onDelete(row.original) }]
            : []),
        ];
        return (
          <div className="flex items-center justify-end">
            {actions.length > 0 && (
              <RowActionsMenu label={`Actions for ${row.original.code}`} actions={actions} />
            )}
          </div>
        );
      },
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
    DELIVERY_DEEP_LINK_PARAM,
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
    entity: DeliverySheetRecord | null;
    mode: SideSheetMode;
  } | null>(null);


  // Error state
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DeliverySheetRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Global facility context
  const { facilityId: contextFacilityId, facilities } = useFacilityContext();
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

  // Freeze the opening draft and version; detail refetches must not advance it.
  if (!sideSheet && deepLinkMode === "edit" && focusedDelivery.data && focusedDeliveryId === focusedDelivery.data.id) {
    setSideSheet({ mode: "edit", entity: deliveryDetailToRelations(focusedDelivery.data) });
  }

  // Mutations
  const createDelivery = useCreateDelivery();
  const updateDelivery = useUpdateDelivery();
  const deleteDelivery = useDeleteDelivery();
  const fetchDelivery = useFetchDeliveryWithRelations();
  const toast = useToast();
  const createWithEvidence = useCreateWithEvidence({
    entityType: "delivery",
    entityNoun: "Delivery",
    executeCreate: async ({ data }: { data: DeliveryFormData; onRefusal: SaveRefusalHandler }) => {
      if (!contextFacilityId) {
        throw new Error("No facility selected. Select a facility and try again.");
      }
      const createData = {
        ...data,
        facilityId: contextFacilityId,
      } as CreateDeliveryData;
      const created = await createDelivery.mutateAsync(createData);
      const createdDelivery: DeliverySheetRecord = {
        ...created,
        status: "delivered",
        orderCode: null,
        facilityName: null,
        customerName: null,
        destinationName: null,
        facilityGpsLatitude: null,
        facilityGpsLongitude: null,
        destinationGpsLatitude: null,
        destinationGpsLongitude: null,
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
    getCreateErrorMessage: (error, { onRefusal }) => {
      return onRefusal(error, error instanceof Error ? error.message : "Delivery was not created. Check the form.");
    },
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
  // View mode reads the live record, so a deliberate distance refresh shows
  // at once and Edit freezes the refreshed version.
  const liveViewEntity =
    sideSheet?.mode === "view" && sideSheet.entity && focusedDelivery.data?.id === sideSheet.entity.id
      ? deliveryDetailToRelations(focusedDelivery.data)
      : null;
  const displaySideSheet = liveViewEntity
    ? ({ entity: liveViewEntity, mode: "view" } as const)
    : sideSheet ?? deepLinkedSideSheet;
  const proofStatus = useDocumentsCertStatus("delivery", displaySideSheet?.entity?.id, isProofOfDeliveryDocument);

  // Side sheet helpers
  const openCreate = () => {
    setFocusedDeliveryId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    createWithEvidence.reset();
    setSideSheet({ entity: null, mode: "create" });
  };

  const openView = (delivery: DeliverySheetRecord) => {
    setFocusedDeliveryId(delivery.id);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    setSideSheet({ entity: delivery, mode: "view" });
  };

  const openEdit = (delivery: DeliverySheetRecord) => {
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
  const handleCreate = async (data: DeliveryFormData, onRefusal: SaveRefusalHandler) => {
    await createWithEvidence.handleCreate({ data, onRefusal });
  };

  const handleUpdate = async (data: DeliveryFormData, onRefusal: SaveRefusalHandler, expectedVersion?: number) => {
    if (!displaySideSheet?.entity) return;
    setFormError(null);
    if (createWithEvidence.guardUpdate()) return;
    try {
      await updateDelivery.mutateAsync({
        deliveryId: displaySideSheet.entity.id,
        expectedVersion: expectedVersion ?? displaySideSheet.entity.version,
        ...data,
      });
      closeSideSheet();
      toast.success("Delivery updated.");
    } catch (error) {
      setFormError(onRefusal(error, error instanceof Error ? error.message : "Delivery was not saved. Try again."));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await deleteDelivery.mutateAsync({ deliveryId: deleting.id, expectedVersion: deleting.version });
      setDeleting(null);
      toast.success("Delivery deleted.");
    } catch (error) {
      if (error instanceof StaleVersionError) setDeleting(null);
      setDeleteError(toDeleteErrorMessage(error, `Delivery ${deleting.code}`, "Delivery was not deleted. Try again."));
    }
  };

  const deliveries = deliveriesData?.items ?? [];
  const deliveryLocks = useRecordLocks("delivery", deliveries.map((delivery) => delivery.id));
  const { lock: sheetLock, status: sheetLockStatus, retry: retrySheetLock, retrying: sheetLockRetrying } = useRecordLock("delivery", displaySideSheet?.entity?.id);
  const requestDelete = (delivery: DeliverySheetRecord) => {
    // A message from an earlier attempt belongs to that delivery, not this one.
    setDeleteError(null);
    setDeleting(delivery);
  };
  const columns = createColumns(openEdit, requestDelete, facilities, deliveryLocks.locks);
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
          area="records"
          title="Deliveries"
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
      ? "Create delivery"
      : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create"
      ? undefined
      : sideSheetEntity?.customerName || sideSheetEntity?.orderCode || undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="records"
        title="Deliveries"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={18} weight="bold" />
            New delivery
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total deliveries"
          value={statsData?.totalDeliveries ?? 0}
          icon={<TruckIcon size={24} weight="bold" />}
          isLoading={statsLoading}
        />
        <StatCard
          title="Delivered mass"
          value={
            <MassPair
              wetKg={statsData?.totalDeliveredWetMassKg ?? 0}
              dryKg={statsData?.totalMassDryKg ?? 0}
            />
          }
          valueLayout="breakdown"
          icon={<ScalesIcon size={24} weight="bold" />}
          isLoading={statsLoading}
        />
        <StatCard
          title="Delivered"
          value={statsData?.deliveredCount ?? 0}
          icon={<TruckIcon size={24} weight="bold" />}
          isLoading={statsLoading}
        />
      </div>

      <RecordLockListNotice read={deliveryLocks} />

      {/* Data Table */}
      <DataTable
        defaultColumnVisibility={DELIVERY_COLUMNS_HIDDEN_BY_DEFAULT}
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
        getRowHref={(row) => deliveryDeepLinkHref(row.id, row.facilityId)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={hasActiveFilters ? <TruckIcon size={48} /> : <DeliveryTruckArt size={ILLUSTRATION_SIZE.empty} />}
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

      {/* A stale version closes the confirmation, so its message lands here. */}
      {deleteError && !deleting && <ServerError message={deleteError} />}

      <DeleteConfirmDialog
        isOpen={!!deleting}
        title="Delete delivery"
        message="Are you sure you want to delete this delivery? Its stock goes back to the product bin. This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        isPending={deleteDelivery.isPending}
        // A refusal keeps the confirmation open with its reason.
        errorMessage={deleting ? deleteError ?? undefined : undefined}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        numberedSections
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        onCloseAttempt={confirmCreateClose}
        mode={sideSheetMode}
        onModeChange={(mode) => {
          // Mode changes are navigation; a submit error from the previous
          // visit must not resurface on the next edit entry.
          setFormError(null);
          setSideSheet(
            displaySideSheet ? { ...displaySideSheet, mode } : null,
          );
        }}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        {...recordLockSheetProps({ lock: sheetLock, status: sheetLockStatus, retry: retrySheetLock, retrying: sheetLockRetrying, inUseLocksNothing: true })}
        canEdit={isRecordEditable(sheetLock)}
        editLabel="Edit delivery"
        sections={
          sideSheetEntity
            ? deliverySheetSections(sideSheetEntity, facilities, proofStatus)
            : undefined
        }
      >
        <DeliveryForm
          // The version keys the form too, so a refresh from location reopens
          // it on the record it saved instead of a stale draft.
          key={sideSheetEntity ? `${sideSheetEntity.id}:${sideSheetEntity.version}` : "create"}
          delivery={sideSheetEntity as Delivery | undefined}
          onSubmit={sideSheetMode === "create" ? handleCreate : handleUpdate}
          onCancel={attemptCloseSideSheet}
          isSubmitting={createDelivery.isPending || updateDelivery.isPending || isFlushing}
          errorMessage={formError ?? undefined}
          submitLabel={sideSheetMode === "create" ? "Create delivery" : "Save changes"}
          deferredAttachments={deferredAttachments}
          focusTarget={sideSheetMode === "edit" ? activeFocusTarget : null}
          onDistanceRefreshed={async () => {
            if (!sideSheetEntity) return;
            const fresh = await fetchDelivery(sideSheetEntity.id);
            setSideSheet({ entity: deliveryDetailToRelations(fresh), mode: "edit" });
          }}
        />
      </EntitySideSheet>

    </div>
  );
}
