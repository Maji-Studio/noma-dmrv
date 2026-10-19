import { afterEach, describe, expect, it, vi } from "vitest";
import { createDistanceChipElement } from "./viewer-elements";

/** The chip only sets text, a class, a dataset key and one attribute: a plain stand-in is enough. */
function fakeElement() {
  const attributes: Record<string, string> = {};
  return {
    className: "",
    textContent: "",
    dataset: {} as Record<string, string>,
    setAttribute: (name: string, value: string) => { attributes[name] = value; },
    getAttribute: (name: string) => attributes[name] ?? null,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("createDistanceChipElement", () => {
  it("shows the counted round trip beside the one-way distance", () => {
    vi.stubGlobal("document", { createElement: () => fakeElement() });
    const chip = createDistanceChipElement(240);
    expect(chip.textContent).toBe("240 km · 480 km counted");
    expect(chip.getAttribute("aria-label")).toBe("240 km one way · 480 km round trip counted");
  });
});
