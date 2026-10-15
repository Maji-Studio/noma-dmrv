import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestTemplateObservation, observeTemplate } from "@/data-access/removal-template-observations";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import { normalizeTemplateDefinition, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import type { IsometricClient } from "@/lib/isometric";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import sandbox from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { observeRemovalTemplate, TEMPLATE_ENRICHMENT_TTL_MS } from "./observe-removal-template";

vi.mock("@/data-access/removal-template-observations", () => ({ getLatestTemplateObservation: vi.fn(), observeTemplate: vi.fn() }));
vi.mock("@/lib/isometric/template-observations/load-enrichment", () => ({ loadTemplateEnrichment: vi.fn() }));
const ctx = makeTestOrgContext();
const template = structuredClone(sandbox) as GhgEntryTemplate;
const group = template.groups.find((group) => group.key === "pyrolysis")!;
group.components = [group.components.find((component) => component.blueprint_key === "grid_electricity_use")!];
group.components[0].inputs = group.components[0].inputs.filter((input) => input.type === "monitored");
template.groups = [group];
const enrichment = { [group.components[0].id]: { electricity_use: { unit: "kWh", deprecated: null } } };
const input = { client: {} as IsometricClient, externalProjectId: template.project_id, template, blueprints: [] };
function previous(age: number, overrides = {}) {
  return { definition: normalizeTemplateDefinition(template), enrichment, externalProjectId: template.project_id,
    lastObservedAt: new Date(Date.now() - age), ...overrides } as unknown as Awaited<ReturnType<typeof getLatestTemplateObservation>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTemplateEnrichment).mockResolvedValue(enrichment);
});
describe("template enrichment reuse", () => {
  it("reuses a complete identical definition within the 24-hour TTL and still observes it", async () => {
    vi.mocked(getLatestTemplateObservation).mockResolvedValue(previous(0));
    await observeRemovalTemplate(ctx, input);
    expect(loadTemplateEnrichment).not.toHaveBeenCalled();
    expect(observeTemplate).toHaveBeenCalledWith(ctx, expect.objectContaining({ enrichment }));
  });
  it.each([
    ["expired", () => previous(TEMPLATE_ENRICHMENT_TTL_MS + 1)],
    ["incomplete", () => previous(0, { enrichment: {} })],
    ["definition changed", () => previous(0, { definition: { groups: [] } })],
    ["project changed", () => previous(0, { externalProjectId: "other-project" })],
    ["first read", () => null],
  ])("refreshes %s enrichment", async (_name, stored) => {
    vi.mocked(getLatestTemplateObservation).mockResolvedValue(stored());
    await observeRemovalTemplate(ctx, input);
    expect(loadTemplateEnrichment).toHaveBeenCalledWith(input.client, template, []);
  });
});
