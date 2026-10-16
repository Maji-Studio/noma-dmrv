import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import { requireOrgScope, type Executor } from "./utils";
import { listEmissionEntries } from "./emission-entries";
import { getTemplateObservationById } from "./removal-template-observations";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";

/** Shared stored-entry facts for the batch sheet, health and facility activity. */
export async function loadBatchEmissionEntryFacts(
  ctx: OrgContext, creditBatchId: string, observation: EntryObservation, executor: Executor = db,
) {
  requireOrgScope(ctx);
  const storedEntries = await listEmissionEntries(ctx, creditBatchId, executor);
  const previousObservations = new Map(
    await Promise.all(
      [...new Set(storedEntries.map((entry) => entry.observationId))].map(
        async (id) => [id, await getTemplateObservationById(ctx, id, executor)] as const,
      ),
    ),
  );
  const entries = deriveEmissionEntryFacts(storedEntries, observation, previousObservations);
  return { entries, previousObservations };
}
