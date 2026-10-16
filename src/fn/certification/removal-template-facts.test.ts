import { expect, it, vi } from "vitest";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { normalizeTemplateDefinition, resolveLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { logger } from "@/lib/log";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";

vi.mock("./observe-removal-template", () => ({ observeRemovalTemplate: vi.fn() }));
import { observeRemovalTemplate } from "./observe-removal-template";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { resolveRemovalTemplate } from "./resolve-removal-template";

it.each(["missing observation", "incomplete enrichment"])("defers coverage to templateNotFullyRead for %s", async (condition) => {
  const template = fixture as GhgEntryTemplate;
  if (condition === "missing observation") {
    vi.mocked(observeRemovalTemplate).mockRejectedValue(new Error("Template read failed"));
  } else {
    const definition = normalizeTemplateDefinition(template);
    vi.mocked(observeRemovalTemplate).mockResolvedValue({ definition, enrichment: {}, lineSources: resolveLineSources({ definition }) } as never);
  }
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  try {
    const facts = await loadRemovalTemplateFacts(makeTestOrgContext(), {
      client: {} as Parameters<typeof loadRemovalTemplateFacts>[1]["client"],
      externalProjectId: template.project_id, template, blueprints: [],
    });
    expect(facts.unbindableTemplateInputs).toEqual([]);
    const resolved = resolveRemovalTemplate([{ removalTemplateId: template.id }], {
      templatesById: { [template.id]: facts },
    } as unknown as FacilityCertifierFacts);
    expect(resolved.templateBlockers[0]).toEqual({ code: "templateNotFullyRead", message: REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead });
  } finally { warn.mockRestore(); }
});
