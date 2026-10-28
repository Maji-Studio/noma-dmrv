import type { EmissionFigure } from "./emission-lines";

export function lateEntryFigures(entry: {
  total: EmissionFigure | null;
  values: readonly { magnitude: string; unit: string }[];
}): { value: EmissionFigure; values?: EmissionFigure[] } | null {
  if (!entry.values.length) return null;
  if (entry.values.length === 1) return { value: entry.total! };
  const values = entry.values.map(({ magnitude, unit }) => ({ magnitude, unit }));
  return { value: values[0], values };
}
