"use client";

import { FormField, FormSelect, PositionPicker } from "@/components/forms";
import type { PositionValue } from "@/components/forms";

export type FieldPositionMode = "derive" | "manual";

const MODE_OPTIONS: readonly { value: FieldPositionMode; label: string }[] = [
  { value: "derive", label: "Derive from customer" },
  { value: "manual", label: "Set manually" },
];

const MODE_HELPER: Record<FieldPositionMode, string> = {
  derive: "Follows the delivery destination, and updates if you change it.",
  manual: "Search an address, click the map, or type the coordinates.",
};

export interface DerivedPosition {
  gpsLatitude: number;
  gpsLongitude: number;
}

type PositionFieldName = "gpsLatitude" | "gpsLongitude";
type ResetPositionField = (
  name: PositionFieldName,
  options: { defaultValue: number | null },
) => void;

export function resetFieldPosition(
  resetField: ResetPositionField,
  derived: DerivedPosition | null,
): void {
  resetField("gpsLatitude", {
    defaultValue: derived?.gpsLatitude ?? null,
  });
  resetField("gpsLongitude", {
    defaultValue: derived?.gpsLongitude ?? null,
  });
}

export function applyFieldPositionMode(
  next: FieldPositionMode,
  setMode: (mode: FieldPositionMode) => void,
  resetToDerived: () => void,
): void {
  setMode(next);
  if (next === "derive") resetToDerived();
}

/**
 * The mode is controlled by the owning form rather than held here: a latched
 * copy would keep showing "derive" against the new delivery's coordinates
 * while the form still held the previous ones, and would miss a mode that only
 * becomes resolvable once the deliveries query settles.
 */
export function FieldPositionField({
  derived,
  hasDelivery,
  latitude,
  longitude,
  latitudeError,
  longitudeError,
  disabled = false,
  mode,
  onModeChange,
  onPositionChange,
  onDerive,
}: {
  derived: DerivedPosition | null;
  hasDelivery: boolean;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  latitudeError?: string;
  longitudeError?: string;
  disabled?: boolean;
  mode: FieldPositionMode;
  onModeChange: (mode: FieldPositionMode) => void;
  onPositionChange: (position: PositionValue) => void;
  onDerive: () => void;
}) {
  return (
    <div className="flex flex-col gap-16">
      <div className="grid grid-cols-1 gap-x-16 gap-y-20 md:grid-cols-2">
        <FormField
          id="fieldPositionMode"
          label="Field position"
          helperText={MODE_HELPER[mode]}
        >
          <FormSelect
            id="fieldPositionMode"
            disabled={disabled}
            options={MODE_OPTIONS}
            value={mode}
            onChange={(event) =>
              applyFieldPositionMode(
                event.target.value as FieldPositionMode,
                onModeChange,
                onDerive,
              )
            }
          />
        </FormField>

        {mode === "derive" && (
          <div className="flex flex-col gap-4">
            <span className="body-small text-[var(--color-text-secondary)]">
              Customer location
            </span>
            <span className="body-medium font-medium text-[var(--color-text-primary)]">
              {derived
                ? `${derived.gpsLatitude}, ${derived.gpsLongitude}`
                : hasDelivery
                  ? "Not on this delivery"
                  : "Waiting on the delivery"}
            </span>
            {!derived && (
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {hasDelivery
                  ? "The destination customer has no coordinates. Set the position manually, or add them to the customer."
                  : "Choose a delivery in step 1 and the position follows its destination."}
              </span>
            )}
          </div>
        )}
      </div>

      {mode === "manual" && (
        <PositionPicker
          idPrefix="gps"
          label="Set the pin"
          accent="pink"
          latitude={latitude ?? null}
          longitude={longitude ?? null}
          onPositionChange={onPositionChange}
          latitudeError={latitudeError}
          longitudeError={longitudeError}
          disabled={disabled}
        />
      )}
    </div>
  );
}
