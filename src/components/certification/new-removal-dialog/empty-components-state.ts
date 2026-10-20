/**
 * Pure rules of the "Empty components" step: which batches still need a
 * decision, what blocks Continue, and where a draft lands. The server decides
 * what is empty; this file only reads its answer.
 */
import { pluralize } from "@/lib/copy-utils";
import type {
  RemovalEmptyComponents,
  RemovalEmptyComponentsBatch,
} from "@/hooks/use-removal-empty-components";

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

/** The step is part of the flow while any selected batch has an empty or a recorded component. */
export function hasEmptyComponentsStep(data: RemovalEmptyComponents): boolean {
  return data.batches.some(
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
  return data && openComponentCount(data) > 0 ? "empty" : "submit";
}

export interface ContinueRefusal {
  count: number;
  /** Names what blocks, shown next to Continue. Null when Continue may proceed. */
  reason: string | null;
  firstBatchId: string | null;
}

export function continueRefusal(data: RemovalEmptyComponents): ContinueRefusal {
  const open = openBatches(data);
  if (open.length === 0) return { count: 0, reason: null, firstBatchId: null };
  const count = openComponentCount(data);
  const codes = open.map((batch) => batch.code).join(" and ");
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
