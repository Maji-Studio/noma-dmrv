"use client";

/**
 * DistanceCalcField — distance number input with an inline CALC button that
 * estimates the road distance between two resolved endpoints via the geo
 * server actions (map integration plan, Phase 1 §7).
 *
 * Provenance rules (plan decision 2):
 * - CALC fill            → distanceSource = "map_estimate"
 * - hand-typed value     → distanceSource = "manual"
 * - cleared              → distanceSource = null
 * CALC is enabled only when both endpoints have coordinates AND routing is
 * configured server-side; when disabled, the tooltip names what's missing.
 */

import { useState } from "react";
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

interface DistanceCalcFieldProps {
  id: string;
  label: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  distanceKm: number | null | undefined;
  distanceSource: DistanceSourceValue | null | undefined;
  onDistanceChange: (km: number | null, source: DistanceSourceValue | null) => void;
  /** Resolved CALC endpoints — null while the endpoint has no coordinates. */
  origin: GeoPoint | null;
  destination: GeoPoint | null;
  /** Human endpoint names for the disabled explanation (e.g. "supplier position"). */
  originLabel: string;
  destinationLabel: string;
}

function formatDistance(value: number | null): string {
  return value == null ? "" : String(value);
}

/** Empty → null; parseable → number; anything else → undefined (keep draft). */
function parseDraft(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function DistanceCalcField({
  id,
  label,
  helperText,
  error,
  required = false,
  disabled = false,
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
  // from outside (CALC fill) — adjust-state-during-render pattern.
  const [draft, setDraft] = useState(formatDistance(value));
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (parseDraft(draft) !== value) setDraft(formatDistance(value));
  }

  const handleManualChange = (raw: string) => {
    setDraft(raw);
    const parsed = parseDraft(raw);
    if (parsed === undefined) return; // unparseable in-flight text — wait
    if (parsed !== value) {
      setSyncedValue(parsed);
      onDistanceChange(parsed, parsed == null ? null : "manual");
    }
  };

  const missing: string[] = [];
  if (!routingConfigured) {
    missing.push("routing service (OPENROUTESERVICE_API_KEY not configured)");
  }
  if (!origin) missing.push(`${originLabel} coordinates`);
  if (!destination) missing.push(`${destinationLabel} coordinates`);
  const canCalc = missing.length === 0 && !disabled && !route.isPending;

  const tooltipContent =
    missing.length > 0
      ? `CALC needs: ${missing.join(", ")}.`
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
    >
      <div>
        <div className="flex items-stretch gap-6">
          <FormInput
            id={id}
            type="number"
            step="any"
            min={0}
            placeholder="e.g., 85"
            className="grow"
            disabled={disabled}
            error={!!error}
            value={draft}
            onChange={(event) => handleManualChange(event.target.value)}
          />
          <Tooltip content={tooltipContent} side="top">
            {/* span trigger: disabled buttons swallow hover, and the tooltip
                matters most exactly when the button is disabled */}
            <span tabIndex={0} className="inline-flex focus-visible:outline-none">
              <Button
                type="button"
                variant="default"
                className="h-40 px-12 label-button uppercase"
                disabled={!canCalc}
                aria-label={`Calculate road distance ${originLabel} to ${destinationLabel}`}
                onClick={handleCalc}
              >
                {route.isPending ? "…" : "CALC"}
              </Button>
            </span>
          </Tooltip>
        </div>
        {source && (
          <p
            className="body-caption uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] mt-6"
            data-testid={`${id}-distance-source`}
          >
            Source: {DISTANCE_SOURCE_LABELS[source]}
          </p>
        )}
      </div>
    </FormField>
  );
}
