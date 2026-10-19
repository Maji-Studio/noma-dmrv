import { describe, expect, it } from "vitest";
import { createIntentHref, isCreateIntentValue } from "./create-intent";

describe("createIntentHref", () => {
  it("opens the list's create sheet for one facility", () => {
    const href = createIntentHref("/reactors", "fac 1&x");
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/reactors");
    expect(url.searchParams.get("facility")).toBe("fac 1&x");
    expect(isCreateIntentValue(url.searchParams.get("create"))).toBe(true);
  });
});
