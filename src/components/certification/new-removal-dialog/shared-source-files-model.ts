/**
 * Turns the Removal's registry value sources (the Sources list on the Removal
 * sheet) into file uses for the shared-file note on Review & submit (#1531).
 * The grouping itself lives in `@/lib/certification/shared-source-files`.
 */
import type { CandidateDocument, CandidateLineageEntityType } from "@/lib/certification/source-candidates";
import type { MemberCreditBatch } from "@/fn/certification/certify-context";
import type { BatchEmissionLine } from "@/lib/certification/emission-lines";
import {
  APPLICATION_EVIDENCE_ROLE,
  findSharedSourceFiles,
  type SharedSourceFile,
  type SourceFileRecord,
  type SourceFileRole,
  type SourceFileUse,
} from "@/lib/certification/shared-source-files";
import { recordHref, type RecordKind } from "@/lib/record-links";

type SourceCandidate = Pick<CandidateDocument, "document" | "lineageEntity" | "binding" | "biocharApplicationId" | "includedInSubmission">;
type EntryLine = Pick<BatchEmissionLine, "componentId" | "displayName" | "entries">;

export interface SharedSourceFilesInput {
  candidates: readonly SourceCandidate[];
  facilityId: string;
  batches: readonly Pick<MemberCreditBatch, "id" | "code">[];
  linesByBatchId: Record<string, readonly EntryLine[]> | undefined;
  /** Entries of other credit batches this Removal carries, with their batch id and code. */
  carriedEntries?: readonly CarriedPlace[];
}

type CarriedPlace = { entryId: string; creditBatchId: string; creditBatchCode: string; componentId: string; componentName?: string };

/** The record noun that leads a lineage label, such as "Delivery DL-26-019". The row shows the code alone. */
const LABEL_NOUN: Record<string, string> = {
  application: "Application ",
  delivery: "Delivery ",
  feedstock: "Feedstock ",
  credit_batch: "Credit batch ",
  sample: "Sample ",
};

function codeOf(entityType: string, label: string): string {
  const noun = LABEL_NOUN[entityType];
  return noun && label.startsWith(noun) && label.length > noun.length ? label.slice(noun.length) : label;
}

const RECORD_KIND_BY_ENTITY: Record<Exclude<CandidateLineageEntityType, "emission_entry" | "emission_line">, RecordKind> = {
  application: "application",
  delivery: "delivery",
  feedstock: "feedstock",
  credit_batch: "creditBatch",
  sample: "sample",
};

/** Equal bytes are one file, even when uploaded once per record. */
function fileKeyOf(document: SourceCandidate["document"]): string {
  if (document.checksumSha256) return `sha256:${document.checksumSha256}`;
  if (document.storageKey) return `key:${document.storageKey}`;
  return `document:${document.id}`;
}

function roleOf(candidate: SourceCandidate): SourceFileRole | null {
  if (candidate.binding) return candidate.binding.nomaRole;
  return candidate.biocharApplicationId ? APPLICATION_EVIDENCE_ROLE : null;
}

interface EntryPlace {
  batchId: string;
  batchCode: string | null;
  componentId: string;
  componentName: string;
}

function entryPlaces(input: SharedSourceFilesInput): Map<string, EntryPlace> {
  const codes = new Map(input.batches.map((batch) => [batch.id, batch.code]));
  const places = new Map<string, EntryPlace>();
  for (const [batchId, lines] of Object.entries(input.linesByBatchId ?? {})) {
    for (const line of lines) {
      for (const entry of line.entries) {
        if (!entry.id || places.has(entry.id)) continue;
        places.set(entry.id, { batchId, batchCode: codes.get(batchId) ?? null, componentId: line.componentId, componentName: line.displayName });
      }
    }
  }
  return places;
}

function componentNames(input: SharedSourceFilesInput): Map<string, string> {
  const names = new Map<string, string>();
  for (const lines of Object.values(input.linesByBatchId ?? {})) {
    for (const line of lines) if (!names.has(line.componentId)) names.set(line.componentId, line.displayName);
  }
  return names;
}

/** The files sent with this Removal that back evidence of different kinds. */
export function sharedSourceFiles(input: SharedSourceFilesInput): SharedSourceFile[] {
  const places = entryPlaces(input);
  const names = componentNames(input);
  const carriedById = new Map((input.carriedEntries ?? []).map((entry) => [entry.entryId, entry]));
  const uses = input.candidates.flatMap((candidate): SourceFileUse[] => {
    // A file left out of a saved attempt is not sent.
    if (candidate.includedInSubmission === false) return [];
    const role = roleOf(candidate);
    if (!role) return [];
    const { document, lineageEntity } = candidate;
    const base = { fileKey: fileKeyOf(document), fileName: document.fileName, role };

    if (role === "emission_line_file") {
      const target = candidate.binding?.intendedTarget;
      const batchId = candidate.binding?.lineFile?.creditBatchId;
      return [{ ...base,
        component: target?.kind === "explicit" ? { id: target.componentId, name: names.get(target.componentId) ?? null } : null,
        record: { label: input.batches.find(batch => batch.id === batchId)?.code ?? lineageEntity.entityLabel,
          href: batchId ? recordHref("creditBatch", batchId, { facilityId: input.facilityId, tab: "emissions" }) : null },
      }];
    }
    if (role === "emission_entry") {
      const place = places.get(lineageEntity.entityId);
      if (place) {
        return [{
          ...base,
          component: { id: place.componentId, name: place.componentName },
          record: {
            label: place.batchCode ?? lineageEntity.entityLabel,
            href: recordHref("creditBatch", place.batchId, { facilityId: input.facilityId, tab: "emissions" }),
          },
        }];
      }
      const carried = carriedById.get(lineageEntity.entityId);
      if (carried) {
        return [{
          ...base,
          component: { id: carried.componentId, name: carried.componentName ?? names.get(carried.componentId) ?? null },
          record: {
            label: carried.creditBatchCode,
            href: recordHref("creditBatch", carried.creditBatchId, { facilityId: input.facilityId, tab: "emissions" }),
          },
        }];
      }
      const target = candidate.binding?.intendedTarget;
      const componentId = target?.kind === "explicit" ? target.componentId : null;
      return [{
        ...base,
        component: componentId ? { id: componentId, name: names.get(componentId) ?? null } : null,
        record: { label: lineageEntity.entityLabel, href: null },
      }];
    }

    const kind = RECORD_KIND_BY_ENTITY[lineageEntity.entityType as keyof typeof RECORD_KIND_BY_ENTITY];
    const record: SourceFileRecord = {
      label: codeOf(lineageEntity.entityType, lineageEntity.entityLabel),
      href: kind ? recordHref(kind, lineageEntity.entityId, { facilityId: input.facilityId }) : null,
    };
    return [{ ...base, record }];
  });
  return findSharedSourceFiles(uses);
}
