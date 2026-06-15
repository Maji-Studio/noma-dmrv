/**
 * ApplicationList component
 * Displays application records in a DataTable with create/edit/delete
 * Includes stat cards, search, and pagination
 */
"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MapPin, Plus, Leaf } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { ApplicationForm } from "./application-form";
import { EntityCertifyReadinessBadge } from "@/components/certification/entity-certify-readiness-badge";
import {
  formatApplicationKgFromTons,
  type ApplicationDeliveryOption,
} from "./mass-utils";
import type { Application } from "@/db/schema/application";
import {
  useApplications,
  useApplicationDeliveryOptions,
  useCreateApplication,
  useUpdateApplication,
  useDeleteApplication,
} from "@/hooks/use-applications";
import type { ApplicationFormData } from "@/schemas/applications";
import {
  formatApplicationEvidenceMethod,
  formatApplicationMethod,
  type ApplicationEvidenceMethod,
  type ApplicationMethod,
} from "@/schemas/applications";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { formatSafeDate } from "@/lib/format-utils";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (application: Application) => void,
  onDelete: (applicationId: string) => void,
): ColumnDef<Application>[] {
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
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "certifyReadiness",
      header: "Certifier",
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
  const { facilityId: contextFacilityId } = useFacilityContext();

  // Side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: Application | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingApplicationId, setDeletingApplicationId] = useState<string | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  // Handlers
  const handleCreate = async (data: ApplicationFormData) => {
    setCreateError(null);
    try {
      const result = await createApplication.mutateAsync(data);
      if (result.success) {
        setSideSheet(null);
        toast.success("Application created successfully");
      } else {
        setCreateError(result.error || "Failed to create application");
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create application");
    }
  };

  const handleUpdate = async (data: ApplicationFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      const result = await updateApplication.mutateAsync({
        applicationId: sideSheet.entity.id,
        ...data,
      });
      if (result.success) {
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

  const openCreate = () => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: null, mode: "create" }); };
  const openView = (application: Application) => { setSideSheet({ entity: application, mode: "view" }); };
  const openEdit = (application: Application) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: application, mode: "edit" }); };
  const closeSideSheet = () => { setSideSheet(null); setCreateError(null); setUpdateError(null); };

  // Memoize columns
  const columns = createColumns(openEdit, handleDelete);

  const items = applications?.items ?? [];
  const deliveryOptions = scopedDeliveries ?? deliveries;
  const totalApplications = items.length;
  const totalBiochar = items.reduce((sum, a) => sum + (a.biocharAppliedTons ?? 0), 0);

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
  const sideSheetEntity = sideSheet?.entity ?? null;

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
          contextFacilityId ? (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={18} weight="bold" />
              New Application
            </Button>
          ) : undefined
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-24">
        <StatCard
          title="Total Applications"
          value={totalApplications}
          icon={<MapPin size={24} weight="bold" />}
          description="Field applications"
          isLoading={isLoading}
        />
        <StatCard
          title="Biochar Applied"
          value={formatApplicationKgFromTons(totalBiochar)}
          icon={<Leaf size={24} weight="bold" />}
          description="Total biochar applied"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={items}
        enableSorting
        enableFiltering
        enablePagination
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<MapPin size={48} />}
            title={contextFacilityId ? "No applications yet" : "Select a facility"}
            description={
              contextFacilityId
                ? "Create your first field application to get started"
                : "Choose a facility from the sidebar to view applications"
            }
            action={
              contextFacilityId ? (
                <Button variant="primary" onClick={openCreate}>
                  <Plus size={18} weight="bold" />
                  New Application
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search applications..." />
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
                label: "Certifier",
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
              {
                label: "Soil Temperature",
                ...certificationDetailField("application", "soilTemperatureC"),
                value: sideSheetEntity.soilTemperatureC != null
                  ? `${sideSheetEntity.soilTemperatureC} °C`
                  : null,
              },
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
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createApplication.isPending || updateApplication.isPending}
        />
      </EntitySideSheet>
    </div>
  );
}
