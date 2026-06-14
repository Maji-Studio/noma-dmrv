/**
 * FeedstockList component
 * Main feedstock listing with CRUD operations via EntitySideSheet.
 */
"use client";

import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Calendar, Package, Plus } from "@phosphor-icons/react";
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
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { formatSafeDate, formatMass } from "@/lib/format-utils";
import { FeedstockForm } from "./feedstock-form";
import {
  TransportLegsSummary,
} from "@/components/transport-legs";
import {
  useFeedstocks,
  useFeedstock,
  useCreateFeedstock,
  useUpdateFeedstock,
  useDeleteFeedstock,
} from "@/hooks/use-feedstocks";
import type { FeedstockFormData } from "@/schemas/feedstocks";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";

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
          <Calendar size={16} className="text-[var(--color-text-tertiary)]" />
          <span>{formatSafeDate(row.original.deliveryDate)}</span>
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

  // Handlers
  const handleCreate = async (data: FeedstockFormData) => {
    setCreateError(null);
    try {
      const result = await createFeedstock.mutateAsync(data);
      setSideSheet(null);
      const transferMessage = buildFeedstockTransferToast(result.feedstocks);
      const msg = result.warning
        ? `${transferMessage}. Warning: ${result.warning}`
        : transferMessage;
      toast.success(msg);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create feedstock");
    }
  };

  const handleUpdate = async (data: FeedstockFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateFeedstock.mutateAsync({
        feedstockId: sideSheet.entity.id,
        facilityId: data.facilityId,
        deliveryDate: data.deliveryDate,
        supplierId: data.supplierId,
        vehicleId: data.vehicleId || null,
        feedstockTypeId: data.feedstockTypeId,
        massWetKg: data.allocations[0]?.allocatedWetMassKg ?? data.totalWetMassKg,
        moistureContentPercent: data.moisturePercent,
        truckMassOnArrivalKg: data.truckMassOnArrivalKg ?? null,
        truckMassOnDepartureKg: data.truckMassOnDepartureKg ?? null,
        massDryKg: deriveMassDryKg(
          data.allocations[0]?.allocatedWetMassKg ?? data.totalWetMassKg,
          data.moisturePercent
        ),
        storageLocationId: data.allocations[0]?.storageLocationId || null,
        overrideJustification: data.overrideJustification || null,
        notes: data.notes || null,
      });
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
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: null, mode: "create" });
  };
  const openView = (feedstock: FeedstockWithRelations) => {
    setFocusedFeedstockId(feedstock.id);
    setSideSheet({ entity: feedstock, mode: "view" });
  };
  const openEdit = (feedstock: FeedstockWithRelations) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: feedstock, mode: "edit" }); };
  const closeSideSheet = () => {
    setFocusedFeedstockId(null);
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
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
      ? ({ entity: focusedFeedstock.data, mode: "view" } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;

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
            <Plus size={18} weight="bold" />
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
            icon={<Package size={48} />}
            title="No feedstocks yet"
            description="Create your first feedstock to get started"
            action={
              <Button variant="primary" onClick={openCreate}>
                <Plus size={18} weight="bold" />
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
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
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
              { label: "Facility", value: sideSheetEntity.facilityName },
              { label: "Delivery Date", value: formatSafeDate(sideSheetEntity.deliveryDate) },
              { label: "Supplier", value: sideSheetEntity.supplierName },
              { label: "Supplier Code", value: sideSheetEntity.supplierCode },
              { label: "Vehicle", value: sideSheetEntity.vehiclePlateNumber },
              {
                label: "Certification",
                value: (
                  <EntityCertifyReadinessBadge
                    readiness={deriveEntityCertifyReadiness(
                      "feedstock",
                      sideSheetEntity,
                    )}
                  />
                ),
              },
            ],
          },
          {
            title: "Material",
            fields: [
              { label: "Feedstock Type", value: sideSheetEntity.feedstockTypeName },
              { label: "Category", value: sideSheetEntity.feedstockTypeCategory ? <span className="capitalize">{sideSheetEntity.feedstockTypeCategory}</span> : null },
              {
                label: "Wet Mass",
                ...certificationDetailField("feedstock", "massWetKg"),
                value: sideSheetEntity.massWetKg !== null
                  ? formatMass(sideSheetEntity.massWetKg)
                  : <StatusBadge status="pending" label="Missing" size="small" />,
              },
              { label: "Moisture", value: sideSheetEntity.moistureContentPercent !== null ? `${sideSheetEntity.moistureContentPercent}%` : null },
              { label: "Dry Mass", value: formatMass(sideSheetEntity.massDryKg) },
            ],
          },
          {
            title: "Storage",
            fields: [
              { label: "Storage Bin", value: sideSheetEntity.storageLocationCode ?? sideSheetEntity.storageLocationName },
            ],
          },
          {
            title: "Truck Weighing",
            fields: [
              {
                label: "Before unloading",
                ...certificationDetailField("feedstock", "truckMassOnArrivalKg"),
                value: sideSheetEntity.truckMassOnArrivalKg !== null
                  ? formatMass(sideSheetEntity.truckMassOnArrivalKg)
                  : null,
              },
              {
                label: "After unloading",
                ...certificationDetailField("feedstock", "truckMassOnDepartureKg"),
                value: sideSheetEntity.truckMassOnDepartureKg !== null
                  ? formatMass(sideSheetEntity.truckMassOnDepartureKg)
                  : null,
              },
            ],
          },
          ...(sideSheetEntity.overrideJustification ? [{
            title: "Override",
            fields: [{ label: "Justification", value: sideSheetEntity.overrideJustification }],
          }] : []),
          ...(sideSheetEntity.notes ? [{
            title: "Notes",
            fields: [{ label: "Notes", value: sideSheetEntity.notes }],
          }] : []),
        ] : undefined}
        viewModeChildren={
          sideSheetMode === "view" && sideSheetEntity ? (
            <TransportLegsSummary
              entityType="feedstock"
              entityId={sideSheetEntity.id}
            />
          ) : null
        }
      >
        <FeedstockForm
          key={sideSheetEntity?.id ?? "create"}
          feedstock={sideSheetEntity ?? undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createFeedstock.isPending || updateFeedstock.isPending}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save Changes" : "Create Feedstock"}
          serverError={createError || updateError || undefined}
        />
      </EntitySideSheet>
    </div>
  );
}
