import { parseArgs } from "node:util";
import { z } from "zod";
import { DomainError } from "@/lib/domain-errors";

const retirementOptionsSchema = z.object({
  "organization-id": z.string().trim().min(1),
  delete: z.boolean().default(false),
});

export function parseRetirementOptions(args: string[]) {
  const { values } = parseArgs({ args, options: {
    "organization-id": { type: "string" }, delete: { type: "boolean", default: false },
  }, strict: true, allowPositionals: false });
  const options = retirementOptionsSchema.parse(values);
  return { organizationId: options["organization-id"], delete: options.delete };
}

export interface RetirementCandidate {
  id: string; organizationId: string; entityType: string; version: number; documentIds: string[];
}

/** Fail closed even if a future caller supplies candidates from a wider read. */
export function selectSampleTransportRetirementCandidates(organizationId: string, candidates: readonly RetirementCandidate[]): RetirementCandidate[] {
  return [...new Map(candidates.filter((candidate) => candidate.organizationId === organizationId && candidate.entityType === "sample")
    .map((candidate) => [candidate.id, candidate])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function runSampleTransportRetirement(options: { organizationId: string; delete: boolean }, dependencies: {
  list: () => Promise<RetirementCandidate[]>;
  remove: (id: string, version: number) => Promise<boolean>;
  log: (value: { organizationId: string; legIds: string[]; documentIds: string[]; legCount: number; documentCount: number; deletedLegCount: number; skippedLegIds: string[] } | { deletedLegId: string }) => void;
}) {
  const candidates = selectSampleTransportRetirementCandidates(options.organizationId, await dependencies.list());
  const documentIds = [...new Set(candidates.flatMap((candidate) => candidate.documentIds))].sort();
  let deletedLegCount = 0;
  const skippedLegIds: string[] = [];
  dependencies.log({ organizationId: options.organizationId, legIds: candidates.map((candidate) => candidate.id),
    documentIds, legCount: candidates.length, documentCount: documentIds.length, deletedLegCount, skippedLegIds });
  if (options.delete) {
    for (const candidate of candidates) {
      try {
        if (await dependencies.remove(candidate.id, candidate.version)) {
          deletedLegCount++;
          dependencies.log({ deletedLegId: candidate.id });
        }
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "certification_locked") throw error;
        skippedLegIds.push(candidate.id);
      }
    }
    dependencies.log({ organizationId: options.organizationId, legIds: candidates.map((candidate) => candidate.id),
      documentIds, legCount: candidates.length, documentCount: documentIds.length, deletedLegCount, skippedLegIds });
  }
  return { legCount: candidates.length, documentCount: documentIds.length, deletedLegCount, skippedLegIds };
}
