/**
 * ApplicationList component
 * Displays application records in a DataTable with create/edit/delete
 * Includes stat cards, search, and pagination
 */
"use client";

import { useEffect, useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { MapPinIcon, PlusIcon, LeafIcon, XIcon } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import { useCreateWithEvidence } from "@/hooks/use-create-with-evidence";
import { ApplicationForm } from "./application-form";
import { ApplicationEvidencePanel } from "./application-evidence-panel";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import {
  formatApplicationKgFromTons,
  type ApplicationDeliveryOption,
} from "./mass-utils";
import type { ApplicationListItem } from "@/data-access/applications";
import { APPLICATION_VISUAL_EVIDENCE_ROLES } from "@/lib/certification/application-evidence";
import { parseExactIdFilter } from "@/lib/exact-id-filter";
import {
  useApplications,
  useApplicationDeliveryOptions,
  useCreateApplication,
  useUpdateApplication,
  useDeleteApplication,
  applicationKeys,
} from "@/hooks/use-applications";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import type { ApplicationFormData } from "@/schemas/applications";
import {
  applicationStatuses,
  applicationEvidenceMethods,
  formatApplicationEvidenceMethod,
  formatApplicationMethod,
  formatApplicationStatus,
  formatSoilTemperatureSource,
  type ApplicationEvidenceMethod,
  type ApplicationMethod,
  type ApplicationStatus,
  type SoilTemperatureSource,
} from "@/schemas/applications";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { formatDate } from "@/lib/format-utils";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (application: ApplicationListItem) => void,
  onDelete: (applicationId: string) => void,
): ColumnDef<ApplicationListItem>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "applicationDate",
      header: "Date",
      cell: ({ row }) => (
        <span>{formatDate(row.original.applicationDate)}</span>
      ),
    },
    {
      id: "customer",
      header: "Customer / Location",
      accessorFn: (row) => `${row.customerName ?? ""} ${row.locationName ?? ""}`.trim(),
      cell: ({ row }) => {
        const { customerName, locationName } = row.original;
        return (
          <div className="flex flex-col">
            <span className="text-[var(--color-text-primary)]">{customerName ?? "—"}</span>
            {locationName && (
              <span className="text-[var(--text-s)] text-[var(--color-text-tertiary)]">{locationName}</span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "biocharAppliedTons",
      header: "Biochar Applied (kg)",
      cell: ({ row }) => (
        <span className="font-mono">
          {formatApplicationKgFromTons(row.original.biocharAppliedTons)}
        </span>
      ),
    },
    {
      accessorKey: "biocharAppliedDryTons",
      header: "Dry Biochar (kg)",
      cell: ({ row }) => (
        <span className="font-mono">
          {formatApplicationKgFromTons(row.original.biocharAppliedDryTons)}
        </span>
      ),
    },
    {
      accessorKey: "fieldSizeHa",
      header: "Field Size",
      cell: ({ row }) => (
        <span className="font-mono">
          {row.original.fieldSizeHa?.toFixed(2) ?? "—"} ha
        </span>
      ),
    },
    {
      accessorKey: "applicationMethodType",
      header: "Method",
      cell: ({ row }) => (
        <span>
          {row.original.applicationMethodType
            ? formatApplicationMethod(row.original.applicationMethodType as ApplicationMethod)
            : "—"}
        </span>
      ),
    },
    {
      accessorKey: "evidenceMethod",
      header: "Evidence",
      cell: ({ row }) => (
        <span>
          {formatApplicationEvidenceMethod(
            (row.original.evidenceMethod ?? "visual") as ApplicationEvidenceMethod,
          )}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "certifyReadiness",
      header: "Certification",
      cell: ({ row }) => (
        <EntityCertifyReadinessBadge
          readiness={deriveEntityCertifyReadiness("application", row.original)}
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

interface ApplicationListProps {
  deliveries?: ApplicationDeliveryOption[];
}

export function ApplicationList({ deliveries = [] }: ApplicationListProps) {
  const { facilityId: contextFacilityId, selectedFacility } = useFacilityContext();
  const [creditBatchFilterParam, setCreditBatchFilter] = useQueryState(
    "creditBatch",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const creditBatchFilter = creditBatchFilterParam ?? "";
  const [affectedApplicationIdsParam, setAffectedApplicationIdsParam] =
    useQueryState(
      "ids",
      parseAsString.withOptions({ shallow: true, history: "replace" }),
    );
  const affectedApplicationFilter = parseExactIdFilter(
    affectedApplicationIdsParam,
  );
  const affectedApplicationIds = affectedApplicationFilter.ids;
  useEffect(() => {
    if (
      affectedApplicationIdsParam &&
      affectedApplicationFilter.normalized !== affectedApplicationIdsParam
    ) {
      void setAffectedApplicationIdsParam(
        affectedApplicationFilter.normalized,
      );
    }
  }, [
    affectedApplicationFilter.normalized,
    affectedApplicationIdsParam,
    setAffectedApplicationIdsParam,
  ]);
  // Facility durability tier (ADR 0021). Soil temperature is a 200-year-only
  // input, so the form section and detail row are hidden under 1000-year.
  // Fall back to 200-year while facility context resolves: showing the field
  // for a 1000-year facility is recoverable; hiding it for a 200-year one
  // suppresses a required protocol input.
  const durabilityOption = selectedFacility?.durabilityOption ?? "200_year";

  // Side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: ApplicationListItem | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingApplicationId, setDeletingApplicationId] = useState<string | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Server-backed list controls
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "">("");
  const [evidenceFilter, setEvidenceFilter] = useState<ApplicationEvidenceMethod | "">("");
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination(
      `${contextFacilityId ?? ""}:${creditBatchFilter}:${affectedApplicationFilter.normalized ?? ""}`,
    );
  const debouncedSearch = useDebounce(searchQuery, LIST_SEARCH_DEBOUNCE_MS);

  // Data fetching
  const { data: applications, isLoading, error } = useApplications(
    contextFacilityId
      ? {
          facilityId: contextFacilityId,
          creditBatchId: creditBatchFilter || undefined,
          ids:
            affectedApplicationIds.length > 0
              ? affectedApplicationIds
              : undefined,
          search: debouncedSearch || undefined,
          status: statusFilter || undefined,
          evidenceMethod: evidenceFilter || undefined,
          page: currentPage,
          pageSize,
        }
      : undefined,
    { enabled: !!contextFacilityId },
  );
  const { data: scopedDeliveries } = useApplicationDeliveryOptions(
    contextFacilityId ?? undefined,
    { enabled: !!contextFacilityId },
  );
  const { data: creditBatches } = useCreditBatches(
    contextFacilityId ?? undefined,
  );
  const createApplication = useCreateApplication();
  const updateApplication = useUpdateApplication();
  const deleteApplication = useDeleteApplication();
  const toast = useToast();
  const queryClient = useQueryClient();
  const createWithEvidence = useCreateWithEvidence({
    entityType: "application",
    entityNoun: "Application",
    executeCreate: async (data: ApplicationFormData) => {
      const result = await createApplication.mutateAsync(data);
      if (result.success === false) {
        throw new Error(result.error || "Failed to create application");
      }
      const createdApplication: ApplicationListItem = {
        ...result.data,
        deliveryCode: "",
        customerName: null,
        locationName: null,
        durabilityOption,
        // Fail closed until the authoritative list query recounts uploaded
        // evidence after this create flow completes.
        evidenceGapCount: APPLICATION_VISUAL_EVIDENCE_ROLES.length,
      };
      return { entities: [createdApplication], result };
    },
    setError: setCreateError,
    setUpdateError,
    getCreateErrorMessage: (error) =>
      error instanceof Error ? error.message : "Failed to create application",
    unresolvedUpdateMessage:
      "Resolve or remove the failed attachments before saving this application.",
    openEditOnFailure: (application) =>
      setSideSheet({ entity: application, mode: "edit" }),
    closeOnSuccess: () => setSideSheet(null),
    onFlushSuccess: () => {
      // The create mutation invalidates before evidence lands; recount after
      // the flush so readiness reflects the uploaded evidence.
      void queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
    },
    onSuccess: () => toast.success("Application created successfully"),
  });
  const { deferredAttachments, isFlushing } = createWithEvidence;

  // Handlers
  const handleCreate = createWithEvidence.handleCreate;

  const handleUpdate = async (data: ApplicationFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    if (createWithEvidence.guardUpdate()) return;
    try {
      const result = await updateApplication.mutateAsync({
        applicationId: sideSheet.entity.id,
        ...data,
      });
      if (result.success) {
        createWithEvidence.reset();
        setSideSheet(null);
        toast.success("Application updated successfully");
      } else {
        setUpdateError(result.error || "Failed to update application");
      }
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Failed to update application");
    }
  };

  const handleDelete = (applicationId: string) => {
    setDeletingApplicationId(applicationId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingApplicationId) return;
    setDeleteError(null);
    try {
      const result = await deleteApplication.mutateAsync(deletingApplicationId);
      if (result.success) {
        setDeletingApplicationId(null);
        toast.success("Application deleted successfully");
      } else {
        setDeleteError(result.error || "Failed to delete application");
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete application");
    }
  };

  const openCreate = () => {
    setCreateError(null);
    setUpdateError(null);
    createWithEvidence.reset();
    setSideSheet({ entity: null, mode: "create" });
  };
  const openView = (application: ApplicationListItem) => { setSideSheet({ entity: application, mode: "view" }); };
  const openEdit = (application: ApplicationListItem) => { setCreateError(null); setUpdateError(null); createWithEvidence.reset(); setSideSheet({ entity: application, mode: "edit" }); };
  const closeSideSheet = () => {
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
    createWithEvidence.reset();
  };

  const confirmCreateClose = () =>
    createWithEvidence.confirmClose(sideSheet?.mode === "create");
  const attemptCloseSideSheet = () => {
    if (confirmCreateClose()) closeSideSheet();
  };

  // Memoize columns
  const columns = createColumns(openEdit, handleDelete);

  const items = applications?.items ?? [];
  const deliveryOptions = scopedDeliveries ?? deliveries;
  const totalApplications = applications?.total ?? 0;
  const totalPages = applications?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });
  const totalBiochar = items.reduce((sum, a) => sum + (a.biocharAppliedTons ?? 0), 0);

  const hasActiveFilters =
    !!searchQuery ||
    !!statusFilter ||
    !!evidenceFilter ||
    !!creditBatchFilter ||
    affectedApplicationIds.length > 0;
  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setEvidenceFilter("");
    setCreditBatchFilter(null);
    setAffectedApplicationIdsParam(null);
    setCurrentPage(1);
  };

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="distribution"
          title="Applications"
          subtitle="Field applications of biochar to soil"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its applications." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-max py-32">
        <ServerError message={error.message || "Failed to load applications"} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  // The stored entity is a snapshot from when the sheet opened; prefer the
  // refreshed row from the list query so evidence-driven readiness changes
  // show while the sheet stays open. Fall back to the snapshot for rows the
  // list has not caught up with yet (e.g. just-created applications).
  const sideSheetEntity = sideSheet?.entity
    ? (items.find((item) => item.id === sideSheet.entity?.id) ??
      sideSheet.entity)
    : null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Application" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create"
      ? undefined
      : sideSheetEntity
        ? formatDate(sideSheetEntity.applicationDate)
        : undefined;
  const sideSheetDelivery = sideSheetEntity
    ? deliveryOptions.find((delivery) => delivery.id === sideSheetEntity.deliveryId)
    : undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="distribution"
        title="Applications"
        subtitle="Field applications of biochar to soil"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={18} weight="bold" />
            New Application
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-24">
        <StatCard
          title="Total Applications"
          value={totalApplications}
          icon={<MapPinIcon size={24} weight="bold" />}
          description="Field applications"
          isLoading={isLoading}
        />
        <StatCard
          title="Biochar Applied"
          value={formatApplicationKgFromTons(totalBiochar)}
          icon={<LeafIcon size={24} weight="bold" />}
          description="Biochar applied on this page"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={items}
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
        aria-label="Applications"
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<MapPinIcon size={48} />}
            title={
              creditBatchFilter
                ? "No applications in this credit batch"
                : hasActiveFilters
                ? "No applications match"
                : "No applications yet"
            }
            description={
              creditBatchFilter
                ? "No applications trace to this batch. Create one or review the batch period and linked production runs."
                : hasActiveFilters
                ? "Try adjusting or clearing the filters."
                : "Create your first field application to get started"
            }
            action={
              !hasActiveFilters ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={18} weight="bold" />
                  New Application
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          {affectedApplicationIds.length > 0 && (
            <span className="inline-flex h-32 items-center border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] px-10 body-caption font-medium text-[var(--st-wait)]">
              {affectedApplicationIds.length} affected{" "}
              {affectedApplicationIds.length === 1
                ? "application"
                : "applications"}
            </span>
          )}
          <DataTable.Search
            placeholder="Search applications..."
            aria-label="Search applications"
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
              <option value="">All Credit Batches</option>
              {creditBatches?.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code}
                </option>
              ))}
            </DataTable.FilterSelect>
            <DataTable.FilterSelect
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as ApplicationStatus | "");
                setCurrentPage(1);
              }}
              aria-label="Filter by status"
            >
              <option value="">All Statuses</option>
              {applicationStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatApplicationStatus(status)}
                </option>
              ))}
            </DataTable.FilterSelect>
            <DataTable.FilterSelect
              value={evidenceFilter}
              onChange={(event) => {
                setEvidenceFilter(
                  event.target.value as ApplicationEvidenceMethod | "",
                );
                setCurrentPage(1);
              }}
              aria-label="Filter by evidence method"
            >
              <option value="">All Evidence</option>
              {applicationEvidenceMethods.map((method) => (
                <option key={method} value={method}>
                  {formatApplicationEvidenceMethod(method)}
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

      {/* Delete Error */}
      {deleteError && <ServerError message={deleteError} />}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingApplicationId}
        title="Delete Application"
        message="Are you sure you want to delete this application? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingApplicationId(null);
          setDeleteError(null);
        }}
        isPending={deleteApplication.isPending}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        numberedSections
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        onCloseAttempt={confirmCreateClose}
        mode={sideSheetMode}
        onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Application"
        size="wide"
        sections={sideSheetEntity ? [
          {
            title: "Application Details",
            fields: [
              { label: "Application Date", value: formatDate(sideSheetEntity.applicationDate) },
              { label: "Delivery", value: sideSheetEntity.deliveryCode || sideSheetDelivery?.code || null },
              {
                label: "Biochar Applied, Wet (kg)",
                ...certificationDetailField("application", "biocharAppliedTons"),
                value: sideSheetEntity.biocharAppliedTons != null
                  ? formatApplicationKgFromTons(sideSheetEntity.biocharAppliedTons)
                  : null,
              },
              {
                label: "Biochar Applied Dry (kg)",
                ...certificationDetailField("application", "biocharAppliedDryTons"),
                value: sideSheetEntity.biocharAppliedDryTons != null
                  ? formatApplicationKgFromTons(sideSheetEntity.biocharAppliedDryTons)
                  : null,
              },
            ],
          },
          {
            title: "Field Details",
            fields: [
              { label: "Field Size (Ha)", value: sideSheetEntity.fieldSizeHa },
              { label: "Field Identifier", value: sideSheetEntity.fieldIdentifier },
              { label: "Crop Type", value: sideSheetEntity.cropType },
              {
                label: "Application Method",
                value: sideSheetEntity.applicationMethodType
                  ? formatApplicationMethod(sideSheetEntity.applicationMethodType as ApplicationMethod)
                  : null,
              },
              { label: "Field position latitude", value: sideSheetEntity.gpsLatitude },
              { label: "Field position longitude", value: sideSheetEntity.gpsLongitude },
            ],
          },
          {
            title: "Evidence Method",
            fields: [
              {
                label: "Evidence Method",
                value: formatApplicationEvidenceMethod(
                  (sideSheetEntity.evidenceMethod ?? "visual") as ApplicationEvidenceMethod,
                ),
              },
              ...((sideSheetEntity.evidenceMethod ?? "visual") === "boundary"
                ? [{ label: "GIS Boundary Reference", value: sideSheetEntity.gisBoundaryReference }]
                : []),
            ],
            content: (
              <ApplicationEvidencePanel
                applicationId={sideSheetEntity.id}
                mode={(sideSheetEntity.evidenceMethod ?? "visual") as ApplicationEvidenceMethod}
                readOnly
              />
            ),
          },
          ...((sideSheetEntity.durabilityOption ?? durabilityOption) === "1000_year" ? [] : [{
            title: "Soil Temperature",
            fields: [
              {
                label: "Temperature Source",
                value: sideSheetEntity.soilTemperatureSource
                  ? formatSoilTemperatureSource(sideSheetEntity.soilTemperatureSource as SoilTemperatureSource)
                  : null,
              },
              {
                label: "Soil Temperature (°C)",
                ...certificationDetailField("application", "soilTemperatureC"),
                value: sideSheetEntity.soilTemperatureC != null
                  ? `${sideSheetEntity.soilTemperatureC} °C`
                  : null,
              },
            ],
          }]),
        ] : undefined}
      >
        <ApplicationForm
          key={sideSheetEntity?.id ?? "create"}
          application={sideSheetEntity ?? undefined}
          deliveries={deliveryOptions}
          durabilityOption={durabilityOption}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={attemptCloseSideSheet}
          isSubmitting={createApplication.isPending || updateApplication.isPending || isFlushing}
          errorMessage={createError || updateError || undefined}
          deferredAttachments={deferredAttachments}
        />
      </EntitySideSheet>
    </div>
  );
}
