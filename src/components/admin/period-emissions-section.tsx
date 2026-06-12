/**
 * PeriodEmissionsSection
 * LCA-journal CRUD for per-period emission rows (ADR 0005, Posture B).
 *
 * Each row corresponds to one expected `PROJECT`-scope Component in the
 * facility's Isometric project; noma does NOT POST these. The operator
 * publishes Project Components in the Isometric UI and the read-only
 * drift panel on `/certification/` reconciles. This section is the
 * audit-trail journal: who transcribed what value, on what date, from
 * which LCA document.
 *
 * File upload of the LCA PDF is deliberately stubbed as a free-text
 * `sourceDocumentId` field — full FormFileUpload integration is a
 * follow-up so this PR can land.
 */
"use client";

import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  FormField,
  FormInput,
  FormSelect,
  FormTextarea,
  SectionLabel,
  ServerError,
} from "@/components/forms";
import type { CertifierProjectEmissionRow } from "@/data-access/project-emissions";
import {
  projectEmissionAllocationStrategies,
  projectEmissionCategoryValues,
  type ProjectEmissionFormData,
  type ProjectEmissionAllocationStrategy,
  createProjectEmissionSchema,
  type ProjectEmissionCategory,
} from "@/schemas/project-emissions";
import { CATEGORY_TO_BLUEPRINT } from "@/lib/isometric/utils/project-emission-match";
import {
  useCreateProjectEmission,
  useDeleteProjectEmission,
  useProjectEmissionsForFacility,
  useUpdateProjectEmission,
} from "@/hooks/use-project-emissions";

const CATEGORY_LABELS: Record<ProjectEmissionCategory, string> = {
  staff_travel: "Staff travel",
  pyrolyzer_direct: "Pyrolyzer direct emissions",
  biochar_storage_fuel: "Biochar storage fuel",
  miscellaneous: "Miscellaneous",
  lab_electricity: "Lab electricity",
  sampling_consumables: "Sampling consumables",
};

function defaultUnitForCategory(category: ProjectEmissionCategory): string {
  return CATEGORY_TO_BLUEPRINT[category].expectedUnit;
}

export function PeriodEmissionsSection({ facilityId }: { facilityId: string }) {
  const {
    data: rows,
    isLoading,
    isError,
    error,
    refetch,
  } = useProjectEmissionsForFacility(facilityId);
  const [openForm, setOpenForm] = useState<
    | { mode: "create" }
    | { mode: "edit"; row: CertifierProjectEmissionRow }
    | null
  >(null);
  const [confirmDelete, setConfirmDelete] =
    useState<CertifierProjectEmissionRow | null>(null);
  const deleteMutation = useDeleteProjectEmission(facilityId);
  const toast = useToast();

  return (
    <section className="flex flex-col gap-16 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-24">
      <header className="flex items-center justify-between gap-12 border-b border-[var(--color-border-tertiary)] pb-16">
        <div className="flex flex-col gap-2">
          <h2 className="title-heading-3">Period emissions (LCA-derived)</h2>
          <p className="body-caption text-[var(--color-text-tertiary)]">
            One row per (category × LCA window). Operator publishes the
            matching <span className="font-mono">PROJECT</span>-scope
            Component in the Isometric UI; the certify dashboard
            reconciles.
          </p>
        </div>
        <Button
          variant="primary"
          size="small"
          onClick={() => setOpenForm({ mode: "create" })}
        >
          <Plus size={14} weight="bold" />
          Add row
        </Button>
      </header>

      {isLoading && (
        <p className="body-medium text-[var(--color-text-tertiary)]">
          Loading…
        </p>
      )}

      {!isLoading && isError && (
        <div className="flex items-start justify-between gap-12 border-l-2 border-[var(--color-signal-orange)] pl-12 py-8">
          <p className="body-small text-[var(--color-text-primary)]">
            <span aria-hidden className="mr-4">!</span>
            {error instanceof Error
              ? error.message
              : "Failed to load period emissions."}
          </p>
          <Button variant="default" size="small" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && rows && rows.length === 0 && (
        <p className="body-small text-[var(--color-text-secondary)]">
          No period emissions transcribed yet. Add a row per category for
          each LCA window.
        </p>
      )}

      {!isError && rows && rows.length > 0 && (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-[var(--color-border-tertiary)]">
              <th className="title-chapter-title text-[var(--color-text-tertiary)] pb-8">Category</th>
              <th className="title-chapter-title text-[var(--color-text-tertiary)] pb-8">Magnitude</th>
              <th className="title-chapter-title text-[var(--color-text-tertiary)] pb-8">Unit</th>
              <th className="title-chapter-title text-[var(--color-text-tertiary)] pb-8">Window</th>
              <th className="title-chapter-title text-[var(--color-text-tertiary)] pb-8">Strategy</th>
              <th className="pb-8" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[var(--color-border-tertiary)]"
              >
                <td className="py-8 body-small">
                  {CATEGORY_LABELS[row.category]}
                </td>
                <td className="py-8 body-small font-mono">{row.magnitude}</td>
                <td className="py-8 body-small font-mono">{row.unit}</td>
                <td className="py-8 body-small">
                  {row.lcaWindowStartOn} → {row.lcaWindowEndOn}
                </td>
                <td className="py-8 body-caption text-[var(--color-text-tertiary)]">
                  {row.allocationStrategyRecommendation}
                </td>
                <td className="py-8">
                  <div className="flex items-center justify-end gap-8">
                    <Button
                      variant="noOutline"
                      size="small"
                      aria-label={`Edit ${CATEGORY_LABELS[row.category]} (${row.lcaWindowStartOn} → ${row.lcaWindowEndOn})`}
                      onClick={() => setOpenForm({ mode: "edit", row })}
                    >
                      <Pencil size={14} weight="bold" />
                    </Button>
                    <Button
                      variant="noOutline"
                      size="small"
                      aria-label={`Delete ${CATEGORY_LABELS[row.category]} (${row.lcaWindowStartOn} → ${row.lcaWindowEndOn})`}
                      onClick={() => setConfirmDelete(row)}
                    >
                      <Trash size={14} weight="bold" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {openForm && (
        <PeriodEmissionFormDialog
          facilityId={facilityId}
          initial={openForm.mode === "edit" ? openForm.row : undefined}
          onClose={() => setOpenForm(null)}
        />
      )}

      {confirmDelete && (
        <DeleteConfirmDialog
          isOpen={!!confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await deleteMutation.mutateAsync({ id: confirmDelete.id });
              toast.success("Row deleted");
              setConfirmDelete(null);
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "Failed to delete row",
              );
            }
          }}
          title="Delete period emission row?"
          message={`Delete ${CATEGORY_LABELS[confirmDelete.category]} for window ${confirmDelete.lcaWindowStartOn} → ${confirmDelete.lcaWindowEndOn}?`}
          isPending={deleteMutation.isPending}
        />
      )}
    </section>
  );
}

function PeriodEmissionFormDialog({
  facilityId,
  initial,
  onClose,
}: {
  facilityId: string;
  initial?: CertifierProjectEmissionRow;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const titleId = useId();
  const createMutation = useCreateProjectEmission();
  const updateMutation = useUpdateProjectEmission();
  const toast = useToast();

  const defaultCategory: ProjectEmissionCategory =
    initial?.category ?? "staff_travel";

  // The DB column for `allocation_strategy_recommendation` is plain `text`
  // (no CHECK constraint), so a legacy value from an earlier migration
  // could fall outside the typed enum. Guard at form-load time rather than
  // casting blindly.
  const isAllocationStrategy = (
    v: unknown,
  ): v is ProjectEmissionAllocationStrategy =>
    typeof v === "string" &&
    (projectEmissionAllocationStrategies as readonly string[]).includes(v);
  const defaultAllocationStrategy: ProjectEmissionAllocationStrategy =
    isAllocationStrategy(initial?.allocationStrategyRecommendation)
      ? initial.allocationStrategyRecommendation
      : "CUSTOM_TIME_PERIOD";

  // No explicit useForm generic: the schema uses z.preprocess for numeric
  // fields, so the resolver's input type (what `register` sees) and output
  // type (what `handleSubmit` yields) differ — passing one generic forces
  // both to the same shape and breaks the resolver assignment. Let RHF
  // infer from defaultValues and type `onSubmit` below with the
  // post-validation output shape.
  const {
    register,
    handleSubmit,
    setError,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createProjectEmissionSchema),
    defaultValues: {
      facilityId,
      category: defaultCategory,
      lcaWindowStartOn: initial?.lcaWindowStartOn ?? "",
      lcaWindowEndOn: initial?.lcaWindowEndOn ?? "",
      magnitude: initial?.magnitude ?? undefined,
      unit: initial?.unit ?? defaultUnitForCategory(defaultCategory),
      allocationStrategyRecommendation: defaultAllocationStrategy,
      sourceDocumentId: initial?.sourceDocumentId ?? "",
      notes: initial?.notes ?? "",
    },
  });

  const currentCategory = useWatch({
    control,
    name: "category",
  }) as ProjectEmissionCategory;
  const currentUnit = useWatch({ control, name: "unit" });
  const suggestedUnit = defaultUnitForCategory(currentCategory);

  const onSubmit = async (raw: unknown) => {
    // Trust the zodResolver to have parsed `raw` to ProjectEmissionFormData
    // before reaching here — the cast is the boundary between the resolver
    // output type and the variant we send to each mutation. See the
    // useForm comment above for why this is a runtime-narrowing cast
    // instead of a typed parameter.
    const data = raw as ProjectEmissionFormData;
    try {
      if (isEdit) {
        await updateMutation.mutateAsync({
          ...data,
          id: initial!.id,
          // Optimistic-concurrency token — the data-access layer rejects
          // the update when the row's updatedAt has moved since this dialog
          // loaded it (two operators editing simultaneously).
          expectedUpdatedAt: initial!.updatedAt,
        });
        toast.success("Row updated");
      } else {
        await createMutation.mutateAsync(data);
        toast.success("Row added");
      }
      onClose();
    } catch (err) {
      setError("root.serverError", {
        type: "server",
        message: err instanceof Error ? err.message : "Failed to save row",
      });
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabelledBy={titleId}
      width="lg"
      contentClassName=""
    >
      <div className="flex flex-col gap-24 p-24">
        <header className="flex flex-col gap-4 border-b border-[var(--color-border-tertiary)] pb-16">
          <span className="title-chapter-title text-[var(--color-text-tertiary)]">
            Period emissions
          </span>
          <h2 id={titleId} className="title-heading-3">
            {isEdit ? "Edit row" : "Add row"}
          </h2>
        </header>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-24"
        >
          {errors.root?.serverError?.message && (
            <ServerError message={errors.root.serverError.message} />
          )}
          <input type="hidden" {...register("facilityId")} />

          <div className="flex flex-col gap-16">
            <SectionLabel>Category</SectionLabel>
            <FormField
              id="category"
              label="Category"
              required
              error={errors.category?.message}
            >
              <FormSelect
                id="category"
                error={!!errors.category}
                options={projectEmissionCategoryValues.map((cat) => ({
                  value: cat,
                  label: `${CATEGORY_LABELS[cat]} (${CATEGORY_TO_BLUEPRINT[cat].blueprintKey})`,
                }))}
                {...register("category", {
                  onChange: (e) => {
                    const next = e.target.value as ProjectEmissionCategory;
                    // Pre-fill unit from canonical map on category change; the
                    // operator can override if their LCA reports a compatible
                    // unit (e.g. tonnes vs kg).
                    setValue("unit", defaultUnitForCategory(next));
                  },
                })}
              />
            </FormField>
          </div>

          <div className="flex flex-col gap-16">
            <SectionLabel>LCA window</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
              <FormField
                id="lcaWindowStartOn"
                label="Window start"
                required
                error={errors.lcaWindowStartOn?.message}
              >
                <FormInput
                  id="lcaWindowStartOn"
                  type="date"
                  error={!!errors.lcaWindowStartOn}
                  {...register("lcaWindowStartOn")}
                />
              </FormField>
              <FormField
                id="lcaWindowEndOn"
                label="Window end"
                required
                error={errors.lcaWindowEndOn?.message}
                helperText="Used as `target_date` for the recommended CUSTOM_TIME_PERIOD allocation strategy."
              >
                <FormInput
                  id="lcaWindowEndOn"
                  type="date"
                  error={!!errors.lcaWindowEndOn}
                  {...register("lcaWindowEndOn")}
                />
              </FormField>
            </div>
          </div>

          <div className="flex flex-col gap-16">
            <SectionLabel>Value</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
              <FormField
                id="magnitude"
                label="Magnitude"
                required
                error={errors.magnitude?.message}
              >
                <FormInput
                  id="magnitude"
                  type="number"
                  step="any"
                  min={0}
                  error={!!errors.magnitude}
                  {...register("magnitude")}
                />
              </FormField>
              <FormField
                id="unit"
                label="Unit"
                required
                error={errors.unit?.message}
                helperText={
                  currentUnit !== suggestedUnit
                    ? `Suggested: ${suggestedUnit}`
                    : undefined
                }
              >
                <FormInput
                  id="unit"
                  type="text"
                  error={!!errors.unit}
                  {...register("unit")}
                />
              </FormField>
            </div>
          </div>

          <div className="flex flex-col gap-16">
            <SectionLabel>Allocation</SectionLabel>
            <FormField
              id="allocationStrategyRecommendation"
              label="Allocation strategy recommendation"
              error={errors.allocationStrategyRecommendation?.message}
              helperText="Informational — operator copies this when authoring the Project Component in Isometric. CUSTOM_TIME_PERIOD with target_date = window end is the default."
            >
              <FormSelect
                id="allocationStrategyRecommendation"
                error={!!errors.allocationStrategyRecommendation}
                options={projectEmissionAllocationStrategies.map((s) => ({
                  value: s,
                  label: s,
                }))}
                {...register("allocationStrategyRecommendation")}
              />
            </FormField>
          </div>

          <div className="flex flex-col gap-16">
            <SectionLabel>Provenance</SectionLabel>
            <FormField
              id="sourceDocumentId"
              label="Source document ID"
              error={errors.sourceDocumentId?.message}
              helperText="UUID of an existing /documents row holding the LCA PDF. Leave empty for now; FormFileUpload integration ships in a follow-up."
            >
              <FormInput
                id="sourceDocumentId"
                type="text"
                placeholder="(uuid)"
                error={!!errors.sourceDocumentId}
                {...register("sourceDocumentId")}
              />
            </FormField>
            <FormField
              id="notes"
              label="Notes"
              error={errors.notes?.message}
            >
              <FormTextarea
                id="notes"
                rows={3}
                error={!!errors.notes}
                {...register("notes")}
              />
            </FormField>
          </div>

          <div className="flex justify-start gap-12 border-t border-[var(--color-border-tertiary)] pt-16">
            <Button
              type="submit"
              variant="primary"
              disabled={
                isSubmitting ||
                createMutation.isPending ||
                updateMutation.isPending
              }
            >
              {isSubmitting ||
              createMutation.isPending ||
              updateMutation.isPending
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Add row"}
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={onClose}
              disabled={
                isSubmitting ||
                createMutation.isPending ||
                updateMutation.isPending
              }
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
