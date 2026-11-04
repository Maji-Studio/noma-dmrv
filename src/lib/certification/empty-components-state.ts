/**
 * Pure rules of the "Empty components" step: which batches still need a
 * decision, what blocks Continue, and where a draft lands. The server decides
 * what is empty; this file only reads its answer.
 */
import { pluralize } from "@/lib/copy-utils";
import type { loadRemovalEmptyLines } from "@/fn/certification/removal-empty-lines-core";

/** What the server reports for a Removal's empty components. */
export type RemovalEmptyComponents = Awaited<ReturnType<typeof loadRemovalEmptyLines>>;
export type RemovalEmptyComponentsBatch = RemovalEmptyComponents["batches"][number];

const LIST_FORMAT = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

export function componentsWord(count: number): string {
  return `${count} ${pluralize(count, "component", "components")}`;
}

/** Batches with at least one component that has no entry, datapoints or recorded zero. */
export function openBatches(
  data: RemovalEmptyComponents,
): RemovalEmptyComponentsBatch[] {
  return data.batches.filter((batch) => batch.lines.length > 0);
}

export function openComponentCount(data: RemovalEmptyComponents): number {
  return openBatches(data).reduce((sum, batch) => sum + batch.lines.length, 0);
}

/**
 * The step is part of the flow while any selected batch has an empty or a
 * recorded component, and only while zeros can still change: a submitted or
 * in-flight Removal refuses them.
 */
export function hasEmptyComponentsStep(data: RemovalEmptyComponents): boolean {
  return data.editable && data.batches.some(
    (batch) => batch.lines.length > 0 || batch.zeros.length > 0,
  );
}

/**
 * Where to go after the Removal exists or a draft reopens: the step while a
 * component is unconfirmed, the submit step otherwise (also when nothing is empty).
 */
export function landingStep(
  data: RemovalEmptyComponents | null,
): "empty" | "submit" {
  return data && data.editable && openComponentCount(data) > 0 ? "empty" : "submit";
}

export interface ContinueRefusal {
  count: number;
  /** Names what blocks, shown next to Continue. Null when Continue may proceed. */
  reason: string | null;
  firstBatchId: string | null;
}

export function continueRefusal(data: RemovalEmptyComponents): ContinueRefusal {
  // Zeros can no longer change (submitted, in flight or being deleted): there is nothing to ask for.
  const open = data.editable ? openBatches(data) : [];
  if (open.length === 0) return { count: 0, reason: null, firstBatchId: null };
  const count = openComponentCount(data);
  const codes = LIST_FORMAT.format(open.map((batch) => batch.code));
  return {
    count,
    reason: `Record the ${componentsWord(count)} with nothing in ${codes} as zero, or add entries.`,
    firstBatchId: open[0].creditBatchId,
  };
}

/** The note shared by a batch's recorded zeros: the server copies one note into each. */
export function recordedNote(batch: RemovalEmptyComponentsBatch): string | null {
  return batch.zeros.find((zero) => zero.note)?.note ?? null;
}

export function recordedAt(batch: RemovalEmptyComponentsBatch): Date | null {
  const times = batch.zeros.map((zero) => new Date(zero.createdAt).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

export interface StepRow {
  componentId: string;
  name: string;
  recorded: boolean;
}

/** Open and recorded components in one list, in template order (group, then component). */
export function stepRows(batch: RemovalEmptyComponentsBatch): StepRow[] {
  return [
    ...batch.lines.map((line) => ({
      componentId: line.componentId,
      name: line.displayName,
      recorded: false,
      position: line.position,
    })),
    ...batch.zeros.map((zero) => ({
      componentId: zero.componentId,
      name: zero.displayName ?? zero.componentId,
      recorded: true,
      position: zero.position,
    })),
  ]
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ componentId: row.componentId, name: row.name, recorded: row.recorded }));
}
