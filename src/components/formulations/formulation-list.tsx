/**
 * FormulationList component
 * Main formulation listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ListChecks, Plus } from "@phosphor-icons/react";
import type { Formulation } from "@/db/schema";
import {
  useCreateFormulation,
  useDeleteFormulation,
  useFormulations,
  useUpdateFormulation,
} from "@/hooks/use-formulations";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui";
import { FormulationForm } from "./formulation-form";
import type { FormulationFormData } from "@/schemas/formulations";
import type { FormulationWithRelations } from "@/data-access/formulations";

// ============================================
// Helpers
// ============================================

function formatRatio(ratio: number | null): string {
  if (ratio === null || ratio === undefined) return "\u2014";
  return `${(ratio * 100).toFixed(0)}%`;
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (formulation: FormulationWithRelations) => void,
  onDelete: (formulationId: string) => void
): ColumnDef<FormulationWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      accessorKey: "biocharRatio",
      header: "Biochar Ratio",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {formatRatio(row.original.biocharRatio)}
        </span>
      ),
    },
    {
      accessorKey: "compostRatio",
      header: "Compost Ratio",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {formatRatio(row.original.compostRatio)}
        </span>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)] max-w-xs truncate block">
          {row.original.description || "\u2014"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-8">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(row.original);
            }}
            className="h-32 px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small transition-colors"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row.original.id);
            }}
            className="h-32 px-12 border border-[var(--color-signal-red)] text-[var(--color-signal-red)] rounded-none hover:bg-[var(--color-signal-red)]/10 body-small transition-colors"
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
// Side Sheet State
// ============================================

type SideSheetState =
  | { mode: "create"; entity: null }
  | { mode: "view"; entity: FormulationWithRelations }
  | { mode: "edit"; entity: FormulationWithRelations };

// ============================================
// Component
// ============================================

export function FormulationList() {
  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [deletingFormulationId, setDeletingFormulationId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: formulationsData, isLoading, error: fetchError } = useFormulations();
  const createFormulation = useCreateFormulation();
  const updateFormulation = useUpdateFormulation();
  const deleteFormulation = useDeleteFormulation();

  const formulations = formulationsData?.items ?? [];

  // Handlers
  const handleCreate = async (data: FormulationFormData) => {
    setFormError(null);
    try {
      await createFormulation.mutateAsync(data);
      setSideSheet(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to create formulation");
    }
  };

  const handleUpdate = async (data: FormulationFormData) => {
    if (sideSheet?.mode !== "edit") return;
    setFormError(null);
    try {
      await updateFormulation.mutateAsync({
        formulationId: sideSheet.entity.id,
        ...data,
      });
      setSideSheet(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to update formulation");
    }
  };

  const handleDelete = (formulationId: string) => setDeletingFormulationId(formulationId);

  const handleDeleteConfirm = async () => {
    if (!deletingFormulationId) return;
    setDeleteError(null);
    try {
      await deleteFormulation.mutateAsync(deletingFormulationId);
      setDeletingFormulationId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete formulation");
    }
  };

  const openCreate = () => { setFormError(null); setSideSheet({ mode: "create", entity: null }); };
  const openView = (formulation: FormulationWithRelations) => { setFormError(null); setSideSheet({ mode: "view", entity: formulation }); };
  const openEdit = (formulation: FormulationWithRelations) => { setFormError(null); setSideSheet({ mode: "edit", entity: formulation }); };
  const closeSideSheet = () => { setSideSheet(null); setFormError(null); };

  const handleModeChange = (mode: SideSheetMode) => {
    if (!sideSheet) return;
    setFormError(null);
    if (mode === "edit" && sideSheet.entity) {
      setSideSheet({ mode: "edit", entity: sideSheet.entity });
    } else if (mode === "view" && sideSheet.entity) {
      setSideSheet({ mode: "view", entity: sideSheet.entity });
    }
  };

  const editingEntity = sideSheet?.mode === "edit" ? sideSheet.entity : null;
  const isSubmitting = createFormulation.isPending || updateFormulation.isPending;

  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load formulations"} />
      </div>
    );
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <h1 className="title-heading-2">Formulations</h1>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={20} weight="bold" />
          New Formulation
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Formulations"
          value={formulations.length}
          icon={<ListChecks size={24} weight="bold" />}
          description="Biochar product recipes"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={formulations}
        enableSorting
        enableFiltering
        enablePagination
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <div className="flex flex-col items-center justify-center gap-24 py-48">
            <ListChecks size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">No formulations yet</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                Create your first formulation to define biochar product recipes.
              </p>
            </div>
            <Button variant="primary" onClick={openCreate}>
              <Plus size={20} weight="bold" />
              Create Formulation
            </Button>
          </div>
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search formulations..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteError && <ServerError message={deleteError} />}

      <DeleteConfirmDialog
        isOpen={!!deletingFormulationId}
        title="Delete Formulation"
        message="Are you sure you want to delete this formulation? This action cannot be undone. Note: Formulations with associated biochar products cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingFormulationId(null);
          setDeleteError(null);
        }}
        isPending={deleteFormulation.isPending}
      />

      <EntitySideSheet
        open={!!sideSheet}
        onOpenChange={(open) => { if (!open) closeSideSheet(); }}
        mode={sideSheet?.mode ?? "create"}
        onModeChange={handleModeChange}
        title={sideSheet?.mode === "create" ? "Create Formulation" : (sideSheet?.entity?.code ?? "")}
        subtitle={sideSheet?.mode === "create" ? "Fill in the form to create a new formulation." : sideSheet?.entity?.name}
        editLabel="Edit Formulation"
        sections={sideSheet?.mode === "view" && sideSheet.entity ? [
          {
            title: "General Information",
            fields: [
              { label: "Code", value: sideSheet.entity.code },
              { label: "Name", value: sideSheet.entity.name },
              { label: "Description", value: sideSheet.entity.description },
            ],
          },
          {
            title: "Composition",
            fields: [
              { label: "Biochar Ratio", value: formatRatio(sideSheet.entity.biocharRatio) },
              { label: "Compost Ratio", value: formatRatio(sideSheet.entity.compostRatio) },
            ],
          },
        ] : undefined}
      >
        {formError && <div className="mb-24"><ServerError message={formError} /></div>}
        <FormulationForm
          key={editingEntity?.id ?? "create"}
          formulation={editingEntity as Formulation | undefined}
          onSubmit={sideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={isSubmitting}
          submitLabel={sideSheet?.mode === "edit" ? "Save Changes" : "Create Formulation"}
        />
      </EntitySideSheet>
    </div>
  );
}
