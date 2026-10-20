import { EmissionEntryEvidenceError } from "./emission-entry-evidence-error";
import { EMISSION_ENTRIES_CHANGED, EMISSION_ENTRY_FILE_DUPLICATE } from "./emission-entry-messages";
import type { RemovalEntryContributions } from "./removal-emission-contributions";
import {
  SOURCE_BINDING_MAPPING_REVISION,
  type ClassifiedRemovalSource,
  type RemovalSourceIntendedTarget,
} from "./removal-source-bindings";

/** Only the frozen contribution manifest authorizes entry files and targets. */
export function emissionEntrySourceCandidates(
  contributions?: Pick<RemovalEntryContributions, "manifest" | "entrySet">,
): { documentId: string; binding: ClassifiedRemovalSource }[] {
  const candidates = new Map<string, { documentId: string; binding: ClassifiedRemovalSource }>();
  for (const input of contributions?.manifest ?? []) {
    for (const entry of input.entries) {
      if (entry.kind === "zero") continue;
      if (!contributions?.entrySet.some((frozen) => frozen.entryId === entry.entryId &&
        frozen.contentRevision === entry.contentRevision)) {
        throw new EmissionEntryEvidenceError(EMISSION_ENTRIES_CHANGED, { entryId: entry.entryId, componentId: input.componentId, inputKey: input.inputKey });
      }
      const target: RemovalSourceIntendedTarget = { kind: "explicit", componentId: input.componentId, inputKey: input.inputKey };
      for (const documentId of entry.evidenceDocumentIds) {
        const existing = candidates.get(documentId);
        if (existing) {
          if (existing.binding.lineage.entityId !== entry.entryId) {
            throw new EmissionEntryEvidenceError(EMISSION_ENTRY_FILE_DUPLICATE, { documentId, entryId: entry.entryId, otherEntryId: existing.binding.lineage.entityId });
          }
          const targets = [existing.binding.intendedTarget, ...(existing.binding.additionalIntendedTargets ?? [])];
          if (!targets.some((item) => item.kind === "explicit" && item.componentId === target.componentId && item.inputKey === target.inputKey)) {
            (existing.binding.additionalIntendedTargets ??= []).push(target);
          }
        } else {
          candidates.set(documentId, { documentId, binding: {
            nomaRole: "emission_entry", nomaRoleLabel: "Emissions entry",
            lineage: { entityType: "emission_entry", entityId: entry.entryId, entityLabel: ["Emissions entry", input.componentDisplayName, entry.occurredOn, entry.creditBatchCode].filter(Boolean).join(", ") },
            intendedTarget: target, mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
          } });
        }
      }
    }
  }
  return [...candidates.values()].sort((a, b) => a.documentId.localeCompare(b.documentId));
}
