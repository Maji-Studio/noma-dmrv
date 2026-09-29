"use client";

/**
 * DistanceCalcField — distance number input with an inline Calculate button that
 * estimates the road distance between two resolved endpoints via the geo
 * server actions (map integration plan, Phase 1 §7).
 *
 * Provenance rules (plan decision 2):
 * - Calculate fill       → distanceSource = "map_estimate"
 * - hand-typed value     → distanceSource = "manual"
 * - cleared              → distanceSource = null
 * Calculate is enabled only when both endpoints have coordinates AND routing is
 * configured server-side; when disabled, the tooltip names what's missing.
 */

import { useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { FormField } from "@/components/forms/form-field";
import { FormInput } from "@/components/forms/form-input";
import { useGeoCapabilities, useRouteDistance } from "@/hooks/use-geo";
import {
  DISTANCE_SOURCE_LABELS,
  type DistanceSourceValue,
} from "@/schemas/distance-source";
import type { GeoPoint } from "@/lib/geo/types";
import type { CertFieldStatus } from "./cert-field-status";

interface DistanceCalcFieldProps {
  id: string;
  label: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  certifyRequired?: boolean;
  certifyStatus?: CertFieldStatus;
  disabled?: boolean;
  /**
   * Hide the source caption when the parent renders its own provenance UI
   * (e.g. the transport-leg form's distance-source select).
   */
  showSourceBadge?: boolean;
  distanceKm: number | null | undefined;
  distanceSource: DistanceSourceValue | null | undefined;
  onDistanceChange: (km: number | null, source: DistanceSourceValue | null) => void;
  /** Resolved Calculate endpoints — null while the endpoint has no coordinates. */
  origin: GeoPoint | null;
  destination: GeoPoint | null;
  /** Human endpoint names for the disabled explanation (e.g. "supplier position"). */
  originLabel: string;
  destinationLabel: string;
}

const ROUTING_UNAVAILABLE_MESSAGE =
  "Routing is not set up. Enter the distance by hand.";

export function formatDistance(value: number | null): string {
  return value == null ? "" : String(value);
}

/** Empty → null; parseable → number; anything else → undefined (keep draft). */
export function parseDistanceDraft(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * FormField clones its single child to attach `aria-describedby` and
 * `aria-invalid`. The input sits beside the button, so this wrapper takes
 * those props and hands them to the input instead of the layout div.
 */
function DistanceControl({
  inputProps,
  action,
  footer,
  ...aria
}: {
  inputProps: ComponentProps<typeof FormInput>;
  action: ReactNode;
  footer?: ReactNode;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  return (
    <div>
      <div className="flex items-stretch gap-6">
        <FormInput
          {...inputProps}
          aria-describedby={aria["aria-describedby"]}
          {...(aria["aria-invalid"] === true ? { "aria-invalid": true } : {})}
        />
        {action}
      </div>
      {footer}
    </div>
  );
}

export function DistanceCalcField({
  id,
  label,
  helperText,
  error,
  required = false,
  certifyRequired = false,
  certifyStatus,
  disabled = false,
  showSourceBadge = true,
  distanceKm,
  distanceSource,
  onDistanceChange,
  origin,
  destination,
  originLabel,
  destinationLabel,
}: DistanceCalcFieldProps) {
  const value = distanceKm ?? null;
  const source = distanceSource ?? null;

  const { data: capabilities } = useGeoCapabilities();
  const routingConfigured = capabilities?.routingConfigured ?? false;
  const route = useRouteDistance();

  // Text draft so in-flight typing survives; resync when the value changes
  // from outside (Calculate fill) — adjust-state-during-render pattern.
  const [draft, setDraft] = useState(formatDistance(value));
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (parseDistanceDraft(draft) !== value) setDraft(formatDistance(value));
  }

  const handleManualChange = (raw: string) => {
    // A failed Calculate keeps isError until reset(), so the red message would sit
    // next to a hand-typed value the operator just fixed. Clear the mutation
    // itself, not only its rendering.
    if (route.isError) route.reset();
    setDraft(raw);
    const parsed = parseDistanceDraft(raw);
    if (parsed === undefined) return; // unparseable in-flight text — wait
    if (parsed !== value) {
      setSyncedValue(parsed);
      onDistanceChange(parsed, parsed == null ? null : "manual");
    }
  };

  const missing: string[] = [];
  if (!origin) missing.push(`${originLabel} coordinates`);
  if (!destination) missing.push(`${destinationLabel} coordinates`);
  const canCalc =
    routingConfigured && missing.length === 0 && !disabled && !route.isPending;

  const tooltipContent = !routingConfigured
    ? ROUTING_UNAVAILABLE_MESSAGE
    : missing.length > 0
      ? `Calculate needs: ${missing.join(", ")}.`
      : `Estimate road distance ${originLabel} → ${destinationLabel}. The result stays editable.`;

  const handleCalc = () => {
    if (!origin || !destination) return;
    route.mutate(
      { origin, destination },
      {
        onSuccess: (km) => {
          setSyncedValue(km);
          setDraft(formatDistance(km));
          onDistanceChange(km, "map_estimate");
        },
      }
    );
  };

  return (
    <FormField
      id={id}
      label={label}
      error={error ?? (route.isError ? route.error.message : undefined)}
      helperText={helperText}
      required={required}
      certifyRequired={certifyRequired}
      certifyStatus={certifyStatus}
    >
      <DistanceControl
        inputProps={{
          id,
          type: "number",
          step: "any",
          min: 0,
          placeholder: "e.g., 85",
          className: "grow",
          disabled,
          error: !!error,
          value: draft,
          onChange: (event) => handleManualChange(event.target.value),
        }}
        action={
          <Tooltip content={tooltipContent} side="top">
            {/* span trigger: disabled buttons swallow hover, and the tooltip
                matters most exactly when the button is disabled. It is only a
                tab stop while the button cannot take focus itself, so the
                control is never two stops; focus on the enabled button
                bubbles to the trigger and still opens the tooltip. */}
            <span
              tabIndex={canCalc ? undefined : 0}
              className="inline-flex focus-visible:outline-none"
            >
              <Button
                type="button"
                variant="default"
                className="h-40 px-12"
                disabled={!canCalc}
                busy={route.isPending}
                aria-label={`Calculate road distance ${originLabel} to ${destinationLabel}`}
                onClick={handleCalc}
              >
                Calculate
              </Button>
            </span>
          </Tooltip>
        }
        footer={
          showSourceBadge && source ? (
            <p
              className="body-caption text-[var(--color-text-tertiary)] mt-6"
              data-testid={`${id}-distance-source`}
            >
              Source: {DISTANCE_SOURCE_LABELS[source]}
            </p>
          ) : null
        }
      />
    </FormField>
  );
}
