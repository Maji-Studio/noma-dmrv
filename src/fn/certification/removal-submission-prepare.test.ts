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
  overrides: Partial<NonNullable<RemovalSubmissionContext["defaultTemplate"]>> = {},
) {
  return {
    id: "rvt-1",
    display_name: "Removal template",
    credit_type: "REMOVAL",
    groups: [
      {
        components: [{ id: "cmp-1", blueprint_key: "electricity_grid" }],
      },
    ],
    ...overrides,
  } as NonNullable<RemovalSubmissionContext["defaultTemplate"]>;
}

function context(overrides: Partial<PreparationInput> = {}): PreparationInput {
  return {
    mapping: { externalProjectId: "prj-1" } as PreparationInput["mapping"],
    hasOrgCredentials: true,
    missingDefaultTemplateId: null,
    defaultTemplate: template(),
    unresolvedBlueprintKeys: [],
    blueprintsForTemplate: [
      { key: "electricity_grid" },
    ] as PreparationInput["blueprintsForTemplate"],
    ...overrides,
  };
}

function codes(input: PreparationInput) {
  return prepareRemovalSubmission(input).blockers.map((blocker) => blocker.code);
}

describe("prepareRemovalSubmission", () => {
  beforeEach(() => {
    flags.durabilityEnabled = true;
  });

  it("returns the bundle every build and compile takes", () => {
    const { prepared, blockers } = prepareRemovalSubmission(context(), {
      isometricEnvironment: "production",
    });

    expect(blockers).toEqual([]);
    expect(prepared?.defaultTemplate.id).toBe("rvt-1");
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
        context({ missingDefaultTemplateId: "rvt-gone", defaultTemplate: null }),
      ),
    ).toEqual(["templateNotFound"]);
    expect(codes(context({ defaultTemplate: null }))).toEqual(["noTemplate"]);
  });

  it("refuses a template that is not a REMOVAL template", () => {
    const result = prepareRemovalSubmission(
      context({ defaultTemplate: template({ credit_type: "REDUCTION" } as never) }),
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
          defaultTemplate: template({
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
        { components: [{ id: "cmp-seq", blueprint_key: SEQUESTRATION_KEY }] },
      ],
    } as never);
    expect(
      prepareRemovalSubmission(context({ defaultTemplate: durabilityTemplate }))
        .prepared?.hasDurabilityComponents,
    ).toBe(true);
    expect(
      codes(context({ defaultTemplate: durabilityTemplate })),
    ).toEqual([]);

    flags.durabilityEnabled = false;
    expect(
      codes(context({ defaultTemplate: durabilityTemplate })),
    ).toEqual(["durabilityUnavailable"]);
  });
});

describe("requirePreparedRemovalSubmission", () => {
  it("refuses with the first blocker's message", () => {
    expect(() =>
      requirePreparedRemovalSubmission(
        context({
          defaultTemplate: template({ credit_type: "REDUCTION" } as never),
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
