import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), select: vi.fn(), delete: vi.fn(), update: vi.fn(),
  clear: vi.fn(), locks: vi.fn(), documents: vi.fn(), targets: vi.fn() }));
vi.mock("./certification-status-activity", () => ({
  withCertificationStatusActivity: async (_ctx: unknown, _ids: string[], write: (tx: unknown) => Promise<void>, tx: unknown) => write(tx),
}));
vi.mock("@/db", () => ({ db: mocks }));
vi.mock("./removal-production-batch-deletion", () => ({ clearDeletedRemovalProductionBatches: mocks.clear,
  removalProductionBatchTargets: mocks.targets }));
vi.mock("./certifier-document-uploads", () => ({ releaseDocumentUploadsReferencedOnlyBySubmissions: mocks.documents }));
vi.mock("@/lib/certification/submission-lock", () => ({ acquireCertificationArtifactLocksSorted: mocks.locks }));
import { certifierBiocharApplications } from "@/db/schema/certifier-biochar-applications";
import { certifierRemovals, certificationSubmissions } from "@/db/schema/certification";
import { finalizeRemovalDeletion, removalDeletionOpensRegistryBoundary, type RemovalDeletionClaim } from "./certifier-removal-deletion";
const ctx: OrgContext = { organizationId: "org-1", userId: "user-1", orgRole: "admin", isPlatformAdmin: false };
const lockedAt = new Date("2026-09-08T00:00:00Z");
const claim: RemovalDeletionClaim = { removalId: "removal-1", facilityId: "facility-1", submissionIds: ["sub-1"],
  lockedAt, lockedSubmissions: [], biocharApplications: [], externalRemovalIds: [], unconfirmedRemovalSupplierRefs: [] };
const registry = { deletedGhgEntryIds: [], deletedBiocharApplicationIds: [], absentGhgEntryIds: [], absentBiocharApplicationIds: [],
  unresolvedBiocharApplicationReferences: [], productionBatches: [{ creditBatchId: "batch-1", externalId: "ptb_1", outcome: "deleted" as const }],
  measurementSamples: [{ submissionId: "sub-1", supplierReference: "ref-1", externalId: "mts_1", outcome: "absent" as const }] };
const predicates: SQL[] = [];
const patches: Array<{ table: unknown; value: Record<string, unknown> }> = [];
const order: string[] = [];
function query(rows: unknown[], table?: unknown) {
  const chain = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), for: vi.fn(), limit: vi.fn(), returning: vi.fn(), set: vi.fn(),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  chain.from.mockReturnValue(chain); chain.orderBy.mockReturnValue(chain); chain.for.mockReturnValue(chain);
  chain.where.mockImplementation((predicate: SQL) => { predicates.push(predicate); return chain; });
  chain.set.mockImplementation((value: Record<string, unknown>) => { patches.push({ table, value }); return chain; });
  chain.limit.mockResolvedValue(rows); chain.returning.mockResolvedValue(rows);
  return chain;
}
beforeEach(() => {
  vi.resetAllMocks(); predicates.length = 0; patches.length = 0; order.length = 0;
  mocks.transaction.mockImplementation(async (run) => run(mocks));
  mocks.targets.mockResolvedValue([]);
  mocks.select.mockReturnValueOnce(query([{ id: claim.removalId, ghgStatementId: null, metadata: { removalDeletionLockedAt: lockedAt.toISOString() } }]))
    .mockReturnValueOnce(query([{ id: "sub-1", status: "draft", lockedAt }]))
    // No batches retain a submission reservation or a Removal claim in this fixture.
    .mockReturnValueOnce(query([]))
    .mockReturnValueOnce(query([]));
  mocks.delete.mockImplementation((table) => {
    if (table === certifierBiocharApplications) order.push("applications");
    if (table === certifierRemovals) order.push("removal");
    return query([{ id: "deleted" }]);
  });
  mocks.update.mockImplementation((table) => query([], table));
  mocks.clear.mockImplementation(async () => { order.push("production batches"); });
  mocks.documents.mockResolvedValue([]);
});

it("removes child journal rows before production journal cleanup and retains ledger audit", async () => {
  await finalizeRemovalDeletion(ctx, claim, registry);
  expect(order).toEqual(["applications", "production batches", "removal"]);
  expect(mocks.clear).toHaveBeenCalledWith(ctx, claim, registry.productionBatches, mocks);
  const metadata = patches.find((patch) => patch.table === certificationSubmissions)!.value.metadata as SQL;
  const compiled = new PgDialect().sqlToQuery(metadata);
  expect(compiled.params).toContainEqual(expect.stringContaining('"measurementSamples":[{"submissionId":"sub-1"'));
  expect(compiled.params).toContainEqual(expect.stringContaining('"productionBatches":[{"creditBatchId":"batch-1"'));
  for (const predicate of predicates) {
    const query = new PgDialect().sqlToQuery(predicate);
    expect(query.sql).toContain('"organization_id" =');
    expect(query.params).toContain("org-1");
  }
});
it("does not delete the Removal after a production journal cleanup conflict", async () => {
  mocks.clear.mockRejectedValue(new Error("CAS conflict"));
  await expect(finalizeRemovalDeletion(ctx, claim, registry)).rejects.toThrow("CAS conflict");
  expect(order).toEqual(["applications"]);
  expect(patches).toEqual([]);
});
it("requires organization scope before finalization", async () => {
  await expect(finalizeRemovalDeletion({ ...ctx, organizationId: "" }, claim, registry)).rejects.toThrow("Unauthorized");
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it.each([
  { name: "fresh Removal", facts: {}, expected: false },
  { name: "false sticky marker", facts: { metadata: { submissionExternalMutationPossible: false } }, expected: false },
  { name: "sticky marker", facts: { metadata: { submissionExternalMutationPossible: true } }, expected: true },
  { name: "ledger row without a registry ID", facts: { rows: [{ externalId: null }] }, expected: true },
  { name: "Biochar Application registration", facts: { biocharApplications: [{}] }, expected: true },
  { name: "Removal-owned MeasurementSample", facts: { measurementSamples: [{}] }, expected: true },
  { name: "unregistered production batch", facts: { productionBatches: [{ registrationId: null }] }, expected: false },
  { name: "registered production batch", facts: { productionBatches: [{ registrationId: null }, { registrationId: "registration-1" }] }, expected: true },
])("registry boundary: $name", ({ facts, expected }) => {
  expect(removalDeletionOpensRegistryBoundary({
    metadata: null,
    rows: [],
    biocharApplications: [],
    measurementSamples: [],
    productionBatches: [],
    ...facts,
  })).toBe(expected);
});
