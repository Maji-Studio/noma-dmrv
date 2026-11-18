import { COMPONENT_FILE_LABEL } from "./emission-entry-messages";
import { effectiveFilePolicy, recordsNeedFile, LINE_FILE_INPUT_KEYS } from "@/lib/isometric/template-observations/file-policies";
import { effectiveContract } from "@/lib/isometric/template-observations/line-sources";
import type { EntryObservation } from "./emission-entry-rules";
import type { BatchEmissionContext } from "./batch-emission-context";
import type { ClassifiedRemovalSource } from "./removal-source-bindings";
import { SOURCE_BINDING_MAPPING_REVISION } from "./removal-source-bindings";

export interface LineFileEvidence {
  creditBatchId: string;
  componentId: string;
  componentDisplayName: string;
  inputKey: string;
  anchorId: string;
  anchorVersion: number;
  documentId: string;
}

/** Facts have already omitted production sources claimed by another Removal. */
export function deriveLineFileEvidence(batches: BatchEmissionContext, observation: EntryObservation): LineFileEvidence[] {
  return Object.entries(batches).flatMap(([creditBatchId, batch]) => observation.definition.groups.flatMap(group =>
    group.components.flatMap(component => {
      const stored = observation.lineSources[component.id];
      if (!stored) return [];
      const contract = effectiveContract(stored);
      const source = contract.automaticSource;
      if (!source || batch.omittedAutomaticSources?.includes(source) ||
        !recordsNeedFile(effectiveFilePolicy(contract), batch.automaticFigures[source]?.magnitude ?? "0")) return [];
      const inputKey = LINE_FILE_INPUT_KEYS[source as keyof typeof LINE_FILE_INPUT_KEYS];
      if (!inputKey || !component.inputs.some(input => input.key === inputKey && input.type === "monitored")) return [];
      const file = batch.lineFiles?.find(row => !row.anchor.retiredAt && row.anchor.componentId === component.id);
      if (!file) return [];
      return file.documents.map(document => ({ creditBatchId, componentId: component.id, componentDisplayName: component.displayName,
        inputKey, anchorId: file.anchor.id, anchorVersion: file.anchor.version, documentId: document.id }));
    })));
}

export function lineFileSourceCandidates(evidence: readonly LineFileEvidence[]): { documentId: string; binding: ClassifiedRemovalSource }[] {
  return evidence.map(file => ({ documentId: file.documentId, binding: {
    nomaRole: "emission_line_file", nomaRoleLabel: COMPONENT_FILE_LABEL,
    lineage: { entityType: "emission_line", entityId: file.anchorId, entityLabel: `${COMPONENT_FILE_LABEL}, ${file.componentDisplayName}` },
    lineFile: { creditBatchId: file.creditBatchId, anchorVersion: file.anchorVersion },
    intendedTarget: { kind: "explicit", componentId: file.componentId, inputKey: file.inputKey },
    mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
  } }));
}
