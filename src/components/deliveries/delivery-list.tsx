/**
 * DeliveryList component
 * Main delivery listing with CRUD operations using DataTable
 * Includes stat cards, status badges, and EntitySideSheet
 */
"use client";

import { useEffect, useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { TruckIcon, CalendarIcon, PackageIcon, DropIcon, PlusIcon } from "@phosphor-icons/react";
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
import { useDeferredAttachments } from "@/hooks/use-deferred-attachments";
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
import { formatDate, formatDistanceKm } from "@/lib/format-utils";
import { DEFAULT_TRIP_TYPE, TRIP_TYPE_LABELS } from "@/schemas/trip-type";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
import { parseAsString, useQueryState } from "nuqs";
import {
  ENTITY_DEEP_LINK_FOCUS_PARAM,
  ENTITY_DEEP_LINK_MODE_PARAM,
  parseEntityFocusTarget,
} from "@/lib/entity-deep-link";

// ============================================
// Helper Functions
// ============================================

function formatMass(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString()} kg`;
}

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
      cell: ({ row }) => <span>{row.original.orderCode || "—"}</span>,
    },
    {
      accessorKey: "customerName",
      header: "Customer",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.customerName || "—"}
        </span>
      ),
    },
    {
      accessorKey: "deliveredWetMassKg",
      header: "Wet Mass",
      cell: ({ row }) => (
        <span className="font-mono text-right">{formatMass(row.original.deliveredWetMassKg)}</span>
      ),
    },
    {
      accessorKey: "massDryKg",
      header: "Dry Mass",
      cell: ({ row }) => (
        <span className="font-mono text-right">{formatMass(row.original.massDryKg)}</span>
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

  // Data fetching — scope to selected facility (only query when facility is selected)
  const { data: deliveriesData, isLoading, error: fetchError } = useDeliveries(
    contextFacilityId ? { facilityId: contextFacilityId } : undefined,
    { enabled: !!contextFacilityId },
  );
  const { data: statsData, isLoading: statsLoading } = useDeliveryStats(
    contextFacilityId ? { facilityId: contextFacilityId } : undefined,
    { enabled: !!contextFacilityId },
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
  const deferredAttachments = useDeferredAttachments();
  const [isFlushing, setIsFlushing] = useState(false);

  // Side sheet helpers
  const openCreate = () => {
    setFocusedDeliveryId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setFormError(null);
    deferredAttachments.clear();
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
    setSideSheet({ entity: delivery, mode: "edit" });
  };

  const closeSideSheet = () => {
    setFocusedDeliveryId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setSideSheet(null);
    setFormError(null);
    deferredAttachments.clear();
  };

  const unsavedAttachmentCount = deferredAttachments.attachments.filter(
    (attachment) => attachment.status !== "uploaded",
  ).length;
  const confirmCreateClose = () => {
    // An in-flight flush is mid-write; blocking Escape/backdrop/X keeps the
    // completion handler from mutating a discarded-then-reopened form.
    if (isFlushing) return false;
    return (
      sideSheet?.mode !== "create" ||
      unsavedAttachmentCount === 0 ||
      window.confirm(`Discard ${unsavedAttachmentCount} unsaved attachment(s)?`)
    );
  };
  const attemptCloseSideSheet = () => {
    if (confirmCreateClose()) closeSideSheet();
  };

  useEffect(() => {
    if (!focusedDeliveryId || !focusedDelivery.data || sideSheet) return;
    setSideSheet({
      entity: deliveryDetailToRelations(focusedDelivery.data),
      mode: deepLinkMode === "edit" ? "edit" : "view",
    });
  }, [deepLinkMode, focusedDelivery.data, focusedDeliveryId, sideSheet]);

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
    setFormError(null);
    try {
      if (!contextFacilityId) {
        setFormError("No facility selected. Please select a facility first.");
        return;
      }
      const createData = { ...data, facilityId: contextFacilityId } as CreateDeliveryData;
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
      setIsFlushing(true);
      const flushResult = await deferredAttachments.flush(
        "delivery",
        createdDelivery.id,
      );
      if (!flushResult.ok) {
        setSideSheet({ entity: createdDelivery, mode: "edit" });
        setFormError(
          `Delivery created, but ${flushResult.failed.length} ${flushResult.failed.length === 1 ? "attachment" : "attachments"} failed to upload.`,
        );
        return;
      }
      deferredAttachments.clear();
      setSideSheet(null);
      toast.success("Delivery created successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to create delivery");
    } finally {
      setIsFlushing(false);
    }
  };

  const handleUpdate = async (data: DeliveryFormData) => {
    if (!sideSheet?.entity) return;
    setFormError(null);
    if (
      deferredAttachments.attachments.some(
        // Any not-yet-`uploaded` entry is unresolved: "failed" awaits a retry,
        // and "uploading" means a retry is mid-flight whose state a save would
        // clobber. Both must block the save.
        (attachment) => attachment.status !== "uploaded",
      )
    ) {
      setFormError(
        "Resolve or remove the failed attachments before saving this delivery.",
      );
      return;
    }
    try {
      await updateDelivery.mutateAsync({ deliveryId: sideSheet.entity.id, ...data });
      closeSideSheet();
      toast.success("Delivery updated successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to update delivery");
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
      toast.success("Delivery deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete delivery");
    }
  };

  // Memoize columns
  const columns = useMemo(
    () => createColumns((delivery) => openEdit(delivery), handleDelete),
    [openEdit, handleDelete],
  );

  const deliveries = deliveriesData?.items ?? [];

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
        <ServerError message={fetchError.message || "Failed to load deliveries"} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;
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
          value={`${(statsData?.totalDeliveredWetMassKg ?? 0).toLocaleString()} kg`}
          icon={<PackageIcon size={24} weight="bold" />}
          description="Total wet mass"
          isLoading={statsLoading}
        />
        <StatCard
          title="Dry Mass"
          value={`${(statsData?.totalMassDryKg ?? 0).toLocaleString()} kg`}
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
        enableSorting
        enableFiltering
        enablePagination
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<TruckIcon size={48} />}
            title="No deliveries yet"
            description="Create your first delivery to get started"
            action={
              <Button variant="primary" onClick={openCreate}>
                <PlusIcon size={18} weight="bold" />
                New Delivery
              </Button>
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search deliveries..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        onCloseAttempt={confirmCreateClose}
        mode={sideSheetMode}
        onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Delivery"
        sections={
          sideSheetEntity
            ? [
                {
                  title: "Delivery Information",
                  fields: [
                    { label: "Delivery Date", value: formatDate(sideSheetEntity.deliveryDate) },
                    { label: "Status", value: <StatusBadge status={sideSheetEntity.status} /> },
                    { label: "Order", value: sideSheetEntity.orderCode },
                  ],
                },
                {
                  title: "Mass & Moisture",
                  fields: [
                    {
                      label: "Wet Mass (kg)",
                      ...certificationDetailField("delivery", "deliveredWetMassKg"),
                      value:
                        sideSheetEntity.deliveredWetMassKg != null
                          ? `${sideSheetEntity.deliveredWetMassKg.toLocaleString()} kg`
                          : null,
                    },
                    { label: "Moisture (%)", value: sideSheetEntity.moistureContentPercent != null ? `${sideSheetEntity.moistureContentPercent}%` : null },
                    {
                      label: "Dry Mass (derived)",
                      value:
                        sideSheetEntity.massDryKg != null
                          ? `${sideSheetEntity.massDryKg.toLocaleString()} kg`
                          : null,
                    },
                  ],
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
                  title: "Transport Evidence",
                  fields: [],
                  content: (
                    <TransportEvidencePanel
                      entityType="delivery"
                      entityId={sideSheetEntity.id}
                      readOnly
                      distanceSource={sideSheetEntity.effectiveDistanceSource}
                    />
                  ),
                },
                {
                  title: "Record Relationships & Metadata",
                  fields: [
                    { label: "Code", value: sideSheetEntity.code },
                    { label: "Customer", value: sideSheetEntity.customerName },
                    { label: "Facility", value: sideSheetEntity.facilityName },
                    { label: "Biochar Product", value: sideSheetEntity.biocharProductCode },
                    { label: "Driver", value: sideSheetEntity.driverName },
                    { label: "Vehicle", value: sideSheetEntity.vehicleName },
                    {
                      label: "Certification",
                      value: (
                        <EntityCertifyReadinessBadge
                          readiness={deriveEntityCertifyReadiness("delivery", sideSheetEntity)}
                          readyLabel="Fields complete"
                          readinessNoun="delivery fields"
                        />
                      ),
                    },
                  ],
                },
              ]
            : undefined
        }
      >
        {formError && <ServerError message={formError} />}
        <DeliveryForm
          key={sideSheetEntity?.id ?? "create"}
          delivery={sideSheet?.entity as Delivery | undefined}
          onSubmit={sideSheetMode === "create" ? handleCreate : handleUpdate}
          onCancel={attemptCloseSideSheet}
          isSubmitting={createDelivery.isPending || updateDelivery.isPending || isFlushing}
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
