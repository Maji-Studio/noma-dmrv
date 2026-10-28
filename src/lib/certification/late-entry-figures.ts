import type { EmissionFigure } from "./emission-lines";
import type { RemovalEntryContributions } from "./removal-emission-contributions";

type EntryFigureSource = { total: EmissionFigure | null; values: readonly { magnitude: string; unit: string }[] };

/** A sheet row for an entry carried into, or recorded after, a Removal. */
export type CarriedEntryRow = NonNullable<RemovalEntryContributions["carriedEntries"]>[number] & {
  /** Every input figure of a paired entry; absent for a single-value entry. */
  values?: readonly EmissionFigure[];
};

/** What an entry shows: its total when it has one value, else every input (a paired entry has no single total). */
export function entryFigures(entry: EntryFigureSource): EmissionFigure[] {
  if (entry.total && entry.values.length === 1) return [entry.total];
  return entry.values.map(({ magnitude, unit }) => ({ magnitude, unit }));
}

/** The late-entry row's figures: `value` alone, or with `values` when the entry has several inputs. */
export function lateEntryFigures(entry: EntryFigureSource): Pick<CarriedEntryRow, "value" | "values"> | null {
  const figures = entryFigures(entry);
  if (!figures.length) return null;
  return figures.length === 1 ? { value: figures[0] } : { value: figures[0], values: figures };
}
