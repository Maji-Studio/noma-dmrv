/**
 * FormulationList component
 * Main formulation listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ListChecksIcon, PlusIcon } from "@phosphor-icons/react";
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
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { FormulationForm } from "./formulation-form";
import type { FormulationFormData } from "@/schemas/formulations";
import type { FormulationWithIngredients } from "@/data-access/formulations";

// ============================================
// Helpers
// ============================================

function formatRatio(ratio: number | null): string {
  if (ratio === null || ratio === undefined) return "\u2014";
  return `${(ratio * 100).toFixed(0)}%`;
}

function formatIngredientsSummary(
  ingredients: FormulationWithIngredients["ingredients"]
): string {
  if (!ingredients || ingredients.length === 0) return "\u2014";
  return ingredients
    .map((ing) => {
      const ratio = ing.ratio != null ? ` (${(ing.ratio * 100).toFixed(0)}%)` : "";
      return `${ing.feedstockType.name}${ratio}`;
    })
    .join(", ");
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (formulation: FormulationWithIngredients) => void,
  onDelete: (formulationId: string) => void
): ColumnDef<FormulationWithIngredients>[] {
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
      id: "ingredients",
      header: "Ingredients",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)] max-w-xs truncate block">
          {formatIngredientsSummary(row.original.ingredients)}
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
// Side Sheet State
// ============================================

type SideSheetState =
  | { mode: "create"; entity: null }
  | { mode: "view"; entity: FormulationWithIngredients }
  | { mode: "edit"; entity: FormulationWithIngredients };

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
  const toast = useToast();

  const formulations = formulationsData?.items ?? [];

  // Handlers
  const handleCreate = async (data: FormulationFormData) => {
    setFormError(null);
    try {
      await createFormulation.mutateAsync(data);
      setSideSheet(null);
      toast.success("Formulation created successfully");
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
      toast.success("Formulation updated successfully");
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
      toast.success("Formulation deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete formulation");
    }
  };

  const openCreate = () => { setFormError(null); setSideSheet({ mode: "create", entity: null }); };
  const openView = (formulation: FormulationWithIngredients) => { setFormError(null); setSideSheet({ mode: "view", entity: formulation }); };
  const openEdit = (formulation: FormulationWithIngredients) => { setFormError(null); setSideSheet({ mode: "edit", entity: formulation }); };
  const closeSideSheet = () => { setSideSheet(null); setFormError(null); };
  useOpenCreateIntent(openCreate);

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

  const columns = createColumns(openEdit, handleDelete);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load formulations"} />
      </div>
    );
  }

  // Build view sections for side sheet
  const viewSections = (() => {
    if (sideSheet?.mode !== "view" || !sideSheet.entity) return undefined;
    const entity = sideSheet.entity;

    const sections = [
      {
        title: "General Information",
        fields: [
          { label: "Code", value: entity.code },
          { label: "Name", value: entity.name },
          { label: "Description", value: entity.description },
        ],
      },
      {
        title: "Composition",
        fields: [
          { label: "Biochar Ratio", value: formatRatio(entity.biocharRatio) },
        ],
      },
    ];

    if (entity.ingredients && entity.ingredients.length > 0) {
      sections.push({
        title: "Ingredients",
        fields: entity.ingredients.map((ing) => ({
          label: ing.feedstockType.name,
          value: `${ing.feedstockType.category}${ing.ratio != null ? ` — ${(ing.ratio * 100).toFixed(0)}%` : ""}${ing.description ? ` (${ing.description})` : ""}`,
        })),
      });
    }

    return sections;
  })();

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="production"
        title="Formulations"
        subtitle="Biochar product recipes and blend ratios"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New Formulation
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Formulations"
          value={formulations.length}
          icon={<ListChecksIcon size={24} weight="bold" />}
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
          <EmptyState
            padding="md"
            icon={<ListChecksIcon size={48} />}
            title="No formulations yet"
            description="Create your first formulation to define biochar product recipes."
            action={
              <Button variant="primary" onClick={openCreate}>
                <PlusIcon size={20} weight="bold" />
                Create Formulation
              </Button>
            }
          />
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
        subtitle={sideSheet?.mode === "create" ? undefined : sideSheet?.entity?.name}
        editLabel="Edit Formulation"
        sections={viewSections}
      >
        {formError && <div className="mb-24"><ServerError message={formError} /></div>}
        <FormulationForm
          key={editingEntity?.id ?? "create"}
          formulation={editingEntity ?? undefined}
          onSubmit={sideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={isSubmitting}
          submitLabel={sideSheet?.mode === "edit" ? "Save Changes" : "Create Formulation"}
        />
      </EntitySideSheet>
    </div>
  );
}
