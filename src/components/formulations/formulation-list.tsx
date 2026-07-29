/**
 * FormulationList component
 * Main formulation listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ListChecksIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import {
  useCreateFormulation,
  useDeleteFormulation,
  useFormulations,
  useUpdateFormulation,
} from "@/hooks/use-formulations";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
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
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";

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
      header: "Biochar share",
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
  const [searchInput, setSearchInput] = useState("");
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination();
  const debouncedSearch = useDebounce(
    searchInput,
    LIST_SEARCH_DEBOUNCE_MS,
  );

  const { data: formulationsData, isLoading, error: fetchError } = useFormulations({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    page: currentPage,
    pageSize,
  });
  const createFormulation = useCreateFormulation();
  const updateFormulation = useUpdateFormulation();
  const deleteFormulation = useDeleteFormulation();
  const toast = useToast();

  const formulations = formulationsData?.items ?? [];
  const totalFormulations = formulationsData?.total ?? 0;
  const totalPages = formulationsData?.totalPages ?? 0;
  const hasActiveSearch = searchInput.trim().length > 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });

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

    const ingredientCount = entity.ingredients?.length ?? 0;
    const ingredientFields = ingredientCount > 0
      ? entity.ingredients.flatMap((ingredient, index) => {
          const prefix = ingredientCount > 1 ? `Ingredient ${index + 1}` : "Ingredient";
          return [
            {
              label: `${prefix} · Blend material`,
              value: ingredient.feedstockType.name,
            },
            {
              label: `${prefix} · volume share (%)`,
              value: formatRatio(ingredient.ratio),
            },
          ];
        })
      : [];

    return [
      {
        title: "Required information",
        fields: [
          { label: "Formulation name", value: entity.name },
        ],
      },
      {
        title: "Blend composition by volume",
        fields: [
          {
            label: "Biochar · volume share (%)",
            value: formatRatio(entity.biocharRatio),
          },
          ...ingredientFields,
        ],
        content: ingredientCount === 0 ? (
          <p className="body-small text-[var(--color-text-tertiary)] py-8">
            No ingredients added — this is a pure-biochar formulation.
          </p>
        ) : undefined,
      },
      {
        title: "Additional information",
        fields: [{ label: "Description", value: entity.description }],
      },
    ];
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
          value={totalFormulations}
          icon={<ListChecksIcon size={24} weight="bold" />}
          description="Biochar product recipes"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={formulations}
        enableSorting={false}
        enablePagination
        manualPagination
        pageCount={totalPages}
        pageSize={pageSize}
        pageIndex={currentPage - 1}
        globalFilter={searchInput}
        onGlobalFilterChange={(value) => {
          setSearchInput(value);
          setCurrentPage(1);
        }}
        onPaginationChange={onPaginationChange}
        aria-label="Formulations"
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<ListChecksIcon size={48} />}
            title={hasActiveSearch ? "No matching formulations" : "No formulations yet"}
            description={
              hasActiveSearch
                ? "Try clearing your search."
                : "Formulations define biochar product recipes."
            }
            action={
              !hasActiveSearch ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={20} weight="bold" />
                  Create your first formulation
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search
            placeholder="Search formulations..."
            aria-label="Search formulations"
          />
          <DataTable.Controls>
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
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
        <FormulationForm
          key={editingEntity?.id ?? "create"}
          formulation={editingEntity ?? undefined}
          onSubmit={sideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={isSubmitting}
          errorMessage={formError ?? undefined}
          submitLabel={sideSheet?.mode === "edit" ? "Save Changes" : "Create Formulation"}
        />
      </EntitySideSheet>
    </div>
  );
}
