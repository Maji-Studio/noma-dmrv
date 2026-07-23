import { describe, expect, it } from "vitest";
import { selectActiveOrganizationId } from "./organization-selection";

describe("selectActiveOrganizationId", () => {
  it("restores the saved organization when it is still accessible", () => {
    expect(
      selectActiveOrganizationId({
        lastActiveOrganizationId: "org-later",
        accessibleOrganizationIds: ["org-first", "org-later"],
      }),
    ).toBe("org-later");
  });

  it("uses the first deterministically ordered organization when the saved one is stale", () => {
    expect(
      selectActiveOrganizationId({
        lastActiveOrganizationId: "org-revoked",
        accessibleOrganizationIds: ["org-oldest", "org-newer"],
      }),
    ).toBe("org-oldest");
  });

  it("uses the first accessible organization when no preference has been saved", () => {
    expect(
      selectActiveOrganizationId({
        lastActiveOrganizationId: null,
        accessibleOrganizationIds: ["org-first", "org-second"],
      }),
    ).toBe("org-first");
  });

  it("leaves users without accessible organizations unscoped", () => {
    expect(
      selectActiveOrganizationId({
        lastActiveOrganizationId: "org-deleted",
        accessibleOrganizationIds: [],
      }),
    ).toBeNull();
  });
});
