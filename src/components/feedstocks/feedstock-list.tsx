/**
 * FeedstockList component
 * Main feedstock listing with CRUD operations via EntitySideSheet.
 */
"use client";

import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarIcon, PackageIcon, PlusIcon } from "@phosphor-icons/react";
import { parseAsString, useQueryState } from "nuqs";
import { DataTable } from "@/components/ui/data-table";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useCreateWithEvidence } from "@/hooks/use-create-with-evidence";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { formatDate, formatDistanceKm, formatMass } from "@/lib/format-utils";
import { FeedstockForm } from "./feedstock-form";
import {
  TransportEvidencePanel,
  TransportLegsSummary,
} from "@/components/transport-legs";
import {
  useFeedstocks,
  useFeedstock,
  useCreateFeedstock,
  useUpdateFeedstock,
  useDeleteFeedstock,
} from "@/hooks/use-feedstocks";
import {
  createFeedstockSchema,
  type FeedstockFormData,
} from "@/schemas/feedstocks";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import {
  ENTITY_DEEP_LINK_FOCUS_PARAM,
  ENTITY_DEEP_LINK_MODE_PARAM,
  parseEntityFocusTarget,
} from "@/lib/entity-deep-link";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import { DEFAULT_TRIP_TYPE, TRIP_TYPE_LABELS } from "@/schemas/trip-type";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (feedstock: FeedstockWithRelations) => void,
  onDelete: (id: string) => void,
): ColumnDef<FeedstockWithRelations>[] {
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
      header: "Delivery Date",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <CalendarIcon size={16} className="text-[var(--color-text-tertiary)]" />
          <span>{formatDate(row.original.deliveryDate)}</span>
        </div>
      ),
    },
    {
      accessorKey: "supplierName",
      header: "Supplier",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.supplierName || "\u2014"}</span>
          {row.original.supplierCode && (
            <span className="body-small text-[var(--color-text-tertiary)]">
              {row.original.supplierCode}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "feedstockTypeName",
      header: "Feedstock Type",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.feedstockTypeName || "\u2014"}</span>
          {row.original.feedstockTypeCategory && (
            <span className="body-small text-[var(--color-text-tertiary)] capitalize">
              {row.original.feedstockTypeCategory}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "massWetKg",
      header: "Wet Mass",
      cell: ({ row }) => (
        <span className="font-mono">{formatMass(row.original.massWetKg)}</span>
      ),
    },
    {
      accessorKey: "massDryKg",
      header: "Dry Mass",
      cell: ({ row }) => (
        <span className="font-mono">{formatMass(row.original.massDryKg)}</span>
      ),
    },
    {
      accessorKey: "storageLocationName",
      header: "Storage Bin",
      cell: ({ row }) => (
        <span>{row.original.storageLocationCode ?? row.original.storageLocationName ?? "\u2014"}</span>
      ),
    },
    {
      accessorKey: "moistureContentPercent",
      header: "Moisture",
      cell: ({ row }) => (
        <span className="font-mono">
          {row.original.moistureContentPercent !== null
            ? `${row.original.moistureContentPercent}%`
            : "—"}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status === "complete" ? "complete" : "pending"}
          label={row.original.status === "complete" ? "Complete" : "Missing data"}
          size="small"
        />
      ),
    },
    {
      id: "certifyReadiness",
      header: "Certification",
      cell: ({ row }) => (
        <EntityCertifyReadinessBadge
          readiness={deriveEntityCertifyReadiness("feedstock", row.original)}
          readyLabel="Fields complete"
          readinessNoun="feedstock fields"
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

function buildFeedstockTransferToast(feedstocks: FeedstockWithRelations[]) {
  const [first] = feedstocks;
  if (!first) return "Feedstock created successfully";

  const feedstockType = first.feedstockTypeName ?? "feedstock";
  const totalDryKg = feedstocks.reduce(
    (sum, feedstock) => sum + feedstock.massDryKg,
    0,
  );
  const binLabels = feedstocks
    .map((feedstock) => feedstock.storageLocationCode ?? feedstock.storageLocationName)
    .filter((label): label is string => Boolean(label));
  const uniqueBinLabels = [...new Set(binLabels)];

  if (feedstocks.length === 1) {
    const binLabel = uniqueBinLabels[0] ?? "the selected bin";
    return `Transferred ${formatMass(totalDryKg)} ${feedstockType} to ${binLabel}`;
  }

  const binLabel =
    uniqueBinLabels.length > 0
      ? uniqueBinLabels.join(", ")
      : "the selected bins";
  return `Transferred ${formatMass(totalDryKg)} ${feedstockType} across ${binLabel}`;
}

// ============================================
// Component
// ============================================

export function FeedstockList({ stats }: { stats?: React.ReactNode }) {
  const { facilityId: contextFacilityId } = useFacilityContext();
  const [focusedFeedstockId, setFocusedFeedstockId] = useQueryState(
    "feedstock",
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

  // Side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: FeedstockWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Data
  const { data: feedstocksData, isLoading, error: fetchError } = useFeedstocks(
    contextFacilityId ? { facilityId: contextFacilityId } : undefined,
    { enabled: !!contextFacilityId },
  );
  const focusedFeedstock = useFeedstock(
    focusedFeedstockId ?? "",
    !!focusedFeedstockId,
  );
  const createFeedstock = useCreateFeedstock();
  const updateFeedstock = useUpdateFeedstock();
  const deleteFeedstock = useDeleteFeedstock();
  const toast = useToast();
  const createWithEvidence = useCreateWithEvidence({
    entityType: "feedstock",
    entityNoun: "Feedstock",
    executeCreate: async (data: FeedstockFormData) => {
      const result = await createFeedstock.mutateAsync(
        createFeedstockSchema.parse(data),
      );
      if (!result.feedstocks[0]) {
        throw new Error("Feedstock creation returned no feedstock");
      }
      return { entities: result.feedstocks, result };
    },
    setError: setCreateError,
    setUpdateError,
    getCreateErrorMessage: (error) =>
      error instanceof Error ? error.message : "Failed to create feedstock",
    unresolvedUpdateMessage:
      "Resolve or remove the failed attachments before saving this feedstock.",
    openEditOnFailure: (feedstock) =>
      setSideSheet({ entity: feedstock, mode: "edit" }),
    closeOnSuccess: () => setSideSheet(null),
    onSuccess: ({ result }) => {
      const transferMessage = buildFeedstockTransferToast(result.feedstocks);
      const message = result.warning
        ? `${transferMessage}. Warning: ${result.warning}`
        : transferMessage;
      toast.success(message);
    },
  });
  const {
    deferredAttachments,
    createdEntityIds: createdFeedstockIds,
    isFlushing,
  } = createWithEvidence;

  // Handlers
  const handleCreate = createWithEvidence.handleCreate;

  const handleUpdate = async (data: FeedstockFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    if (createWithEvidence.guardUpdate()) return;
    try {
      await updateFeedstock.mutateAsync({
        feedstockId: sideSheet.entity.id,
        facilityId: data.facilityId,
        deliveryDate: data.deliveryDate,
        supplierId: data.supplierId,
        vehicleId: data.vehicleId || null,
        transportDistanceKm: data.transportDistanceKm ?? null,
        transportDistanceSource: data.transportDistanceSource ?? null,
        transportTripType: data.transportTripType ?? null,
        feedstockTypeId: data.feedstockTypeId,
        massWetKg: data.allocations[0]?.allocatedWetMassKg ?? data.totalWetMassKg,
        moistureContentPercent: data.moisturePercent,
        massDryKg: deriveMassDryKg(
          data.allocations[0]?.allocatedWetMassKg ?? data.totalWetMassKg,
          data.moisturePercent
        ),
        storageLocationId: data.allocations[0]?.storageLocationId || null,
        overrideJustification: data.overrideJustification || null,
        notes: data.notes || null,
      });
      createWithEvidence.reset();
      setSideSheet(null);
      toast.success("Feedstock updated successfully");
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Failed to update feedstock");
    }
  };

  const handleDelete = (id: string) => setDeletingId(id);

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteError(null);
    try {
      await deleteFeedstock.mutateAsync(deletingId);
      setDeletingId(null);
      toast.success("Feedstock deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete feedstock");
    }
  };

  const openCreate = () => {
    setFocusedFeedstockId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setCreateError(null);
    setUpdateError(null);
    createWithEvidence.reset();
    setSideSheet({ entity: null, mode: "create" });
  };
  const openView = (feedstock: FeedstockWithRelations) => {
    setFocusedFeedstockId(feedstock.id);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setSideSheet({ entity: feedstock, mode: "view" });
  };
  const openEdit = (feedstock: FeedstockWithRelations) => { setDeepLinkMode(null); setDeepLinkFocus(null); setCreateError(null); setUpdateError(null); createWithEvidence.reset(); setSideSheet({ entity: feedstock, mode: "edit" }); };
  const closeSideSheet = () => {
    setFocusedFeedstockId(null);
    setDeepLinkMode(null);
    setDeepLinkFocus(null);
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
    createWithEvidence.reset();
  };

  const confirmCreateClose = () => {
    return createWithEvidence.confirmClose(
      displaySideSheet?.mode === "create",
    );
  };
  const attemptCloseSideSheet = () => {
    if (confirmCreateClose()) closeSideSheet();
  };
  useOpenCreateIntent(openCreate);

  const columns = createColumns(openEdit, handleDelete);

  const feedstockItems = feedstocksData?.items ?? [];
  useEffect(() => {
    if (!focusedFeedstockId) return;
    if (focusedFeedstock.error || (focusedFeedstock.isSuccess && !focusedFeedstock.data)) {
      setFocusedFeedstockId(null);
      toast.error("Linked feedstock could not be opened");
    }
  }, [
    focusedFeedstock.data,
    focusedFeedstock.error,
    focusedFeedstock.isSuccess,
    focusedFeedstockId,
    setFocusedFeedstockId,
    toast,
  ]);

  const deepLinkedSideSheet =
    focusedFeedstockId && focusedFeedstock.data
      ? ({
          entity: focusedFeedstock.data,
          mode: deepLinkMode === "edit" ? "edit" : "view",
        } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;
  const activeFocusTarget = sideSheet
    ? null
    : parseEntityFocusTarget(deepLinkFocus);

  if (!contextFacilityId) {
    return (
      <div className="flex flex-col gap-32">
        <PageHeader
          area="production"
          title="Feedstocks"
          subtitle="Track incoming biomass deliveries and bin allocations"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its feedstock deliveries." />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-col gap-32">
        <ServerError message={fetchError.message || "Failed to load feedstocks"} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!displaySideSheet;
  const sideSheetMode = displaySideSheet?.mode ?? "create";
  const sideSheetEntity = displaySideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Feedstock" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create"
      ? undefined
      : sideSheetEntity
        ? [
            sideSheetEntity.feedstockTypeName,
            formatMass(sideSheetEntity.massDryKg),
            sideSheetEntity.storageLocationCode,
          ].filter(Boolean).join(" · ") || "Feedstock"
        : undefined;

  return (
    <div className="flex flex-col gap-32">
      <PageHeader
        area="production"
        title="Feedstocks"
        subtitle="Track incoming biomass deliveries and bin allocations"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={18} weight="bold" />
            New Feedstock
          </Button>
        }
      />

      {/* Stats */}
      {stats}

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={feedstockItems}
        enableSorting
        enableFiltering
        enablePagination
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<PackageIcon size={48} />}
            title="No feedstocks yet"
            description="Create your first feedstock to get started"
            action={
              <Button variant="primary" onClick={openCreate}>
                <PlusIcon size={18} weight="bold" />
                New Feedstock
              </Button>
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search feedstocks..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {/* Delete Error */}
      {deleteError && <ServerError message={deleteError} />}

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        isOpen={!!deletingId}
        title="Delete Feedstock"
        message="Are you sure you want to delete this feedstock? This action cannot be undone. Note: Feedstocks used in production runs cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeletingId(null); setDeleteError(null); }}
        isPending={deleteFeedstock.isPending}
      />

      {/* Side Sheet */}
      <EntitySideSheet
        numberedSections
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        onCloseAttempt={confirmCreateClose}
        mode={sideSheetMode}
        onModeChange={(mode) =>
          sideSheetEntity
            ? setSideSheet({ entity: sideSheetEntity, mode })
            : setSideSheet((prev) => (prev ? { ...prev, mode } : null))
        }
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Feedstock"
        sections={sideSheetEntity ? [
          {
            title: "Delivery Information",
            fields: [
              { label: "Delivery Date", value: formatDate(sideSheetEntity.deliveryDate) },
              { label: "Supplier", value: sideSheetEntity.supplierName },
            ],
          },
          {
            title: "Transport Details",
            fields: [
              { label: "Vehicle", value: sideSheetEntity.vehiclePlateNumber },
              {
                label: "Distance (km)",
                ...certificationDetailField("feedstock", "transportDistanceKm"),
                // Status from the raw column, not the formatted string — the
                // "—" fallback is truthy and would falsely read as satisfied.
                certifyStatus: resolveCertFieldStatus(
                  true,
                  sideSheetEntity.transportDistanceKm !== null,
                ),
                value:
                  sideSheetEntity.transportDistanceKm !== null
                    ? formatDistanceKm(sideSheetEntity.transportDistanceKm)
                    : null,
              },
              { label: "Trip type", value: TRIP_TYPE_LABELS[sideSheetEntity.transportTripType ?? DEFAULT_TRIP_TYPE] },
              {
                label: "Distance source",
                value: sideSheetEntity.transportDistanceSource
                  ? DISTANCE_SOURCE_LABELS[sideSheetEntity.transportDistanceSource]
                  : null,
              },
            ],
          },
          {
            title: "Material",
            fields: [
              { label: "Feedstock Type", value: sideSheetEntity.feedstockTypeName },
              {
                label: "Total Wet Mass (kg)",
                ...certificationDetailField("feedstock", "massWetKg"),
                certifyStatus: resolveCertFieldStatus(true, sideSheetEntity.massWetKg !== null),
                value: sideSheetEntity.massWetKg !== null ? formatMass(sideSheetEntity.massWetKg) : null,
              },
              { label: "Moisture Content (%)", value: sideSheetEntity.moistureContentPercent !== null ? `${sideSheetEntity.moistureContentPercent}%` : null },
              { label: "Dry Mass (derived)", value: formatMass(sideSheetEntity.massDryKg) },
            ],
          },
          {
            title: "Bin Allocations",
            fields: [
              { label: "Storage Bin", value: sideSheetEntity.storageLocationCode ?? sideSheetEntity.storageLocationName },
              { label: "Allocated Wet Mass (kg)", value: sideSheetEntity.massWetKg !== null ? formatMass(sideSheetEntity.massWetKg) : null },
              { label: "Override Justification", value: sideSheetEntity.overrideJustification },
            ],
          },
          {
            title: "Documentation",
            fields: [{ label: "Notes", value: sideSheetEntity.notes }],
          },
          {
            title: "Transport Evidence",
            fields: [],
            content: (
              <TransportEvidencePanel
                entityType="feedstock"
                entityId={sideSheetEntity.id}
                readOnly
                embedded
                distanceSource={sideSheetEntity.transportDistanceSource}
              />
            ),
          },
          {
            title: "Derived Transport",
            fields: [],
            content: <TransportLegsSummary entityType="feedstock" entityId={sideSheetEntity.id} />,
          },
        ] : undefined}
      >
        <FeedstockForm
          key={sideSheetEntity?.id ?? "create"}
          feedstock={sideSheetEntity ?? undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={attemptCloseSideSheet}
          isSubmitting={createFeedstock.isPending || updateFeedstock.isPending || isFlushing}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save Changes" : "Create Feedstock"}
          serverError={createError || updateError || undefined}
          deferredAttachments={deferredAttachments}
          retryEntityIds={createdFeedstockIds}
          focusTarget={sideSheetMode === "edit" ? activeFocusTarget : null}
        />
      </EntitySideSheet>
    </div>
  );
}
