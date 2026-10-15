import { reviewedTemplateSources } from "../../../tests/helpers/template-line-sources";
import production from "../../../tests/fixtures/isometric/production-template-2026-07-03.json";
import type { components as RegistryComponents } from "@/lib/isometric/generated/certify";
import { unsupportedTemplate } from "../../../tests/fixtures/isometric/unsupported-template";
import { findUnbindableTemplateInputs as findCoverage, formatUnbindableTemplateInputsText } from "@/lib/isometric/template-binding-coverage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalSubmissionContext } from "./certify-context-core";

const flags = vi.hoisted(() => ({ durabilityEnabled: true }));
vi.mock("./durability-measurement-samples", () => ({
  get DURABILITY_MEASUREMENT_SAMPLES_ENABLED() {
    return flags.durabilityEnabled;
  },
  DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE: "Durability submission is unavailable.",
}));

import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/storage-blueprints";
import {
  prepareRemovalSubmission,
  REMOVAL_PREPARATION_BLOCKERS,
  requirePreparedRemovalSubmission,
} from "./removal-submission-prepare";

const SEQUESTRATION_KEY = CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR;

type PreparationInput = Parameters<typeof prepareRemovalSubmission>[0];

function template(
  overrides: Partial<NonNullable<RemovalSubmissionContext["removalTemplate"]>> = {},
) {
  return {
    id: "rvt-1",
    display_name: "Removal template",
    credit_type: "REMOVAL",
    groups: [
      {
        components: [{ id: "cmp-1", blueprint_key: "electricity_grid", inputs: [] }],
      },
    ],
    ...overrides,
  } as NonNullable<RemovalSubmissionContext["removalTemplate"]>;
}

function context(overrides: Partial<PreparationInput> = {}): PreparationInput {
  return {
    mapping: { externalProjectId: "prj-1" } as PreparationInput["mapping"],
    hasOrgCredentials: true,
    templateBlockers: [],
    lineSources: { "cmp-1": { scope: "operating", entryPolicy: "none", origin: "reviewed" } },
    removalTemplate: template(),
    unresolvedBlueprintKeys: [],
    blueprintsForTemplate: [
      { key: "electricity_grid" },
    ] as PreparationInput["blueprintsForTemplate"],
    ...overrides,
    ...(overrides.removalTemplate ? { lineSources: reviewedTemplateSources(overrides.removalTemplate) } : {}),
  };
}

function codes(input: PreparationInput) {
  return prepareRemovalSubmission(input).blockers.map((blocker) => blocker.code);
}

describe("prepareRemovalSubmission", () => {
  beforeEach(() => {
    flags.durabilityEnabled = true;
  });

  it("prioritizes template type and blueprint resolution before coverage", () => {
    const removalTemplate = unsupportedTemplate();
    removalTemplate.credit_type = "REDUCTION";
    expect(codes(context({ removalTemplate, unresolvedBlueprintKeys: ["retired"] })).slice(0, 3))
      .toEqual(["notRemovalTemplate", "templateOutOfDate", "templateUnbindable"]);
  });

  it("returns the bundle every build and compile takes", () => {
    const { prepared, blockers } = prepareRemovalSubmission(context(), {
      isometricEnvironment: "production",
    });

    expect(blockers).toEqual([]);
    expect(prepared?.removalTemplate.id).toBe("rvt-1");
    expect(prepared?.externalProjectId).toBe("prj-1");
    expect(prepared?.blueprintsByKey.get("electricity_grid")).toEqual({
      key: "electricity_grid",
    });
    expect(prepared?.allowPeriodInputStub).toBe(false);
    expect(prepared?.hasDurabilityComponents).toBe(false);
  });

  it("stubs period inputs only in the sandbox registry", () => {
    const { prepared } = prepareRemovalSubmission(context(), {
      isometricEnvironment: "sandbox",
    });
    expect(prepared?.allowPeriodInputStub).toBe(true);
  });

  it("stops at the first missing dependency with no bundle", () => {
    expect(prepareRemovalSubmission(context({ mapping: null }))).toEqual({
      prepared: null,
      blockers: [
        { code: "noProject", message: REMOVAL_PREPARATION_BLOCKERS.noProject },
      ],
    });
    expect(codes(context({ hasOrgCredentials: false }))).toEqual([
      "noCredentials",
    ]);
    expect(
      codes(
        context({ templateBlockers: [{ code: "templateNotFound", message: REMOVAL_PREPARATION_BLOCKERS.templateNotFound }], removalTemplate: null }),
      ),
    ).toEqual(["templateNotFound"]);
    expect(codes(context({ removalTemplate: null }))).toEqual(["noTemplate"]);
  });

  it("refuses a template that is not a REMOVAL template", () => {
    const result = prepareRemovalSubmission(
      context({ removalTemplate: template({ credit_type: "REDUCTION" } as never) }),
    );
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "notRemovalTemplate",
    ]);
    // Review still compiles from the resolved template.
    expect(result.prepared).not.toBeNull();
  });

  it("refuses a template whose blueprints no longer resolve", () => {
    expect(
      codes(context({ unresolvedBlueprintKeys: ["retired_blueprint"] })),
    ).toEqual(["templateOutOfDate"]);
  });

  it("lists every template blocker in order", () => {
    flags.durabilityEnabled = false;
    expect(
      codes(
        context({
          removalTemplate: template({
            credit_type: "REDUCTION",
            groups: [],
          } as never),
          unresolvedBlueprintKeys: ["retired_blueprint"],
        }),
      ),
    ).toEqual(["notRemovalTemplate", "templateOutOfDate", "emptyTemplate"]);
  });

  it("blocks durability templates while measurement samples are unavailable", () => {
    const durabilityTemplate = template({
      groups: [
        { components: [{ id: "cmp-seq", blueprint_key: SEQUESTRATION_KEY, inputs: [] }] },
      ],
    } as never);
    expect(
      prepareRemovalSubmission(context({ removalTemplate: durabilityTemplate }))
        .prepared?.hasDurabilityComponents,
    ).toBe(true);
    expect(
      codes(context({ removalTemplate: durabilityTemplate })),
    ).toEqual([]);

    flags.durabilityEnabled = false;
    expect(
      codes(context({ removalTemplate: durabilityTemplate })),
    ).toEqual(["durabilityUnavailable"]);
  });
});

describe("requirePreparedRemovalSubmission", () => {
  it("refuses with the first blocker's message", () => {
    expect(() =>
      requirePreparedRemovalSubmission(
        context({
          removalTemplate: template({ credit_type: "REDUCTION" } as never),
          unresolvedBlueprintKeys: ["retired_blueprint"],
        }),
      ),
    ).toThrow(REMOVAL_PREPARATION_BLOCKERS.notRemovalTemplate);
  });

  it("returns the bundle when nothing blocks", () => {
    expect(requirePreparedRemovalSubmission(context()).externalProjectId).toBe(
      "prj-1",
    );
  });
});

it.each([unsupportedTemplate(), production as RegistryComponents["schemas"]["GhgEntryTemplate"]])("blocks preparation with component names and repair guidance", (removalTemplate) => {
  expect(prepareRemovalSubmission(context({ removalTemplate }), { isometricEnvironment: "production" }).blockers).toContainEqual({
    code: "templateUnbindable", message: formatUnbindableTemplateInputsText(findUnbindableTemplateInputs(removalTemplate)),
  });
});

it("preserves sandbox stubs without hiding production project-scope blockers", () => {
  const removalTemplate = production as RegistryComponents["schemas"]["GhgEntryTemplate"];
  const result = prepareRemovalSubmission(context({ removalTemplate }), { isometricEnvironment: "sandbox" });
  const findings = findUnbindableTemplateInputs(removalTemplate, { allowPeriodInputStub: true });
  expect(findings).toHaveLength(5);
  expect(result.prepared?.allowPeriodInputStub).toBe(true);
  expect(result.blockers).toContainEqual({ code: "templateUnbindable", message: formatUnbindableTemplateInputsText(findings) });
  expect(result.blockers.some((blocker) => blocker.message.includes("project level"))).toBe(false);
});

function findUnbindableTemplateInputs(template: Parameters<typeof findCoverage>[0], options: Parameters<typeof findCoverage>[1] = {}) {
  return findCoverage(template, { lineSources: reviewedTemplateSources(template), ...options });
}
