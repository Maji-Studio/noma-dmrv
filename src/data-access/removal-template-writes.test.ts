import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { OrgContext } from "@/lib/auth/server";
import { normalizeTemplateDefinition, resolveLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import templateFixture from "../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), select: vi.fn(), update: vi.fn(), execute: vi.fn(), insert: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/auth/providers/better-auth-server", () => ({}));
vi.mock("./activity-events", () => ({ recordActivity: vi.fn() }));
vi.mock("./certification-lineage-guards", () => ({ assertCanMutateCertifiedLineage: vi.fn() }));
vi.mock("./credit-batch-certification-lock", () => ({
  lockCreditBatchArtifacts: vi.fn().mockResolvedValue([]),
  assertRemovalAllowsCreditBatchMutation: vi.fn(),
}));
vi.mock("./facility-certification-boundary-lock", () => ({ acquireFacilityCertificationBoundaryLock: vi.fn() }));

import { observeTemplate, reviewLineContracts } from "./removal-template-observations";
import { switchCreditBatchRemovalTemplate } from "./credit-batch-removal-template";

const ctx: OrgContext = { organizationId: "org-1", userId: "user-1", orgRole: "admin", isPlatformAdmin: false };
const template = templateFixture as GhgEntryTemplate;
const GENSET = "rtc_1KWHFRM4GSBX5Y7A";
const executor = { select: mocks.select, update: mocks.update, execute: mocks.execute, insert: mocks.insert };
function query(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
    for: vi.fn().mockResolvedValue(rows), limit: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
}
function observation() {
  const definition = normalizeTemplateDefinition(template);
  return {
    id: "observation-1", version: 1, provider: "isometric", externalTemplateId: template.id,
    definition, lineSources: resolveLineSources({ definition }),
    enrichment: Object.fromEntries(definition.groups.flatMap((group) => group.components.map((component) => [component.id,
      Object.fromEntries(component.inputs.map((input) => [input.key, { unit: input.quantityKind === "mass" ? "kg" : "dimensionless", fixedValue: 1 }])),
    ]))),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((callback: (tx: typeof executor) => Promise<unknown>) => callback(executor));
});

describe("Removal template write boundaries", () => {
  it("rejects members at both data-access boundaries before database work", async () => {
    const member = { ...ctx, orgRole: "member" } as const;
    await expect(reviewLineContracts(member, { observationId: "observation-1", expectedVersion: 1, assignments: {} })).rejects.toThrow("permission");
    await expect(switchCreditBatchRemovalTemplate(member, { creditBatchId: "batch-1", expectedVersion: 1, removalTemplateId: "next" })).rejects.toThrow("permission");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["bootstrap", "carried", "reviewed"] as const)("refuses reassignment of a settled %s line", async (origin) => {
    const row = observation();
    // A single supported line keeps enrichment independent of the other fixture inputs.
    row.definition.groups = row.definition.groups.filter((group) => group.key === "pyrolysis");
    row.definition.groups[0].components = row.definition.groups[0].components.filter((component) => component.id === GENSET);
    row.definition.groups[0].components[0].inputs = row.definition.groups[0].components[0].inputs.filter((input) => input.type === "monitored");
    row.enrichment = { [GENSET]: { volume_of_fuel: { unit: "l", fixedValue: 1 } } };
    row.lineSources = { [GENSET]: { ...row.lineSources[GENSET], origin } };
    mocks.select.mockReturnValueOnce(query([row])).mockReturnValueOnce(query([row])).mockReturnValueOnce(query([{ id: row.id }]));
    await expect(reviewLineContracts(ctx, { observationId: row.id, expectedVersion: row.version,
      assignments: { [GENSET]: { scope: "operating", automaticSource: "run-startup-diesel", entryPolicy: "additive" } },
    })).rejects.toThrow("This template line needs no review.");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("saves line review when a fixed value must be set in Isometric", async () => {
    const row = observation();
    row.definition.groups = row.definition.groups.filter((group) => group.key === "pyrolysis");
    row.definition.groups[0].components = row.definition.groups[0].components.filter((component) => component.id === GENSET);
    const fixed = row.definition.groups[0].components[0].inputs.find((input) => input.type === "fixed")!;
    delete fixed.fixedDatapointId;
    row.enrichment = { [GENSET]: { volume_of_fuel: { unit: "l", fixedValue: 1 } } };
    row.lineSources = { [GENSET]: { scope: "unassigned", entryPolicy: "none", origin: "proposed" } };
    mocks.select.mockReturnValueOnce(query([row])).mockReturnValueOnce(query([row])).mockReturnValueOnce(query([{ id: row.id }]));
    const updated = { set: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([row]) };
    mocks.update.mockReturnValue(updated);
    await expect(reviewLineContracts(ctx, { observationId: row.id, expectedVersion: row.version,
      assignments: { [GENSET]: { scope: "operating", automaticSource: "run-genset-diesel", entryPolicy: "additive" } },
    })).resolves.toEqual(row);
    expect(updated.set).toHaveBeenCalledWith(expect.objectContaining({ lineSources: {
      [GENSET]: { scope: "operating", automaticSource: "run-genset-diesel", entryPolicy: "additive", origin: "reviewed" },
    } }));
  });

  it.each(["batch", "facility"])("refuses a template switch on an archived %s with the current version", async (archived) => {
    const batch = { id: "batch-1", version: 4, facilityId: "facility-1", archivedAt: archived === "batch" ? new Date() : null };
    mocks.select.mockReturnValueOnce(query([{ facilityId: batch.facilityId }])).mockReturnValueOnce(query([batch]));
    if (archived === "facility") mocks.select.mockReturnValueOnce(query([{ archivedAt: new Date() }]));
    await expect(switchCreditBatchRemovalTemplate(ctx, { creditBatchId: batch.id, expectedVersion: batch.version, removalTemplateId: "next" })).rejects.toThrow("archived");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

it("serializes first observations and reviews by the same org/provider/template key", async () => {
  const row = observation();
  const inserted = { values: vi.fn().mockReturnThis(), onConflictDoUpdate: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([row]) };
  mocks.insert.mockReturnValue(inserted);
  mocks.select.mockReturnValueOnce(query([])).mockReturnValueOnce(query([]));
  await observeTemplate(ctx, { provider: "isometric", externalProjectId: "project-1", template, enrichment: row.enrichment });
  const firstLock = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
  expect(firstLock.sql).toContain("pg_advisory_xact_lock");
  expect(firstLock.params).toEqual([JSON.stringify(["removal-template-observation", ctx.organizationId, "isometric", template.id])]);
  expect(mocks.execute.mock.invocationCallOrder[0]).toBeLessThan(mocks.select.mock.invocationCallOrder[0]);

  mocks.select.mockReturnValueOnce(query([row])).mockReturnValueOnce(query([row])).mockReturnValueOnce(query([{ id: "superseding-observation" }]));
  await expect(reviewLineContracts(ctx, { observationId: row.id, expectedVersion: row.version, assignments: {} })).rejects.toMatchObject({ code: "stale_version" });
  expect(new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0]).params).toEqual(firstLock.params);
  expect(mocks.update).not.toHaveBeenCalled();

  mocks.select.mockReturnValueOnce(query([])).mockReturnValueOnce(query([]));
  await observeTemplate({ ...ctx, organizationId: "other-org" }, { provider: "isometric", externalProjectId: "project-1", template, enrichment: row.enrichment });
  expect(new PgDialect().sqlToQuery(mocks.execute.mock.calls[2][0]).params).not.toEqual(firstLock.params);
  mocks.select.mockReturnValueOnce(query([])).mockReturnValueOnce(query([]));
  await observeTemplate(ctx, { provider: "isometric", externalProjectId: "project-1", template: { ...template, id: "other-template" }, enrichment: row.enrichment });
  expect(new PgDialect().sqlToQuery(mocks.execute.mock.calls[3][0]).params).not.toEqual(firstLock.params);
});
