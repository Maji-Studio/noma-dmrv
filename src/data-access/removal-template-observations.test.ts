import { afterEach, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { normalizeTemplateDefinition, lineNeedsReview, validateLineSources, type GhgEntryTemplate, type LineSources } from "@/lib/isometric/template-observations";
import fixture from "../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { reviewLineContracts } from "./removal-template-observations";

const { select, set } = vi.hoisted(() => ({ select: vi.fn(), set: vi.fn() }));
// Exercise the real review rules with an in-memory transaction boundary only.
vi.mock("@/db", () => ({ db: {
  transaction: (work: (tx: unknown) => Promise<unknown>) => work({ select, execute: vi.fn(), update: () => ({ set }) }),
} }));
vi.mock("@/lib/auth/server", () => ({ requireOrgRole: vi.fn() }));

const ctx: OrgContext = { organizationId: "review-org", userId: "review-user", orgRole: "owner", isPlatformAdmin: false };
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each([false, true])("only reopens the settled sample line for an additive assignment after retirement (gate: %s)", async (enabled) => {
  vi.stubEnv("EMISSIONS_ENTRIES_ENABLED", enabled ? "true" : "false");
  const definition = normalizeTemplateDefinition(fixture as GhgEntryTemplate);
  const componentId = "rtc_1M4ZRPH1RSBXADG2";
  definition.groups = definition.groups.filter((group) => group.components.some((component) => component.id === componentId));
  definition.groups[0].components = definition.groups[0].components.filter((component) => component.id === componentId);
  const component = definition.groups[0].components[0];
  component.inputs = component.inputs.filter((input) => input.type === "monitored");
  const lineSources: LineSources = { [componentId]: {
    scope: "operating", automaticSource: "sample-transport", entryPolicy: "none", origin: "reviewed",
  } };
  const row = { id: "observation-id", provider: "isometric", externalTemplateId: fixture.id, version: 1,
    definition, lineSources, enrichment: { [componentId]: { [component.inputs[0].key]: { unit: "t * km" } } },
  };
  const reads = [[row], [row], [{ id: row.id }]];
  select.mockImplementation(() => {
    const rows = reads.shift();
    return { from: () => ({ where: () => ({
      limit: async () => rows, for: async () => rows, orderBy: () => ({ limit: async () => rows }),
    }) }) };
  });
  set.mockImplementation((values: unknown) => ({ where: () => ({ returning: async () => [values] }) }));
  expect(lineNeedsReview(componentId, lineSources[componentId], validateLineSources(definition, lineSources))).toBe(enabled);
  const review = reviewLineContracts(ctx, { observationId: row.id, expectedVersion: row.version,
    assignments: { [componentId]: { scope: "operating", entryPolicy: "additive" } },
  });
  if (enabled) {
    const reviewed = await review;
    expect(reviewed.lineSources[componentId]).toMatchObject({ scope: "operating", entryPolicy: "additive", origin: "reviewed" });
    expect(reviewed.lineSources[componentId].automaticSource).toBeUndefined();
    expect(set).toHaveBeenCalledOnce();
  } else {
    await expect(review).rejects.toThrow("This template line needs no review.");
    expect(set).not.toHaveBeenCalled();
  }
});
