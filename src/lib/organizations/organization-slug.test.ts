import { describe, expect, it } from "vitest";
import {
  isSlugForBase,
  organizationSlugBase,
  organizationSlugCandidate,
  ORGANIZATION_SLUG_MAX_LENGTH,
} from "./organization-slug";

describe("organization slugs", () => {
  it.each([
    ["  Café Déjà Vu!  ", "cafe-deja-vu"],
    ["A___B / C...D", "a-b-c-d"],
    ["🌳🔥", "organization"],
    ["---", "organization"],
    ["", "organization"],
    ["Ｆｕｌｌ Width", "full-width"],
    ["e\u0301cole", "ecole"],
  ])("normalizes %j", (name, expected) => {
    expect(organizationSlugBase(name)).toBe(expected);
  });

  it("caps the base and removes a hyphen at the cut", () => {
    expect(organizationSlugBase("a".repeat(ORGANIZATION_SLUG_MAX_LENGTH + 1)))
      .toBe("a".repeat(ORGANIZATION_SLUG_MAX_LENGTH));
    const prefix = "a".repeat(ORGANIZATION_SLUG_MAX_LENGTH - 1);
    expect(organizationSlugBase(`${prefix} next`)).toBe(prefix);
  });

  it("numbers candidates from the unsuffixed base", () => {
    expect(organizationSlugCandidate("example", 1)).toBe("example");
    expect(organizationSlugCandidate("example", 2)).toBe("example-2");
    expect(organizationSlugCandidate("example", 12)).toBe("example-12");
  });

  it.each(["example", "example-2", "example-10", "example-999"])(
    "recognizes %s", (slug) => expect(isSlugForBase(slug, "example")).toBe(true),
  );
  it.each(["example-1", "example-0", "example-02", "example--2", "example-2x", "example-2.5", "example-other", "other-example-2"])(
    "rejects %s", (slug) => expect(isSlugForBase(slug, "example")).toBe(false),
  );
});
