import { z } from "zod";
import { SafeError } from "@/lib/errors";

/** Older drafts predate entries; malformed new snapshots must never select a fresh set. */
export function readRemovalEntrySnapshot(row: { payloadSnapshot: unknown }): {
  templateObservationId: string | null;
  frozenEntrySet: { entryId: string; contentRevision: number }[];
} {
  const parsed = z.object({
    templateObservationId: z.string().min(1).optional(),
    frozenEntrySet: z.array(z.object({ entryId: z.string().min(1), contentRevision: z.number().int().positive() })).optional(),
  }).safeParse(row.payloadSnapshot ?? {});
  if (!parsed.success) throw new SafeError("The saved emissions entry set could not be read. Refresh the Removal before submitting.");
  return { templateObservationId: parsed.data.templateObservationId ?? null, frozenEntrySet: parsed.data.frozenEntrySet ?? [] };
}

/** Identity and revision must both match the reviewed contribution set. */
export function isInFrozenEntrySet(entry: { entryId: string; contentRevision: number }, frozen: readonly { entryId: string; contentRevision: number }[] | undefined): boolean {
  return frozen?.some((item) => item.entryId === entry.entryId && item.contentRevision === entry.contentRevision) ?? false;
}
