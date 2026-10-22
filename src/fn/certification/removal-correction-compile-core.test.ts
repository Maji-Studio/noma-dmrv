import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { buildRemovalContext } from "./certify-context-core";
import { prepareRemovalSubmission } from "./removal-submission-prepare";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";
import { compileRemovalCorrectionContent } from "./removal-correction-compile-core";
import { RemovalComparisonBlockedError } from "./removal-comparison-blocked-error";
import { ENTRY_HAS_NO_REMOVAL } from "@/lib/certification/emission-entry-messages";

vi.mock("./removal-scope", () => ({ resolveScopeForRemoval: vi.fn(async () => ({ facilityId: "facility" })) }));
vi.mock("@/data-access/facilities", () => ({ getFacilityById: vi.fn(async () => ({ timezone: "UTC" })) }));
vi.mock("@/data-access/certification", () => ({ getCertifierProjectByFacility: vi.fn(async () => ({})) }));
vi.mock("./stored-removal-template", () => ({ storedRemovalTemplateFacts: vi.fn(() => ({})) }));
vi.mock("./certify-context-core", () => ({ buildRemovalContext: vi.fn() }));
vi.mock("./removal-submission-prepare", () => ({ prepareRemovalSubmission: vi.fn() }));
vi.mock("./removal-submission-build", () => ({ buildRemovalSubmissionBuild: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it.each([
  { preparation: [], contributions: [{ code: "entryHasNoRemoval", message: ENTRY_HAS_NO_REMOVAL }] },
  { preparation: [], contributions: [{ code: "entryMissingEvidence", message: "Add a file for each emissions entry with a value." }] },
  { preparation: [{ code: "templateOutOfDate", message: "The registry template is out of date. Refresh the facility link in settings before submitting." }], contributions: [] },
  { preparation: [{ code: "noProject", message: "Link a facility to an Isometric project first." }],
    contributions: [{ code: "entryHasNoRemoval", message: ENTRY_HAS_NO_REMOVAL }] },
])("preserves preparation and contribution messages on refusal: %j", async ({ preparation, contributions }) => {
  vi.mocked(buildRemovalContext).mockResolvedValue({ removalEntryContext: { contributions: { blockers: contributions } } } as never);
  vi.mocked(prepareRemovalSubmission).mockReturnValue({ prepared: null, blockers: preparation } as never);
  const result = compileRemovalCorrectionContent(makeTestOrgContext(), "removal", { externalTemplateId: "template" } as never, true);
  await expect(result).rejects.toBeInstanceOf(RemovalComparisonBlockedError);
  await expect(result).rejects.toMatchObject({ messages: [...preparation, ...contributions].map(blocker => blocker.message) });
  expect(buildRemovalSubmissionBuild).not.toHaveBeenCalled();
});
