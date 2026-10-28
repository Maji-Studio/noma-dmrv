import type { EmissionFigure } from "./emission-lines";

/** The sheet figures for a late entry: its total, or every input of a paired entry (which has no single total). */
export function lateEntryFigures(entry: {
  total: EmissionFigure | null;
  values: readonly { magnitude: string; unit: string }[];
}): { value: EmissionFigure; values?: EmissionFigure[] } | null {
  if (!entry.values.length) return null;
  if (entry.values.length === 1) return entry.total ? { value: entry.total } : null;
  const values = entry.values.map(({ magnitude, unit }) => ({ magnitude, unit }));
  return { value: values[0], values };
}
