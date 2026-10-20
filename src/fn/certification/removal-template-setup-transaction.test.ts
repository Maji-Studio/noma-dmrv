import { beforeEach, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import type { ApplyRemovalTemplateSetupInput } from "@/schemas/removal-template-setup";
import { normalizeTemplateDefinition, resolveLineSources, validateLineSources } from "@/lib/isometric/template-observations";
import { protocolDefaultFixture } from "@/lib/certification/removal-template-setup-test-fixtures";
import { setupPlan } from "@/lib/certification/removal-template-setup-plan";
import { setupPlanFingerprint } from "@/lib/certification/removal-template-setup-fingerprint";

const mocks = vi.hoisted(() => ({ boundaryLock: vi.fn(), observationLock: vi.fn(), latest: vi.fn(), review: vi.fn(), makeDefault: vi.fn(), pin: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth/providers/better-auth-server", () => ({}));
vi.mock("@/data-access/facility-certification-boundary-lock", () => ({ acquireFacilityCertificationBoundaryLock: mocks.boundaryLock }));
vi.mock("@/data-access/removal-template-observations", () => ({ acquireTemplateObservationLock: mocks.observationLock, getLatestTemplateObservation: mocks.latest, reviewLineContractsInTransaction: mocks.review }));
vi.mock("@/data-access/certification", () => ({ updateFacilityDefaultRemovalTemplateInTransaction: mocks.makeDefault }));
vi.mock("@/data-access/credit-batch-removal-template", () => ({ switchCreditBatchRemovalTemplateInTransaction: mocks.pin }));
import { applySetupInTransaction } from "@/data-access/removal-template-setup";

const ctx: OrgContext = { organizationId: "org", userId: "admin", orgRole: "admin", isPlatformAdmin: false };
const input = { facilityId: "facility",
  fingerprints: { semanticFingerprint: "semantic", fullFingerprint: "full" },
  answers: {}, overrides: {}, makeDefault: true, batches: [{ id: "batch", expectedVersion: 1 }],
};

beforeEach(() => vi.clearAllMocks());

it.each([false, true])("refuses a changed preview before validating %s answers or writing", async (hasAnswers) => {
  const template = protocolDefaultFixture();
  if (!hasAnswers) {
    const pyrolysis = template.groups.find((group) => group.key === "pyrolysis")!;
    pyrolysis.components = [pyrolysis.components.find((component) => component.blueprint_key === "grid_electricity_use")!];
  }
  const definition = normalizeTemplateDefinition(template);
  const lineSources = resolveLineSources({ definition });
  const preview = setupPlan(definition, lineSources, validateLineSources(definition, lineSources));
  const planned: ApplyRemovalTemplateSetupInput = { ...input, removalTemplateId: template.id,
    planFingerprint: setupPlanFingerprint(preview),
    answers: Object.fromEntries(preview.decisions.map((decision) => [decision.id, decision.options[0].id])),
  };
  expect(Object.keys(planned.answers).length > 0).toBe(hasAnswers);
  // Both Apply-time reads see the second Admin's review; their versions match.
  for (const contract of Object.values(lineSources)) {
    contract.origin = "reviewed";
    contract.scope = "operating";
    delete contract.automaticSource;
  }
  const row = { id: "observation", version: 2, definition, lineSources, enrichment: {}, ...input.fingerprints } as RemovalTemplateObservation;
  mocks.latest.mockResolvedValue(row);
  // The transaction reads the facility and project mapping before the observation lock.
  const reads = [[{ id: input.facilityId, durabilityOption: null }], [{ externalProjectId: template.project_id }]];
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ for: async () => reads.shift() }) }) }));
  const tx = { select } as unknown as DbTransaction;
  await expect(applySetupInTransaction(ctx, tx, planned, template, row)).rejects.toMatchObject({ code: "stale_version" });
  expect(mocks.observationLock).toHaveBeenCalledOnce();
  expect(mocks.latest).toHaveBeenCalledWith(ctx, "isometric", template.id, tx);
  expect(mocks.review).not.toHaveBeenCalled();
  expect(mocks.makeDefault).not.toHaveBeenCalled();
  expect(mocks.pin).not.toHaveBeenCalled();
});
