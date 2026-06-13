"use client";

import { useState, type KeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@/lib/utils";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { FormActions } from "@/components/forms/form-actions";
import {
  feedstockTypeFormSchema,
  BLEND_FEEDSTOCK_CATEGORY_OPTIONS,
  FEEDSTOCK_TYPE_USAGE_OPTIONS,
  PYROLYSIS_FEEDSTOCK_CATEGORY_OPTIONS,
  feedstockCategories,
  feedstockTypeUsages,
  type FeedstockTypeUsage,
  type FeedstockTypeFormData,
} from "@/schemas/feedstock-types";
import type { FeedstockType } from "@/db/schema/feedstock";
import { IsometricFeedstockBrowser } from "./isometric-feedstock-browser";

// General = the local record (the only editable surface). Isometric =
// read-only browse of the registry catalogue (browse-only by design — no
// import, no local record created from it). The Registry URL column stays in
// the schema; it just no longer has a form field.
const TABS = [
  { key: "general", label: "General" },
  { key: "isometric", label: "Isometric" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const getTabId = (key: TabKey) => `feedstock-type-tab-${key}`;
const getPanelId = (key: TabKey) => `feedstock-type-panel-${key}`;

interface FeedstockTypeFormProps {
  feedstockType?: FeedstockType;
  onSubmit: (data: FeedstockTypeFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  defaultUsage?: FeedstockTypeUsage;
  /** Optional hint text shown above the form fields */
  hint?: string;
}

export function FeedstockTypeForm({
  feedstockType,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  defaultUsage,
  hint,
}: FeedstockTypeFormProps) {
  const isEditMode = !!feedstockType;
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  // Mount the registry browser lazily on first open, then keep it mounted so
  // its local state (search, scroll) survives tab switches.
  const [hasOpenedIsometric, setHasOpenedIsometric] = useState(false);

  const selectTab = (key: TabKey) => {
    setActiveTab(key);
    if (key === "isometric") setHasOpenedIsometric(true);
  };

  // Roving tabindex (inactive tabs are tabIndex=-1), so arrow keys are the
  // only keyboard path between tabs.
  const handleTabKeyDown = (event: KeyboardEvent, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextKey = TABS[(index + delta + TABS.length) % TABS.length].key;
    selectTab(nextKey);
    document.getElementById(getTabId(nextKey))?.focus();
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
    },
  });

  const selectedUsage = useWatch({ control, name: "usage" });
  const categoryOptions =
    selectedUsage === "blend"
      ? BLEND_FEEDSTOCK_CATEGORY_OPTIONS
      : PYROLYSIS_FEEDSTOCK_CATEGORY_OPTIONS;

  return (
    <div className="space-y-20">
      <div
        className="flex gap-0 border-b border-[var(--color-border-secondary)]"
        role="tablist"
        aria-label="Feedstock type sections"
      >
        {TABS.map(({ key, label }, index) => {
          const isActive = key === activeTab;
          return (
            <button
              key={key}
              type="button"
              id={getTabId(key)}
              role="tab"
              aria-selected={isActive ? "true" : "false"}
              aria-controls={getPanelId(key)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectTab(key)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className="flex shrink-0 items-center h-[40px] px-16 label-button transition-colors cursor-pointer"
              style={{
                color: isActive
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
                borderBottom: isActive
                  ? "2px solid var(--color-text-primary)"
                  : "2px solid transparent",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Both panels stay mounted (inactive one hidden) so RHF field state
          survives tab switches. */}
      <form
        id={getPanelId("general")}
        role="tabpanel"
        aria-labelledby={getTabId("general")}
        onSubmit={handleSubmit((data) => onSubmit(data))}
        className={cn("space-y-20", activeTab !== "general" && "hidden")}
      >
        {hint && (
          <p className="text-[var(--text-s)] text-[var(--color-text-tertiary)]">
            {hint}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
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
              options={FEEDSTOCK_TYPE_USAGE_OPTIONS}
              {...register("usage", {
                onChange: () => setValue("category", "" as FeedstockTypeFormData["category"]),
              })}
            />
          </FormField>

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
          submitLabel={submitLabel}
          defaultSubmitLabel={isEditMode ? "Update Feedstock Type" : "Create Feedstock Type"}
        />
      </form>

      <div
        id={getPanelId("isometric")}
        role="tabpanel"
        aria-labelledby={getTabId("isometric")}
        className={cn(activeTab !== "isometric" && "hidden")}
      >
        {/* Only fetch once the tab has first been opened. */}
        {hasOpenedIsometric && <IsometricFeedstockBrowser />}
      </div>
    </div>
  );
}
