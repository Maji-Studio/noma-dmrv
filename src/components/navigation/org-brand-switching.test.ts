import { describe, expect, it } from "vitest";
import { shouldShowOrganizationSwitcher } from "./org-brand-switching";

describe("shouldShowOrganizationSwitcher", () => {
  it.each([
    { organizationCount: 0, expected: false },
    { organizationCount: 1, expected: false },
    { organizationCount: 2, expected: true },
  ])(
    "returns $expected for $organizationCount accessible organizations",
    ({ organizationCount, expected }) => {
      const organizations = Array.from(
        { length: organizationCount },
        (_, index) => ({ id: `organization-${index}` }),
      );

      expect(shouldShowOrganizationSwitcher(organizations)).toBe(expected);
    },
  );
});
