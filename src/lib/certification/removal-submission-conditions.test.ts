import { expect, it } from "vitest";
import { make1000YearSequestrationTemplate, makeSequestrationTemplate, makeTemplate } from "../../../tests/fixtures/submit-removal-templates";
import { isDurabilitySubmissionUnavailable, isEmptyRemovalTemplate } from "./removal-submission-conditions";

it.each([
  { template: null, enabled: false, unavailable: false },
  { template: { ...makeTemplate(), groups: [] }, enabled: false, unavailable: false },
  { template: makeTemplate(), enabled: false, unavailable: false },
  { template: make1000YearSequestrationTemplate(), enabled: false, unavailable: true },
  { template: make1000YearSequestrationTemplate(), enabled: true, unavailable: false },
  { template: makeSequestrationTemplate(), enabled: false, unavailable: true },
  { template: makeSequestrationTemplate(), enabled: true, unavailable: false },
])("judges durability availability with measurement samples enabled=$enabled: $unavailable", ({ template, enabled, unavailable }) => {
  expect(isDurabilitySubmissionUnavailable(template, enabled)).toBe(unavailable);
});

it("only treats a resolved template with no groups as empty", () => {
  const template = makeTemplate();
  expect(isEmptyRemovalTemplate(null)).toBe(false);
  expect(isEmptyRemovalTemplate({ ...template, groups: [] })).toBe(true);
  expect(isEmptyRemovalTemplate(template)).toBe(false);
  expect(isEmptyRemovalTemplate({ ...template, groups: template.groups.map(group => ({ ...group, components: [] })) })).toBe(false);
});
