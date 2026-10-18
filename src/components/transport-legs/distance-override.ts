/**
 * Distance override (GLOSSARY): the two states of a feedstock or delivery
 * distance and the patch each state sends.
 *
 * A record either derives its one-way distance from its location's facility
 * pair, or carries an explicit override. The form never sends a derived
 * distance back as data: an omitted key preserves the stored value, `null`
 * clears an override (the server then clears its provenance), and a positive
 * number sets one.
 */
import type { DetailPanelField } from "@/components/ui/detail-panel";
import { formatDistanceKm } from "@/lib/format-utils";
import { DELIVERY_DISTANCE_MESSAGE } from "@/schemas/delivery-input";
import { DISTANCE_SOURCE_LABELS, type DistanceSourceValue } from "@/schemas/distance-source";

/** One label per field on the form and its read view (design-system "A label and its mirror"). */
export const DISTANCE_FIELD_LABEL = "One-way distance";
export const DISTANCE_SOURCE_FIELD_LABEL = "Distance source";
export const DISTANCE_NOTE_FIELD_LABEL = "Distance note";
export const OVERRIDE_BUTTON_LABEL = "Override";
export const RESET_TO_DEFAULT_BUTTON_LABEL = "Reset to default";
export const RESET_TO_DEFAULT_ARIA_LABEL = "Reset to the location default";
export const OVERRIDE_DISTANCE_REQUIRED_MESSAGE = "Enter a distance, or reset the override.";
/** The schemas' own positive-distance message, so the field and the server agree. */
export const OVERRIDE_DISTANCE_POSITIVE_MESSAGE = DELIVERY_DISTANCE_MESSAGE;

/** Sources an operator can give an override. A legacy route calculation stays shown, never offered. */
const OVERRIDE_SOURCES = ["manual", "document"] as const satisfies readonly DistanceSourceValue[];

/** What the record holds now, before this edit. Null for a create. */
export interface SavedDistanceOverride {
  distanceKm: number | null;
  source: DistanceSourceValue | null;
  note: string | null;
}

/** What the form holds now. */
export interface DistanceOverrideDraft {
  /** The operator unlocked manual entry (or the record opened with an override). */
  overriding: boolean;
  distanceKm: number | null | undefined;
  source: DistanceSourceValue | null | undefined;
  note: string | null | undefined;
}

/** Keys absent from the patch are omitted from the request, which preserves them. */
export interface DistanceOverridePatch {
  distanceKm?: number | null;
  source?: DistanceSourceValue | null;
  note?: string | null;
}

function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** An override distance counts only when positive; a legacy zero means derived. */
export function isOverrideDistance(distanceKm: number | null | undefined): distanceKm is number {
  return distanceKm != null && distanceKm > 0;
}

export function hasSavedOverride(saved: SavedDistanceOverride | null | undefined): boolean {
  return isOverrideDistance(saved?.distanceKm);
}

/**
 * The request fields for the draft:
 *
 * | Intent | distanceKm |
 * | --- | --- |
 * | Derived create, or unchanged derived edit | omitted |
 * | Set override | positive number, with its source (and note when given) |
 * | Clear override | null (the server clears the source; the note clears with it) |
 * | Unchanged override | omitted |
 *
 * A legacy zero override is cleared on the next save, as before.
 */
export function distanceOverridePatch(
  saved: SavedDistanceOverride | null | undefined,
  draft: DistanceOverrideDraft,
  options: {
    /**
     * The supplier, facility or order changed. The server drops the saved
     * override on a new route, so nothing saved may stand in for the draft:
     * an override is always sent in full, and a stale note is cleared.
     */
    routeChanged?: boolean;
  } = {},
): DistanceOverridePatch {
  const savedKm = saved?.distanceKm ?? null;
  const note = normalizeNote(draft.note);
  if (!draft.overriding) {
    const hadOverride = savedKm != null || (options.routeChanged && normalizeNote(saved?.note) != null);
    return hadOverride ? { distanceKm: null, note: null } : {};
  }
  const distanceKm = draft.distanceKm ?? null;
  const source = draft.source ?? "manual";
  if (options.routeChanged) return { distanceKm, source, note };
  const patch: DistanceOverridePatch = {};
  if (!hasSavedOverride(saved) || distanceKm !== savedKm || source !== (saved?.source ?? null)) {
    patch.distanceKm = distanceKm;
    patch.source = source;
  }
  if (note !== normalizeNote(saved?.note)) patch.note = note;
  return patch;
}

/** The field error for an override that cannot be saved, or null. */
export function overrideDistanceError(draft: DistanceOverrideDraft): string | null {
  if (!draft.overriding) return null;
  if (draft.distanceKm == null || !Number.isFinite(draft.distanceKm)) return OVERRIDE_DISTANCE_REQUIRED_MESSAGE;
  return draft.distanceKm > 0 ? null : OVERRIDE_DISTANCE_POSITIVE_MESSAGE;
}

/** A select's empty option is no source, never an empty string the schema rejects. */
export const emptyToNullSource = (value: unknown) => (value === "" || value == null ? null : value);

/** Options for the override's Distance source select. */
export function overrideSourceOptions(current: DistanceSourceValue | null | undefined) {
  const values: DistanceSourceValue[] = [...OVERRIDE_SOURCES];
  if (current && !values.includes(current)) values.push(current);
  return values.map((value) => ({ value, label: DISTANCE_SOURCE_LABELS[value] }));
}

export function sourceLabel(source: DistanceSourceValue | null | undefined): string | null {
  return source ? DISTANCE_SOURCE_LABELS[source] : null;
}

/**
 * Where the distance comes from, for the ⓘ beside the One-way distance label
 * on the form and the read view alike.
 */
export function distanceProvenance({
  overriding, locationName, source, locationDefaultKm,
}: {
  overriding: boolean;
  /** The location the default comes from; null when not known. */
  locationName: string | null | undefined;
  /** The derived distance's source. */
  source: DistanceSourceValue | null | undefined;
  /** What resetting an override returns to; null when the location has none. */
  locationDefaultKm: number | null | undefined;
}): string {
  if (overriding) {
    return locationDefaultKm == null
      ? "Override. The location has no distance for this facility."
      : `Override. Location default is ${formatDistanceKm(locationDefaultKm)}.`;
  }
  const from = `From ${locationName ?? "the location default"}.`;
  const label = sourceLabel(source);
  return label ? `${from} Source: ${label}.` : from;
}

/**
 * The read view's mirror of the form's One-way distance field: the distance
 * the record counts, with its provenance behind the ⓘ as on the form.
 */
export function distanceReadFields({
  overrideKm, effectiveKm, note, pending = false, locationName, derivedSource, locationDefaultKm,
}: {
  overrideKm: number | null;
  /** The distance the record counts. */
  effectiveKm: number | null | undefined;
  note: string | null;
  pending?: boolean;
  locationName?: string | null;
  /** The recorded location distance's source. */
  derivedSource?: DistanceSourceValue | null;
  /** What resetting the override returns to. */
  locationDefaultKm?: number | null;
}): DetailPanelField[] {
  const overridden = isOverrideDistance(overrideKm);
  return [
    {
      label: DISTANCE_FIELD_LABEL,
      value: effectiveKm == null ? null : formatDistanceKm(effectiveKm),
      pending,
      hint: distanceProvenance({ overriding: overridden, locationName, source: derivedSource, locationDefaultKm }),
    },
    ...(overridden ? [{ label: DISTANCE_NOTE_FIELD_LABEL, value: note }] : []),
  ];
}
