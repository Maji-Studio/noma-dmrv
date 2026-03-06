/**
 * ApplicationList component
 * Displays application records in a DataTable with create/edit/delete
 * Includes stat cards, search, and pagination
 */
"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { MapPin, Plus, Leaf, Thermometer } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { ApplicationForm } from "./application-form";
import {
  formatApplicationKgFromTons,
  type ApplicationDeliveryOption,
} from "./mass-utils";
import type { Application } from "@/db/schema/application";
import {
  useApplications,
  useCreateApplication,
  useUpdateApplication,
  useDeleteApplication,
} from "@/hooks/use-applications";
import type { ApplicationFormData } from "@/schemas/applications";
import {
  formatApplicationStatus,
  formatApplicationMethod,
  type ApplicationStatus,
  type ApplicationMethod,
} from "@/schemas/applications";

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
        <span>{format(new Date(row.original.applicationDate), "MMM d, yyyy")}</span>
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
      accessorKey: "co2eStoredTonnes",
      header: "CO2e Stored",
      cell: ({ row }) => (
        <span className={row.original.co2eStoredTonnes != null ? "font-mono text-[var(--color-signal-green)]" : ""}>
          {row.original.co2eStoredTonnes != null
            ? `${row.original.co2eStoredTonnes.toFixed(2)} t`
            : "—"}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status === "applied" ? "complete" : "pending"}
          label={formatApplicationStatus(row.original.status as ApplicationStatus)}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-16">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(row.original);
            }}
            className="h-[32px] px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row.original.id);
            }}
            className="h-[32px] px-12 border border-[var(--color-signal-red)] text-[var(--color-signal-red)] rounded-none hover:bg-[var(--color-signal-red)]/10 body-small"
          >
            Delete
          </button>
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
  const { data: applications, isLoading, error } = useApplications();
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
  const totalApplications = items.length;
  const totalBiochar = items.reduce((sum, a) => sum + (a.biocharAppliedTons ?? 0), 0);
  const totalCo2e = items.reduce((sum, a) => sum + (a.co2eStoredTonnes ?? 0), 0);

  if (error) {
    return (
      <div className="container-max py-32">
        <ServerError message={error.message || "Failed to load applications"} />
      </div>
    );
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <div>
          <h1 className="title-heading-2">Applications</h1>
          <p className="body-small text-[var(--color-text-secondary)] mt-1">
            Field applications of biochar to soil
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={18} weight="bold" />
          New Application
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
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
        <StatCard
          title="CO2e Stored"
          value={`${totalCo2e.toFixed(2)} t`}
          icon={<Thermometer size={24} weight="bold" />}
          description="Total carbon stored"
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
          <div className="flex flex-col items-center justify-center gap-24 py-48">
            <MapPin size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">No applications yet</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                Create your first field application to get started
              </p>
            </div>
            <Button variant="primary" onClick={openCreate}>
              <Plus size={18} weight="bold" />
              New Application
            </Button>
          </div>
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

      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
          title={sideSheet.mode === "create" ? "Create Application" : sideSheet.entity?.code ?? ""}
          subtitle={
            sideSheet.mode === "create"
              ? "Add a new field application record"
              : sideSheet.entity
                ? format(new Date(sideSheet.entity.applicationDate), "MMM d, yyyy")
                : undefined
          }
          editLabel="Edit Application"
          size="wide"
          sections={sideSheet.entity ? [
            {
              title: "General",
              fields: [
                { label: "Code", value: sideSheet.entity.code },
                {
                  label: "Application Date",
                  value: format(new Date(sideSheet.entity.applicationDate), "MMM d, yyyy"),
                },
                {
                  label: "Status",
                  value: (
                    <StatusBadge
                      status={sideSheet.entity.status === "applied" ? "complete" : "pending"}
                      label={formatApplicationStatus(sideSheet.entity.status as ApplicationStatus)}
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
                  value: sideSheet.entity.biocharAppliedTons != null
                    ? formatApplicationKgFromTons(sideSheet.entity.biocharAppliedTons)
                    : null,
                },
                {
                  label: "Biochar Applied Dry",
                  value: sideSheet.entity.biocharAppliedDryTons != null
                    ? formatApplicationKgFromTons(sideSheet.entity.biocharAppliedDryTons)
                    : null,
                },
              ],
            },
            {
              title: "Field",
              fields: [
                {
                  label: "Field Size",
                  value: sideSheet.entity.fieldSizeHa != null
                    ? `${sideSheet.entity.fieldSizeHa.toFixed(2)} ha`
                    : null,
                },
                {
                  label: "Application Method",
                  value: sideSheet.entity.applicationMethodType
                    ? formatApplicationMethod(sideSheet.entity.applicationMethodType as ApplicationMethod)
                    : null,
                },
                { label: "Crop Type", value: sideSheet.entity.cropType },
                { label: "Field Identifier", value: sideSheet.entity.fieldIdentifier },
              ],
            },
            {
              title: "Metrics",
              fields: [
                {
                  label: "CO2e Stored",
                  value: sideSheet.entity.co2eStoredTonnes != null
                    ? `${sideSheet.entity.co2eStoredTonnes.toFixed(2)} t CO\u2082e`
                    : null,
                },
              ],
            },
          ] : undefined}
        >
          {(createError || updateError) && <div className="mb-24"><ServerError message={createError || updateError || ""} /></div>}
          <ApplicationForm
            key={sideSheet.entity?.id ?? "create"}
            application={sideSheet.entity ?? undefined}
            deliveries={deliveries}
            onSubmit={sideSheet.entity && sideSheet.mode === "edit" ? handleUpdate : handleCreate}
            onCancel={closeSideSheet}
            isSubmitting={createApplication.isPending || updateApplication.isPending}
          />
        </EntitySideSheet>
      )}
    </div>
  );
}
