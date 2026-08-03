import { describe, expect, it } from "vitest";
import { resolveLocationCountry } from "./location-defaults";

describe("resolveLocationCountry", () => {
  it("uses the organization default when creating a location", () => {
    expect(resolveLocationCountry(undefined, "Kenya")).toBe("Kenya");
  });

  it("keeps the saved country when editing a location", () => {
    expect(resolveLocationCountry({ country: "Rwanda" }, "Kenya")).toBe(
      "Rwanda",
    );
  });
});
