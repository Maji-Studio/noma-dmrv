"use client";

import { useState, type KeyboardEvent } from "react";
import { DatabaseIcon, SealCheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@/lib/utils";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { FormActions } from "@/components/forms/form-actions";
import {
  feedstockTypeFormSchema,
  BLEND_FEEDSTOCK_CATEGORY_OPTIONS,
  PYROLYSIS_FEEDSTOCK_CATEGORY_OPTIONS,
  feedstockCategories,
  feedstockTypeUsages,
  type FeedstockTypeUsage,
  type FeedstockTypeFormData,
} from "@/schemas/feedstock-types";
import type { FeedstockType } from "@/db/schema/feedstock";
import { IsometricFeedstockBrowser } from "./isometric-feedstock-browser";
import type { IsometricFeedstockType } from "@/lib/isometric";
import {
  feedstockTypeUsageOptionsFor,
  shouldClearCategoryForIsometricSelection,
  shouldSetUsageToPyrolysisForIsometricSelection,
  shouldShowCertifiedFeedstockWarning,
  shouldShowIsometricFeedstockSection,
} from "./feedstock-type-form-logic";

// General = the local record (the only editable surface). Isometric =
// read-only browse of the registry catalogue. Selecting a registry row pre-fills
// the local record, but nothing is created until the operator saves. The
// Registry URL column stays in the schema; it just no longer has a form field.
const SECTIONS = [
  {
    key: "general",
    label: "General",
    description: "Create the local type used by bins, deliveries, and production runs.",
    icon: DatabaseIcon,
  },
  {
    key: "isometric",
    label: "Isometric",
    description: "Choose a certified registry feedstock to prefill the local type.",
    icon: SealCheckIcon,
  },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

const getSelectorId = (key: SectionKey) => `feedstock-type-selector-${key}`;
const getPanelId = (key: SectionKey) => `feedstock-type-panel-${key}`;

const CERTIFIED_FEEDSTOCK_WARNING =
  "Only feedstock types that exist in Isometric can pass verification. If this material is missing from the registry catalogue, create or approve it in Certify before using it for certified production.";

interface FeedstockTypeFormProps {
  feedstockType?: FeedstockType;
  onSubmit: (data: FeedstockTypeFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  errorMessage?: string;
  submitLabel?: string;
  defaultUsage?: FeedstockTypeUsage;
  /** When true, the usage select is constrained to the parent workflow's usage. */
  lockUsage?: boolean;
  /** Optional hint text shown above the form fields */
  hint?: string;
}

export function FeedstockTypeForm({
  feedstockType,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
  defaultUsage,
  lockUsage = false,
  hint,
}: FeedstockTypeFormProps) {
  const isEditMode = !!feedstockType;
  const [activeSection, setActiveSection] = useState<SectionKey>("general");
  const [selectedIsometricFeedstock, setSelectedIsometricFeedstock] =
    useState<IsometricFeedstockType | null>(null);
  // Fetch the registry browser lazily on first open; React Query keeps the
  // catalogue warm if the operator switches sections.
  const [hasOpenedIsometric, setHasOpenedIsometric] = useState(false);
  const sections = shouldShowIsometricFeedstockSection(lockUsage, defaultUsage)
    ? SECTIONS
    : SECTIONS.filter((section) => section.key === "general");
  // With only the General source there is no choice to present, so the source
  // selector and the registry-certification warning (which never applies to
  // internal-only blend materials) are both redundant.
  const showSourceSelector = sections.length > 1;

  const selectSection = (key: SectionKey) => {
    setActiveSection(key);
    if (key === "isometric") setHasOpenedIsometric(true);
  };

  // Roving tabindex keeps the selector compact for keyboard users.
  const handleSelectorKeyDown = (event: KeyboardEvent, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextKey =
      sections[(index + delta + sections.length) % sections.length].key;
    selectSection(nextKey);
    document.getElementById(getSelectorId(nextKey))?.focus();
  };

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<FeedstockTypeFormData>({
    resolver: zodResolver(feedstockTypeFormSchema),
    defaultValues: {
      name: feedstockType?.name ?? "",
      category: feedstockType?.category && (feedstockCategories as readonly string[]).includes(feedstockType.category)
        ? (feedstockType.category as FeedstockTypeFormData["category"])
        : undefined,
      usage: feedstockType?.usage && (feedstockTypeUsages as readonly string[]).includes(feedstockType.usage)
        ? (feedstockType.usage as FeedstockTypeFormData["usage"])
        : defaultUsage ?? "pyrolysis",
      description: feedstockType?.description ?? "",
      // No form field anymore (UI-only removal) — kept in form state so
      // edit-mode submits pass the persisted value through unchanged.
      registryUrl: feedstockType?.registryUrl ?? "",
      isometricFeedstockTypeId: feedstockType?.isometricFeedstockTypeId ?? "",
    },
  });

  const selectedUsage = useWatch({ control, name: "usage" });
  const selectedName = useWatch({ control, name: "name" });
  const categoryOptions =
    selectedUsage === "blend"
      ? BLEND_FEEDSTOCK_CATEGORY_OPTIONS
      : PYROLYSIS_FEEDSTOCK_CATEGORY_OPTIONS;
  const usageOptions =
    feedstockTypeUsageOptionsFor(lockUsage, defaultUsage);
  const selectedIsometricNameChanged =
    !!selectedIsometricFeedstock &&
    selectedName.trim() !== selectedIsometricFeedstock.name.trim();
  const showCertifiedFeedstockWarning =
    shouldShowCertifiedFeedstockWarning(
      isEditMode,
      selectedUsage,
      !!selectedIsometricFeedstock,
    );

  const handleSelectIsometricFeedstock = (type: IsometricFeedstockType) => {
    setSelectedIsometricFeedstock(type);
    if (
      shouldSetUsageToPyrolysisForIsometricSelection(lockUsage, defaultUsage)
    ) {
      setValue("usage", "pyrolysis", {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      if (shouldClearCategoryForIsometricSelection(selectedUsage)) {
        setValue("category", "" as FeedstockTypeFormData["category"], {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        });
      }
    }
    setValue("name", type.name, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("isometricFeedstockTypeId", type.id, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };
  const defaultSubmitLabel = isEditMode
    ? "Update Feedstock Type"
    : "Create Feedstock Type";
  const selectedIsometricSummary = selectedIsometricFeedstock && (
    <div className="flex gap-10 border border-[var(--st-ok-border)] bg-[var(--st-ok-bg)] px-12 py-10">
      <SealCheckIcon
        aria-hidden
        className="mt-1 size-18 shrink-0 text-[var(--st-ok)]"
        weight="bold"
      />
      <div className="flex flex-col gap-2">
        <p className="body-small text-[var(--color-text-primary)]">
          Selected from Isometric: {selectedIsometricFeedstock.name}
        </p>
        <p className="body-caption font-mono text-[var(--color-text-tertiary)]">
          {selectedIsometricFeedstock.id}
          {selectedIsometricFeedstock.supplier_reference_id
            ? ` · ref ${selectedIsometricFeedstock.supplier_reference_id}`
            : ""}
        </p>
        {selectedIsometricNameChanged && (
          <p className="body-caption text-[var(--st-wait)]">
            The local name no longer matches the selected Isometric feedstock.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-20">
      {showSourceSelector && (
      <div
        className="grid grid-cols-1 md:grid-cols-2 gap-12"
        role="radiogroup"
        aria-label="Feedstock type source"
      >
        {sections.map(({ key, label, description, icon: Icon }, index) => {
          const isActive = key === activeSection;
          return (
            <button
              key={key}
              type="button"
              id={getSelectorId(key)}
              role="radio"
              aria-checked={isActive ? "true" : "false"}
              aria-controls={getPanelId(key)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectSection(key)}
              onKeyDown={(event) => handleSelectorKeyDown(event, index)}
              className={cn(
                "flex min-h-[104px] w-full items-start gap-12 border p-12 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]",
                isActive
                  ? "border-[var(--color-text-primary)] bg-[var(--color-surface-medium)]"
                  : "border-[var(--color-border-secondary)] bg-[var(--color-background-white)] hover:border-[var(--color-border-primary)]"
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  "mt-2 size-20 shrink-0",
                  isActive
                    ? "text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-tertiary)]"
                )}
                weight="bold"
              />
              <span className="flex flex-col gap-4">
                <span className="label-button text-[var(--color-text-primary)]">
                  {label}
                </span>
                <span className="body-small text-[var(--color-text-secondary)]">
                  {description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      )}

      <form
        onSubmit={handleSubmit((data) => onSubmit(data))}
        className="space-y-20"
      >
        <div
          id={getPanelId("general")}
          aria-labelledby={
            showSourceSelector ? getSelectorId("general") : undefined
          }
          className={cn(activeSection !== "general" && "hidden")}
        >
          {activeSection === "general" && (
            <div className="space-y-20">
              {hint && (
                <p className="text-[var(--text-s)] text-[var(--color-text-tertiary)]">
                  {hint}
                </p>
              )}

              {selectedIsometricSummary}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
                <div className="space-y-10">
                  <FormField
                    id="usage"
                    label="Usage"
                    error={errors.usage?.message}
                    required
                  >
                    <FormSelect
                      id="usage"
                      placeholder="Select usage..."
                      disabled={isSubmitting}
                      error={!!errors.usage}
                      options={usageOptions}
                      {...register("usage", {
                        onChange: () =>
                          setValue(
                            "category",
                            "" as FeedstockTypeFormData["category"]
                          ),
                      })}
                    />
                  </FormField>
                  {showCertifiedFeedstockWarning && (
                    <div className="flex gap-10 border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] px-12 py-10">
                      <WarningCircleIcon
                        aria-hidden
                        className="mt-1 size-18 shrink-0 text-[var(--st-wait)]"
                        weight="bold"
                      />
                      <p className="body-small text-[var(--color-text-primary)]">
                        {CERTIFIED_FEEDSTOCK_WARNING}
                      </p>
                    </div>
                  )}
                  {lockUsage && (
                    <p className="body-caption text-[var(--color-text-tertiary)] mt-6">
                      Fixed by the parent workflow so this type cannot be
                      created with the wrong usage.
                    </p>
                  )}
                </div>

                <FormField id="name" label="Name" error={errors.name?.message} required>
                  <FormInput
                    id="name"
                    type="text"
                    placeholder="e.g., Coffee husks"
                    disabled={isSubmitting}
                    error={!!errors.name}
                    autoFocus
                    {...register("name")}
                  />
                </FormField>

                <FormField
                  id="category"
                  label="Category"
                  error={errors.category?.message}
                  required
                >
                  <FormSelect
                    id="category"
                    placeholder="Select category..."
                    disabled={isSubmitting}
                    error={!!errors.category}
                    options={categoryOptions}
                    {...register("category")}
                  />
                </FormField>
              </div>

              <FormField
                id="description"
                label="Description"
                error={errors.description?.message}
              >
                <FormTextarea
                  id="description"
                  placeholder="Optional description of the residue stream, sourcing context, or preparation"
                  disabled={isSubmitting}
                  error={!!errors.description}
                  {...register("description")}
                />
              </FormField>

              <FormActions
                onCancel={onCancel}
                isSubmitting={isSubmitting}
                errorMessage={errorMessage}
                submitLabel={submitLabel}
                defaultSubmitLabel={defaultSubmitLabel}
              />
            </div>
          )}
        </div>

        <div
          id={getPanelId("isometric")}
          aria-labelledby={
            showSourceSelector ? getSelectorId("isometric") : undefined
          }
          className={cn(activeSection !== "isometric" && "hidden")}
        >
          {activeSection === "isometric" && (
            <div className="space-y-20">
              {/* Only fetch once the section has first been opened. */}
              {hasOpenedIsometric && (
                <IsometricFeedstockBrowser
                  onSelect={handleSelectIsometricFeedstock}
                  selectedId={selectedIsometricFeedstock?.id ?? null}
                />
              )}

              {selectedIsometricFeedstock && (
                <div className="space-y-20 border-t border-[var(--color-border-secondary)] pt-20">
                  {selectedIsometricSummary}

                  <FormField
                    id="isometric-category"
                    label="Local category"
                    error={errors.category?.message}
                    required
                  >
                    <FormSelect
                      id="isometric-category"
                      placeholder="Select category..."
                      disabled={isSubmitting}
                      error={!!errors.category}
                      options={PYROLYSIS_FEEDSTOCK_CATEGORY_OPTIONS}
                      {...register("category")}
                    />
                  </FormField>

                  <FormActions
                    onCancel={onCancel}
                    isSubmitting={isSubmitting}
                    errorMessage={errorMessage}
                    submitLabel={submitLabel}
                    defaultSubmitLabel={defaultSubmitLabel}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
