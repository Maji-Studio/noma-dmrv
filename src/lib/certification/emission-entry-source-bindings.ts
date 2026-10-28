import { isInFrozenEntrySet } from "./removal-entry-snapshot";
import { EmissionEntryEvidenceError } from "./emission-entry-evidence-error";
import { EMISSION_ENTRIES_CHANGED, EMISSION_ENTRY_FILE_DUPLICATE, formatEmissionEntryMessageLabel } from "./emission-entry-messages";
import type { RemovalEntryContributions } from "./removal-emission-contributions";
import {
  SOURCE_BINDING_MAPPING_REVISION,
  type ClassifiedRemovalSource,
  type RemovalSourceIntendedTarget,
} from "./removal-source-bindings";

/** Only the frozen contribution manifest authorizes entry files and targets. */
export function emissionEntrySourceCandidates(
  contributions?: Pick<RemovalEntryContributions, "manifest" | "entrySet" | "carriedEntries">,
): { documentId: string; binding: ClassifiedRemovalSource }[] {
  const candidates = new Map<string, { documentId: string; binding: ClassifiedRemovalSource }>();
  for (const input of contributions?.manifest ?? []) {
    for (const entry of input.entries) {
      if (entry.kind === "zero") continue;
      if (!isInFrozenEntrySet(entry, contributions?.entrySet)) {
        throw new EmissionEntryEvidenceError(EMISSION_ENTRIES_CHANGED, { entryId: entry.entryId, componentId: input.componentId, inputKey: input.inputKey });
      }
      const carried = contributions?.carriedEntries?.find(carried => carried.entryId === entry.entryId);
      const label = ["Emissions entry", input.componentDisplayName, entry.occurredOn, entry.creditBatchCode].filter(Boolean).join(", ");
      const target: RemovalSourceIntendedTarget = { kind: "explicit", componentId: input.componentId, inputKey: input.inputKey };
      for (const documentId of entry.evidenceDocumentIds) {
        const existing = candidates.get(documentId);
        if (existing) {
          if (existing.binding.lineage.entityId !== entry.entryId) {
            const messageLabel = formatEmissionEntryMessageLabel({ componentDisplayName: input.componentDisplayName,
              occurredOn: entry.occurredOn, creditBatchCode: entry.creditBatchCode });
            throw new EmissionEntryEvidenceError(EMISSION_ENTRY_FILE_DUPLICATE(messageLabel), { documentId, entryId: entry.entryId, otherEntryId: existing.binding.lineage.entityId });
          }
          const targets = [existing.binding.intendedTarget, ...(existing.binding.additionalIntendedTargets ?? [])];
          if (!targets.some((item) => item.kind === "explicit" && item.componentId === target.componentId && item.inputKey === target.inputKey)) {
            (existing.binding.additionalIntendedTargets ??= []).push(target);
          }
        } else {
          candidates.set(documentId, { documentId, binding: {
            ...(carried ? { carriedEntry: { creditBatchCode: carried.creditBatchCode, occurredOn: carried.occurredOn } } : {}),
            nomaRole: "emission_entry", nomaRoleLabel: "Emissions entry",
            lineage: { entityType: "emission_entry", entityId: entry.entryId, entityLabel: label },
            intendedTarget: target, mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
          } });
        }
      }
    }
  }
  return [...candidates.values()].sort((a, b) => a.documentId.localeCompare(b.documentId));
}
