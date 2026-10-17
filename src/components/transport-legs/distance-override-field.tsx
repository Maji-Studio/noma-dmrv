"use client";

/**
 * DistanceOverrideField: the two-state one-way distance of a feedstock or a
 * delivery (GLOSSARY "Distance override").
 *
 * Derived: the location's facility distance shows greyed and read-only, with
 * an outline "Override" button beside the input that unlocks manual entry.
 * Override: an editable distance with its source and an optional note, and
 * the same button reads "Reset override" and returns to the derived
 * value. Where the value comes from reads behind the label's ⓘ.
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
import { cn } from "@/lib/utils";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import {
  DISTANCE_FIELD_LABEL,
  DISTANCE_NOTE_FIELD_LABEL,
  DISTANCE_SOURCE_FIELD_LABEL,
  distanceProvenance,
  OVERRIDE_BUTTON_LABEL,
  overrideSourceOptions,
  RESET_OVERRIDE_BUTTON_LABEL,
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
  /** Explanation behind the ⓘ, after the provenance line: when to override. */
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
  /** A compact line under the derived input, such as the refresh from location action. */
  footer?: ReactNode;
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
 * `aria-invalid`. The input sits beside the action button, so this row takes
 * those props and hands them to the input. The row wraps on a narrow screen:
 * the input keeps a usable width and the button drops below it.
 */
function DistanceRow({
  inputProps,
  action,
  captionId,
  ...aria
}: {
  inputProps: ComponentProps<typeof FormInput>;
  action: ReactNode;
  captionId: string | undefined;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const describedBy = [aria["aria-describedby"], captionId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-wrap items-start gap-8">
      <div className="relative min-w-[128px] flex-1 basis-[128px]">
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

/** The visible line under the field: only what the operator can act on. */
function caption({
  overriding, derived, pending, locationName, awaitingMessage,
}: Pick<DistanceOverrideFieldProps, "overriding" | "derived" | "pending" | "locationName" | "awaitingMessage">): {
  text: string; missing: boolean;
} | null {
  if (pending) return null;
  if (awaitingMessage) return { text: awaitingMessage, missing: false };
  if (!overriding && derived.distanceKm == null) {
    return { text: `${locationName ?? "The location"} has no distance for this facility.`, missing: true };
  }
  return null;
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
  footer,
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
  const captionId = `${id}-caption`;
  const line = caption({ overriding, derived, pending, locationName, awaitingMessage });
  const provenance = pending || awaitingMessage || (!overriding && derived.distanceKm == null)
    ? undefined
    : distanceProvenance({ overriding, locationName, source: derived.source, locationDefaultKm: derived.distanceKm });

  const action = (
    <Button
      type="button"
      variant="default"
      className="shrink-0"
      disabled={disabled}
      autoFocus={!overriding && focusTarget === "override"}
      aria-label={overriding ? `${RESET_OVERRIDE_BUTTON_LABEL} to the location default` : `${OVERRIDE_BUTTON_LABEL} the ${DISTANCE_FIELD_LABEL.toLowerCase()}`}
      onClick={() => {
        if (overriding) {
          setFocusTarget("override");
          onClear();
        } else {
          setFocusTarget("input");
          onOverride();
        }
      }}
    >
      {overriding ? RESET_OVERRIDE_BUTTON_LABEL : OVERRIDE_BUTTON_LABEL}
    </Button>
  );

  return (
    <div className="space-y-20" data-distance-basis={overriding ? "override" : "derived"}>
      <div>
        <FormField
          id={id}
          label={DISTANCE_FIELD_LABEL}
          labelUnit={DISTANCE_UNIT}
          hint={provenance}
          helperText={hint}
          error={overriding ? errors?.distanceKm : undefined}
          certifyRequired={certifyRequired}
          certifyStatus={certifyStatus}
        >
          <DistanceRow
            // A fresh row per state, so autoFocus moves focus with the switch.
            key={overriding ? "override" : "derived"}
            captionId={line ? captionId : undefined}
            action={action}
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
        {line && (
          // The margin sits on a wrapper: type classes beat margin utilities.
          <div className="mt-6">
            <p id={captionId} className="body-caption text-[var(--color-text-tertiary)]">
              {line.text}
              {line.missing && repairHref ? <> <RepairLink href={repairHref} /></> : null}
            </p>
          </div>
        )}
        {!overriding && footer != null && <div className="mt-6">{footer}</div>}
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
