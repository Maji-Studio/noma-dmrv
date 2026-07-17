/**
 * ApplicationList component
 * Displays application records in a DataTable with create/edit/delete
 * Includes stat cards, search, and pagination
 */
"use client";

import { useState } from "react";
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
import { useDeferredAttachments } from "@/hooks/use-deferred-attachments";
import { ApplicationForm } from "./application-form";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import {
  formatApplicationKgFromTons,
  type ApplicationDeliveryOption,
} from "./mass-utils";
import type { ApplicationListItem } from "@/data-access/applications";
import { APPLICATION_VISUAL_EVIDENCE_ROLES } from "@/lib/certification/application-evidence";
import {
  useApplications,
  useApplicationDeliveryOptions,
  useCreateApplication,
  useUpdateApplication,
  useDeleteApplication,
  applicationKeys,
} from "@/hooks/use-applications";
import type { ApplicationFormData } from "@/schemas/applications";
import {
  applicationStatuses,
  applicationEvidenceMethods,
  formatApplicationEvidenceMethod,
  formatApplicationMethod,
  formatApplicationStatus,
  type ApplicationEvidenceMethod,
  type ApplicationMethod,
  type ApplicationStatus,
} from "@/schemas/applications";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { formatSafeDate } from "@/lib/format-utils";

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
        <span>{formatSafeDate(row.original.applicationDate)}</span>
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

  // Filter state (client-side facets over the loaded rows)
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "">("");
  const [evidenceFilter, setEvidenceFilter] = useState<ApplicationEvidenceMethod | "">("");

  // Data fetching
  const { data: applications, isLoading, error } = useApplications(
    contextFacilityId ? { facilityId: contextFacilityId } : undefined,
    { enabled: !!contextFacilityId },
  );
  const { data: scopedDeliveries } = useApplicationDeliveryOptions(
    contextFacilityId ?? undefined,
    { enabled: !!contextFacilityId },
  );
  const createApplication = useCreateApplication();
  const updateApplication = useUpdateApplication();
  const deleteApplication = useDeleteApplication();
  const toast = useToast();
  const queryClient = useQueryClient();
  const deferredAttachments = useDeferredAttachments();
  const [isFlushing, setIsFlushing] = useState(false);

  // Handlers
  const handleCreate = async (data: ApplicationFormData) => {
    setCreateError(null);
    try {
      const result = await createApplication.mutateAsync(data);
      if (result.success === false) {
        setCreateError(result.error || "Failed to create application");
        return;
      }
      const createdApplication: ApplicationListItem = {
        ...result.data,
        customerName: null,
        locationName: null,
        durabilityOption,
        // Fail closed until the authoritative list query recounts uploaded
        // evidence after this create flow completes.
        evidenceGapCount: APPLICATION_VISUAL_EVIDENCE_ROLES.length,
      };
      setIsFlushing(true);
      const flushResult = await deferredAttachments.flush(
        "application",
        createdApplication.id,
      );
      if (!flushResult.ok) {
        setSideSheet({ entity: createdApplication, mode: "edit" });
        setCreateError(
          `Application created, but ${flushResult.failed.length} ${flushResult.failed.length === 1 ? "attachment" : "attachments"} failed to upload.`,
        );
        return;
      }
      deferredAttachments.clear();
      // The create mutation already invalidated the list, but that ran before
      // the evidence flush finished — so the row's readiness/evidence-gap count
      // was recomputed with zero uploads. Re-invalidate now that the deferred
      // attachments have landed so the list reflects the true evidence state.
      queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
      setSideSheet(null);
      toast.success("Application created successfully");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create application");
    } finally {
      setIsFlushing(false);
    }
  };

  const handleUpdate = async (data: ApplicationFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    if (
      deferredAttachments.attachments.some(
        // Any not-yet-`uploaded` entry is unresolved: "failed" awaits a retry,
        // and "uploading" means a retry is mid-flight whose state a save would
        // clobber. Both must block the save.
        (attachment) => attachment.status !== "uploaded",
      )
    ) {
      setUpdateError(
        "Resolve or remove the failed attachments before saving this application.",
      );
      return;
    }
    try {
      const result = await updateApplication.mutateAsync({
        applicationId: sideSheet.entity.id,
        ...data,
      });
      if (result.success) {
        deferredAttachments.clear();
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
    deferredAttachments.clear();
    setSideSheet({ entity: null, mode: "create" });
  };
  const openView = (application: ApplicationListItem) => { setSideSheet({ entity: application, mode: "view" }); };
  const openEdit = (application: ApplicationListItem) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: application, mode: "edit" }); };
  const closeSideSheet = () => {
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
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

  // Memoize columns
  const columns = createColumns(openEdit, handleDelete);

  const items = applications?.items ?? [];
  const deliveryOptions = scopedDeliveries ?? deliveries;
  const totalApplications = items.length;
  const totalBiochar = items.reduce((sum, a) => sum + (a.biocharAppliedTons ?? 0), 0);

  // Client-side facet filters (the list loads all rows for the facility)
  const filteredItems = items.filter((a) =>
    (!statusFilter || a.status === statusFilter) &&
    // A null evidenceMethod renders as "visual" (the table/side-sheet fallback),
    // so the facet must match that same default — otherwise filtering by Visual
    // hides the very rows it visibly labels Visual.
    (!evidenceFilter || (a.evidenceMethod ?? "visual") === evidenceFilter)
  );
  const hasActiveFilters = !!statusFilter || !!evidenceFilter;
  const clearFilters = () => { setStatusFilter(""); setEvidenceFilter(""); };

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
        ? formatSafeDate(sideSheetEntity.applicationDate)
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
          description="Total biochar applied"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={filteredItems}
        enableSorting
        enableFiltering
        enablePagination
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<MapPinIcon size={48} />}
            title={
              hasActiveFilters
                ? "No applications match"
                : "No applications yet"
            }
            description={
              hasActiveFilters
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
          <DataTable.Search placeholder="Search applications..." />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | "")}
            className="h-40 px-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small cursor-pointer"
            aria-label="Filter by status"
          >
            <option value="">All Statuses</option>
            {applicationStatuses.map((s) => (
              <option key={s} value={s}>{formatApplicationStatus(s)}</option>
            ))}
          </select>
          <select
            value={evidenceFilter}
            onChange={(e) => setEvidenceFilter(e.target.value as ApplicationEvidenceMethod | "")}
            className="h-40 px-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small cursor-pointer"
            aria-label="Filter by evidence method"
          >
            <option value="">All Evidence</option>
            {applicationEvidenceMethods.map((m) => (
              <option key={m} value={m}>{formatApplicationEvidenceMethod(m)}</option>
            ))}
          </select>
          {hasActiveFilters && (
            <Button variant="noOutline" size="small" onClick={clearFilters}>
              <XIcon size={16} weight="bold" />
              Clear
            </Button>
          )}
          <DataTable.ColumnVisibility />
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
            title: "General",
            fields: [
              { label: "Code", value: sideSheetEntity.code },
              {
                label: "Application Date",
                value: formatSafeDate(sideSheetEntity.applicationDate),
              },
              {
                label: "Status",
                value: <StatusBadge status={sideSheetEntity.status} />,
              },
              {
                label: "Certification",
                value: (
                  <EntityCertifyReadinessBadge
                    readiness={deriveEntityCertifyReadiness(
                      "application",
                      sideSheetEntity,
                    )}
                  />
                ),
              },
            ],
          },
          {
            title: "Biochar",
            fields: [
              {
                label: "Biochar Applied",
                ...certificationDetailField("application", "biocharAppliedTons"),
                value: sideSheetEntity.biocharAppliedTons != null
                  ? formatApplicationKgFromTons(sideSheetEntity.biocharAppliedTons)
                  : null,
              },
              {
                label: "Biochar Applied Dry",
                ...certificationDetailField("application", "biocharAppliedDryTons"),
                value: sideSheetEntity.biocharAppliedDryTons != null
                  ? formatApplicationKgFromTons(sideSheetEntity.biocharAppliedDryTons)
                  : null,
              },
            ],
          },
          {
            title: "Field",
            fields: [
              {
                label: "Field Size",
                value: sideSheetEntity.fieldSizeHa != null
                  ? `${sideSheetEntity.fieldSizeHa.toFixed(2)} ha`
                  : null,
              },
              {
                label: "Application Method",
                value: sideSheetEntity.applicationMethodType
                  ? formatApplicationMethod(sideSheetEntity.applicationMethodType as ApplicationMethod)
                  : null,
              },
              {
                label: "Evidence Method",
                value: formatApplicationEvidenceMethod(
                  (sideSheetEntity.evidenceMethod ?? "visual") as ApplicationEvidenceMethod,
                ),
              },
              // Soil temperature is a 200-year-only durable-fraction input —
              // hidden under 1000-year (ADR 0021). The tier prefers the row's
              // own join-derived value, falling back to the active facility.
              ...((sideSheetEntity.durabilityOption ?? durabilityOption) ===
              "1000_year"
                ? []
                : [
                    {
                      label: "Soil Temperature",
                      ...certificationDetailField(
                        "application",
                        "soilTemperatureC",
                      ),
                      value:
                        sideSheetEntity.soilTemperatureC != null
                          ? `${sideSheetEntity.soilTemperatureC} °C`
                          : null,
                    },
                  ]),
              { label: "Crop Type", value: sideSheetEntity.cropType },
              { label: "Field Identifier", value: sideSheetEntity.fieldIdentifier },
            ],
          },
        ] : undefined}
      >
        {(createError || updateError) && <div className="mb-24"><ServerError message={createError || updateError || ""} /></div>}
        <ApplicationForm
          key={sideSheetEntity?.id ?? "create"}
          application={sideSheetEntity ?? undefined}
          deliveries={deliveryOptions}
          durabilityOption={durabilityOption}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={attemptCloseSideSheet}
          isSubmitting={createApplication.isPending || updateApplication.isPending || isFlushing}
          deferredAttachments={deferredAttachments}
        />
      </EntitySideSheet>
    </div>
  );
}
