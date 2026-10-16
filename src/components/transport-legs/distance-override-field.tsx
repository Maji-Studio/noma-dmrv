"use client";

/**
 * DistanceOverrideField: the two-state one-way distance of a feedstock or a
 * delivery (GLOSSARY "Distance override").
 *
 * Derived: the location's facility distance shows greyed and read-only with
 * its provenance, and a tertiary "Override" button unlocks manual entry.
 * Override: an editable distance with its source and an optional note, and
 * "Clear override" returns to the derived value. The label row names the
 * state in both, so derived and manual never read the same.
 *
 * The owning form keeps the values in React Hook Form and maps them to its
 * request with `distanceOverridePatch`.
 */
import { useState, type ComponentProps, type ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { ControlUnitSuffix, FormField, unitEndPadding } from "@/components/forms/form-field";
import { FormInput } from "@/components/forms/form-input";
import { FormSelect } from "@/components/forms/form-select";
import { FormTextarea } from "@/components/forms/form-textarea";
import { DISTANCE_UNIT, formatDistance } from "@/components/forms/distance-calc-field";
import type { CertFieldStatus } from "@/components/forms/cert-field-status";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDistanceKm } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import {
  CLEAR_OVERRIDE_BUTTON_LABEL,
  DERIVED_BASIS_LABEL,
  DISTANCE_FIELD_LABEL,
  DISTANCE_NOTE_FIELD_LABEL,
  DISTANCE_SOURCE_FIELD_LABEL,
  OVERRIDE_BASIS_LABEL,
  OVERRIDE_BUTTON_LABEL,
  overrideSourceOptions,
  sourceLabel,
} from "./distance-override";

export const LOCATION_DISTANCE_LINK_LABEL = "Add the location distance";

const DISTANCE_INPUT_STYLE = { paddingInlineEnd: unitEndPadding(DISTANCE_UNIT) } as const;
const DERIVED_INPUT_CLASSES =
  "bg-[var(--color-background-medium)] text-[color:var(--color-text-secondary)] cursor-default";
const LINK_ICON_SIZE = 14;

type FocusTarget = "input" | "override" | null;

export interface DistanceOverrideFieldProps {
  /** The override input's id; also the RHF field name the parent registers. */
  id: string;
  sourceId: string;
  noteId: string;
  /** Explanation behind the ⓘ: where the derived value comes from and when to override. */
  hint: string;
  overriding: boolean;
  onOverride: () => void;
  onClear: () => void;
  /**
   * The value shown while derived, or the value clearing returns to. Null when
   * the location has no distance for this facility.
   */
  derived: { distanceKm: number | null; source: DistanceSourceValue | null };
  /** The derived distance is still loading: claim nothing about it yet. */
  pending?: boolean;
  /** The location the derived distance comes from; null before one is chosen. */
  locationName: string | null;
  /** Shown instead of provenance while no supplier or order is chosen; null once one is. */
  awaitingMessage?: string | null;
  /** Where the missing location distance is fixed. Opens in a new tab so the draft survives. */
  repairHref?: string | null;
  distanceRegistration: UseFormRegisterReturn;
  sourceRegistration: UseFormRegisterReturn;
  noteRegistration: UseFormRegisterReturn;
  /** The draft source, so a legacy route calculation stays selectable in place. */
  source: DistanceSourceValue | null | undefined;
  notePlaceholder: string;
  errors?: { distanceKm?: string; source?: string; note?: string };
  disabled?: boolean;
  certifyRequired?: boolean;
  certifyStatus?: CertFieldStatus;
}

function RepairLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-4 font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
    >
      <ArrowSquareOutIcon aria-hidden size={LINK_ICON_SIZE} weight="bold" />
      {LOCATION_DISTANCE_LINK_LABEL}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * FormField clones its single child to attach `aria-describedby` and
 * `aria-invalid`. The input sits beside a button, so this row takes those
 * props and hands them to the input, adding the provenance line.
 */
function DistanceRow({
  inputProps,
  action,
  captionId,
  ...aria
}: {
  inputProps: ComponentProps<typeof FormInput>;
  action: ReactNode;
  captionId: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const describedBy = [aria["aria-describedby"], captionId].filter(Boolean).join(" ");
  return (
    <div className="flex items-start gap-8">
      <div className="relative grow">
        <FormInput
          {...inputProps}
          className={cn("peer w-full", inputProps.className)}
          style={DISTANCE_INPUT_STYLE}
          aria-describedby={describedBy}
          {...(aria["aria-invalid"] === true ? { "aria-invalid": true } : {})}
        />
        <ControlUnitSuffix unit={DISTANCE_UNIT} />
      </div>
      {action}
    </div>
  );
}

function caption({
  overriding, derived, pending, locationName, awaitingMessage,
}: Pick<DistanceOverrideFieldProps, "overriding" | "derived" | "pending" | "locationName" | "awaitingMessage">): {
  text: string; missing: boolean;
} {
  if (pending) return { text: "", missing: false };
  if (awaitingMessage) return { text: awaitingMessage, missing: false };
  if (derived.distanceKm == null) {
    return { text: `${locationName ?? "The location"} has no distance for this facility.`, missing: true };
  }
  if (overriding) {
    return { text: `Clearing returns to the location default, ${formatDistanceKm(derived.distanceKm)}.`, missing: false };
  }
  const source = sourceLabel(derived.source);
  const from = `From ${locationName ?? "the location"}.`;
  return { text: source ? `${from} Source: ${source}.` : from, missing: false };
}

export function DistanceOverrideField({
  id,
  sourceId,
  noteId,
  hint,
  overriding,
  onOverride,
  onClear,
  derived,
  pending = false,
  locationName,
  awaitingMessage,
  repairHref,
  distanceRegistration,
  sourceRegistration,
  noteRegistration,
  source,
  notePlaceholder,
  errors,
  disabled = false,
  certifyRequired,
  certifyStatus,
}: DistanceOverrideFieldProps) {
  // Focus follows the switch, so keyboard users land on the control that
  // replaced the one they pressed. Applied only on mount (autoFocus).
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);
  const captionId = `${id}-basis`;
  const { text, missing } = caption({ overriding, derived, pending, locationName, awaitingMessage });

  const toggle = overriding ? (
    <Button
      type="button"
      variant="noOutline"
      disabled={disabled}
      onClick={() => {
        setFocusTarget("override");
        onClear();
      }}
    >
      {CLEAR_OVERRIDE_BUTTON_LABEL}
    </Button>
  ) : (
    <Button
      type="button"
      variant="noOutline"
      disabled={disabled}
      autoFocus={focusTarget === "override"}
      onClick={() => {
        setFocusTarget("input");
        onOverride();
      }}
    >
      {OVERRIDE_BUTTON_LABEL}
    </Button>
  );

  return (
    <div className="space-y-20" data-distance-basis={overriding ? "override" : "derived"}>
      <div>
        <FormField
          id={id}
          label={DISTANCE_FIELD_LABEL}
          labelUnit={DISTANCE_UNIT}
          hint={hint}
          error={overriding ? errors?.distanceKm : undefined}
          certifyRequired={certifyRequired}
          certifyStatus={certifyStatus}
          aside={overriding ? OVERRIDE_BASIS_LABEL : derived.distanceKm != null && !pending ? DERIVED_BASIS_LABEL : undefined}
        >
          <DistanceRow
            // A fresh row per state, so autoFocus moves focus with the switch.
            key={overriding ? "override" : "derived"}
            captionId={captionId}
            action={toggle}
            inputProps={overriding ? {
              id,
              type: "number",
              step: "any",
              min: 0,
              placeholder: "e.g., 85",
              disabled,
              autoFocus: focusTarget === "input",
              error: !!errors?.distanceKm,
              ...distanceRegistration,
            } : {
              id,
              type: "number",
              readOnly: true,
              value: formatDistance(derived.distanceKm),
              placeholder: pending ? "" : MISSING_VALUE.notRecorded,
              "aria-busy": pending || undefined,
              className: DERIVED_INPUT_CLASSES,
            }}
          />
        </FormField>
        {/* The margin sits on a wrapper: type classes beat margin utilities. */}
        <div className="mt-6">
          <p id={captionId} className="body-caption text-[var(--color-text-tertiary)]">
            {text}
            {missing && repairHref ? <> <RepairLink href={repairHref} /></> : null}
          </p>
        </div>
      </div>

      {overriding && (
        <>
          <FormField id={sourceId} label={DISTANCE_SOURCE_FIELD_LABEL} error={errors?.source}>
            <FormSelect
              id={sourceId}
              options={overrideSourceOptions(source)}
              disabled={disabled}
              error={!!errors?.source}
              {...sourceRegistration}
            />
          </FormField>
          <FormField
            id={noteId}
            label={DISTANCE_NOTE_FIELD_LABEL}
            error={errors?.note}
            hint="Why this trip needs its own distance, such as a detour or a closed road."
          >
            <FormTextarea
              id={noteId}
              rows={2}
              placeholder={notePlaceholder}
              disabled={disabled}
              error={!!errors?.note}
              {...noteRegistration}
            />
          </FormField>
        </>
      )}
    </div>
  );
}
