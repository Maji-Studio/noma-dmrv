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
import { DISTANCE_SOURCE_LABELS, type DistanceSourceValue } from "@/schemas/distance-source";

/** One label per field on the form and its read view (design-system "A label and its mirror"). */
export const DISTANCE_FIELD_LABEL = "One-way distance";
export const DISTANCE_SOURCE_FIELD_LABEL = "Distance source";
export const DISTANCE_NOTE_FIELD_LABEL = "Distance note";
export const OVERRIDE_BUTTON_LABEL = "Override";
export const CLEAR_OVERRIDE_BUTTON_LABEL = "Clear override";
export const DERIVED_BASIS_LABEL = "Location default";
export const OVERRIDE_BASIS_LABEL = "Override";
export const OVERRIDE_DISTANCE_REQUIRED_MESSAGE = "Enter a distance, or clear the override.";
export const OVERRIDE_DISTANCE_POSITIVE_MESSAGE = "Distance must be greater than 0";

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

/** A saved override counts only when positive; a legacy zero means derived. */
export function hasSavedOverride(saved: SavedDistanceOverride | null | undefined): boolean {
  return saved?.distanceKm != null && saved.distanceKm > 0;
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

const BASIS_LABEL = "Basis";

/**
 * The read view's mirror of the form's One-way distance field: the distance
 * the record counts, and whether it is the location default or an override.
 */
export function distanceReadFields({
  overrideKm, effectiveKm, note, pending = false,
}: {
  overrideKm: number | null;
  /** The distance the record counts. */
  effectiveKm: number | null | undefined;
  note: string | null;
  pending?: boolean;
}): DetailPanelField[] {
  const overridden = overrideKm != null && overrideKm > 0;
  return [
    {
      label: DISTANCE_FIELD_LABEL,
      value: effectiveKm == null ? null : formatDistanceKm(effectiveKm),
      pending,
      secondary: { label: BASIS_LABEL, value: overridden ? OVERRIDE_BASIS_LABEL : DERIVED_BASIS_LABEL },
    },
    ...(overridden ? [{ label: DISTANCE_NOTE_FIELD_LABEL, value: note }] : []),
  ];
}
