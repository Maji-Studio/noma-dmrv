/**
 * FormulationList component
 * Main formulation listing with CRUD operations, stat cards, and DataTable
 */
"use client";
import { StaleVersionError, toDeleteErrorMessage, toArchiveRestoreErrorMessage } from "@/lib/stale-version";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ArchiveIcon, ListChecksIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import {
  useArchiveFormulation,
  useCreateFormulation,
  useDeleteFormulation,
  useRestoreFormulation,
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
import { DeleteConflictNotice, isInUseDeleteRefusal } from "@/components/ui/lifecycle-notices";
import { ArchivedFormulationNotice } from "./formulation-notices";
import { formatRatio, formulationSheetSections } from "./formulation-read-sections";
import type { FormulationFormData } from "@/schemas/formulations";
import type { FormulationWithIngredients } from "@/data-access/formulations";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import { MISSING_VALUE } from "@/lib/copy-utils";

// ============================================
// Helpers
// ============================================

function formatIngredientsSummary(
  ingredients: FormulationWithIngredients["ingredients"]
): string {
  if (!ingredients || ingredients.length === 0) return MISSING_VALUE.none;
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
  onArchive: (formulation: FormulationWithIngredients) => void,
  onRestore: (formulation: FormulationWithIngredients) => void,
  onDelete: (formulationId: string) => void
): ColumnDef<FormulationWithIngredients>[] {
  return [
    {
      accessorKey: "code",
      meta: { nowrap: true },
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
      header: "Biochar volume share",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {formatRatio(row.original.biocharRatio)}
        </span>
      ),
    },
    {
      id: "ingredients",
      header: "Ingredients by volume",
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
          {row.original.description || MISSING_VALUE.notRecorded}
        </span>
      ),
    },
    {
      id: "actions",
      meta: { stickyEnd: true },
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <RowActionsMenu
            label={`Actions for ${row.original.code}`}
            actions={[
              ...(row.original.archivedAt
                ? [{ label: "Restore", onSelect: () => onRestore(row.original) }]
                : [
                    { label: "Edit", onSelect: () => onEdit(row.original) },
                    { label: "Archive", onSelect: () => onArchive(row.original) },
                  ]),
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
  const [deletingFormulation, setDeletingFormulation] = useState<FormulationWithIngredients | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<FormulationWithIngredients | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination(showArchived ? "archived" : "active");
  const debouncedSearch = useDebounce(
    searchInput,
    LIST_SEARCH_DEBOUNCE_MS,
  );

  const { data: formulationsData, isLoading, error: fetchError } = useFormulations({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    archived: showArchived,
    page: currentPage,
    pageSize,
  });
  const createFormulation = useCreateFormulation();
  const updateFormulation = useUpdateFormulation();
  const deleteFormulation = useDeleteFormulation();
  const archiveFormulation = useArchiveFormulation();
  const restoreFormulation = useRestoreFormulation();
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
      toast.success("Formulation created.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Formulation was not created. Check the form.");
    }
  };

  const handleUpdate = async (data: FormulationFormData) => {
    if (sideSheet?.mode !== "edit") return;
    setFormError(null);
    try {
      await updateFormulation.mutateAsync({
        formulationId: sideSheet.entity.id,
        expectedVersion: sideSheet.entity.version,
        ...data,
      });
      setSideSheet(null);
      toast.success("Formulation updated.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Formulation was not saved. Try again.");
    }
  };

  const handleDelete = (formulationId: string) => { setDeleteConflict(null); setDeleteError(null); setDeletingFormulation((formulationsData?.items ?? []).find((row) => row.id === formulationId) ?? null); };

  const handleDeleteConfirm = async () => {
    if (!deletingFormulation) return;
    setDeleteError(null);
    try {
      await deleteFormulation.mutateAsync({ formulationId: deletingFormulation.id, expectedVersion: deletingFormulation.version });
      setDeletingFormulation(null);
      toast.success("Formulation deleted.");
    } catch (error) {
      const message = toDeleteErrorMessage(error, `Formulation ${deletingFormulation.code}`, "Formulation was not deleted. Try again.");
      if (isInUseDeleteRefusal(message) && !deletingFormulation.archivedAt) {
        // In use: the dialog gives way to a notice that offers Archive instead.
        setDeleteConflict(deletingFormulation);
        setDeletingFormulation(null);
        return;
      }
      if (error instanceof StaleVersionError) setDeletingFormulation(null);
      setDeleteError(message);
    }
  };

  const handleArchive = async (formulation: FormulationWithIngredients) => {
    // Act on the list's current row: the snapshot a notice or sheet holds goes stale after a refused version.
    const fresh = (formulationsData?.items ?? []).find((row) => row.id === formulation.id);
    const target = fresh ?? formulation;
    setLifecycleError(null);
    try {
      await archiveFormulation.mutateAsync({ formulationId: formulation.id, expectedVersion: target.version });
      setDeleteConflict(null);
      toast.success(`Formulation ${formulation.code} archived. Restore it from the archived view.`);
    } catch (error) {
      // Without a fresh row the notice would keep the stale version, so drop it.
      if (error instanceof StaleVersionError && !fresh) setDeleteConflict(null);
      setLifecycleError(toArchiveRestoreErrorMessage(error, `Formulation ${formulation.code}`, "archive", "The formulation was not archived. Try again."));
    }
  };

  const handleRestore = async (formulation: FormulationWithIngredients) => {
    // Act on the list's current row: the snapshot a notice or sheet holds goes stale after a refused version.
    const fresh = (formulationsData?.items ?? []).find((row) => row.id === formulation.id);
    const target = fresh ?? formulation;
    setLifecycleError(null);
    try {
      await restoreFormulation.mutateAsync({ formulationId: formulation.id, expectedVersion: target.version });
      setSideSheet(null);
      toast.success(`Formulation ${formulation.code} restored.`);
    } catch (error) {
      setLifecycleError(toArchiveRestoreErrorMessage(error, `Formulation ${formulation.code}`, "restore", "The formulation was not restored. Try again."));
    }
  };

  const toggleShowArchived = () => {
    setShowArchived((current) => !current);
    setCurrentPage(1);
    setSideSheet(null);
    setDeleteConflict(null);
    setLifecycleError(null);
  };

  const openCreate = () => { setFormError(null); setSideSheet({ mode: "create", entity: null }); };
  const openView = (formulation: FormulationWithIngredients) => { setFormError(null); setSideSheet({ mode: "view", entity: formulation }); };
  const openEdit = (formulation: FormulationWithIngredients) => { setFormError(null); setSideSheet({ mode: "edit", entity: formulation }); };
  const closeSideSheet = () => { setSideSheet(null); setFormError(null); };
  useOpenCreateIntent(openCreate);

  const handleModeChange = (mode: SideSheetMode) => {
    if (!sideSheet) return;
    setFormError(null);
    if (mode === "edit" && sideSheet.entity && !sideSheet.entity.archivedAt) {
      setSideSheet({ mode: "edit", entity: sideSheet.entity });
    } else if (mode === "view" && sideSheet.entity) {
      setSideSheet({ mode: "view", entity: sideSheet.entity });
    }
  };

  const editingEntity = sideSheet?.mode === "edit" ? sideSheet.entity : null;
  const isSubmitting = createFormulation.isPending || updateFormulation.isPending;

  const columns = createColumns(openEdit, handleArchive, handleRestore, handleDelete);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "The formulations could not be loaded. Refresh the page and try again."} />
      </div>
    );
  }

  const viewedEntity = sideSheet?.mode === "view" ? sideSheet.entity : null;
  const viewSections = sideSheet?.mode === "view" && sideSheet.entity
    ? formulationSheetSections(sideSheet.entity)
    : undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="production"
        title="Formulations"
        subtitle="Biochar product recipes and blend ratios"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New formulation
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title={showArchived ? "Archived formulations" : "Active formulations"}
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
            title={
              hasActiveSearch
                ? showArchived ? "No archived formulations match" : "No matching formulations"
                : showArchived ? "No archived formulations" : "No formulations yet"
            }
            description={
              hasActiveSearch
                ? "Try clearing your search."
                : showArchived
                  ? "Formulations you archive will appear here and can be restored."
                  : "Formulations define biochar product recipes."
            }
            action={
              !hasActiveSearch && !showArchived ? (
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
            <Button
              variant={showArchived ? "primary" : "default"}
              size="small"
              onClick={toggleShowArchived}
              aria-pressed={showArchived}
            >
              <ArchiveIcon size={16} weight="bold" />
              Archived
            </Button>
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteConflict && (
        <DeleteConflictNotice
          label={deleteConflict.code}
          onArchive={() => handleArchive(deleteConflict)}
          isPending={archiveFormulation.isPending}
        />
      )}

      {((lifecycleError && !viewedEntity) || (deleteError && !deletingFormulation)) && (
        <ServerError message={(!viewedEntity ? lifecycleError : null) ?? deleteError ?? ""} />
      )}

      <DeleteConfirmDialog
        isOpen={!!deletingFormulation}
        title="Delete formulation"
        message="Delete this formulation permanently? Formulations used by biochar products, orders or bins cannot be deleted and should be archived instead."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingFormulation(null);
          setDeleteError(null);
        }}
        isPending={deleteFormulation.isPending}
        errorMessage={deleteError ?? undefined}
      />

      <EntitySideSheet
        detailToggle="form"
        detailScope={sideSheet?.entity?.id ?? "create"}
        open={!!sideSheet}
        onOpenChange={(open) => { if (!open) closeSideSheet(); }}
        mode={sideSheet?.mode ?? "create"}
        onModeChange={handleModeChange}
        title={sideSheet?.mode === "create" ? "Create formulation" : (sideSheet?.entity?.code ?? "")}
        subtitle={sideSheet?.mode === "create" ? undefined : sideSheet?.entity?.name}
        editLabel="Edit formulation"
        sections={viewSections}
        canEdit={!viewedEntity?.archivedAt}
        viewModeNotice={
          viewedEntity?.archivedAt ? (
            <>
              <ArchivedFormulationNotice
                onRestore={() => handleRestore(viewedEntity)}
                isPending={restoreFormulation.isPending}
              />
              {lifecycleError && <ServerError message={lifecycleError} />}
            </>
          ) : undefined
        }
      >
        <FormulationForm
          key={editingEntity?.id ?? "create"}
          formulation={editingEntity ?? undefined}
          onSubmit={sideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={isSubmitting}
          errorMessage={formError ?? undefined}
          submitLabel={sideSheet?.mode === "edit" ? "Save changes" : "Create formulation"}
        />
      </EntitySideSheet>
    </div>
  );
}
