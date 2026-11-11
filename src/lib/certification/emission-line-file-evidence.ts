import { effectiveFilePolicy, recordsNeedFile } from "@/lib/isometric/template-observations/file-policies";
import { effectiveContract } from "@/lib/isometric/template-observations/line-sources";
import type { EntryObservation } from "./emission-entry-rules";
import type { BatchEmissionContext } from "./batch-emission-context";
import type { ClassifiedRemovalSource } from "./removal-source-bindings";
import { SOURCE_BINDING_MAPPING_REVISION } from "./removal-source-bindings";

const RECORD_INPUT_KEYS = {
  "run-electricity": "electricity_use",
  "run-genset-diesel": "volume_of_fuel",
  "run-startup-diesel": "volume_of_fuel",
} as const;

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
      const inputKey = RECORD_INPUT_KEYS[source as keyof typeof RECORD_INPUT_KEYS];
      if (!inputKey || !component.inputs.some(input => input.key === inputKey && input.type === "monitored")) return [];
      const file = batch.lineFiles?.find(row => row.anchor.componentId === component.id && row.document);
      if (!file?.document) return [];
      return [{ creditBatchId, componentId: component.id, componentDisplayName: component.displayName,
        inputKey, anchorId: file.anchor.id, anchorVersion: file.anchor.version, documentId: file.document.id }];
    })));
}

export function lineFileSourceCandidates(evidence: readonly LineFileEvidence[]): { documentId: string; binding: ClassifiedRemovalSource }[] {
  return evidence.map(file => ({ documentId: file.documentId, binding: {
    nomaRole: "emission_line_file", nomaRoleLabel: "Component file",
    lineage: { entityType: "emission_line", entityId: file.anchorId, entityLabel: `Component file, ${file.componentDisplayName}` },
    lineFile: { creditBatchId: file.creditBatchId, anchorVersion: file.anchorVersion },
    intendedTarget: { kind: "explicit", componentId: file.componentId, inputKey: file.inputKey },
    mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
  } }));
}
