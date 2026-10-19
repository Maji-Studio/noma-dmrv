// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { measureFormGeometry } from "./visual/form-geometry";
import { measureNativePickerIcons } from "./visual/native-picker-geometry";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("trailing icon geometry", () => {
  function fixture(inset: number, filled: boolean, borderRight = 1) {
    const fieldStyle = `opacity:1;border-right:${borderRight}px solid`;
    document.body.innerHTML = `<main data-capture-root style="opacity:1">
      <button id="entity" data-testid="entity-select-trigger" data-has-value="${filled}" style="${fieldStyle}"><svg data-trailing-icon style="opacity:1"></svg></button>
      <input id="date" type="date" style="${fieldStyle}" value="${filled ? "2026-10-13" : ""}">
      <input id="datetime" type="datetime-local" style="${fieldStyle}" value="${filled ? "2026-10-13T08:35" : ""}">
      <input id="time" type="time" style="${fieldStyle}" value="${filled ? "08:35" : ""}">
    </main>`;
    const rect = (right: number, width: number) => ({ right, left: right - width, width, height: 40, top: 0, bottom: 40, x: right - width, y: 0, toJSON: () => ({}) });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this.tagName === "svg" ? rect(400 - borderRight - inset, 16) : rect(400, 200);
    });
    return { kind: "page" as const, mode: "form" as const, nativePickerIcons: [0, 1, 2].map((index) => ({ index, right: 400 - borderRight - inset })) };
  }

  it.each([false, true])("measures empty and filled controls (filled: %s)", (filled) => {
    const geometry = measureFormGeometry(fixture(12, filled));
    expect(geometry.trailingIcons).toHaveLength(4);
    expect(geometry.trailingIcons.map((icon) => [icon.kind, icon.state, icon.rightInset, icon.valid])).toEqual([
      ["entity", filled ? "filled" : "empty", 12, true],
      ["date", filled ? "filled" : "empty", 12, true],
      ["datetime-local", filled ? "filled" : "empty", 12, true],
      ["time", filled ? "filled" : "empty", 12, true],
    ]);
  });

  it.each([[11, true], [13, true], [10.9, false], [13.1, false], [40, false]])("judges a %spx padding-box inset against 12px +/- 1px", (inset, valid) => {
    expect(measureFormGeometry(fixture(inset, false)).trailingIcons.every((icon) => icon.valid === valid)).toBe(true);
  });

  it.each([0, 1, 1.5])("subtracts a %spx border for every icon kind", (borderRight) => {
    const icons = measureFormGeometry(fixture(12, false, borderRight)).trailingIcons;
    expect(icons.map((icon) => [icon.rightInset, icon.valid])).toEqual(Array(4).fill([12, true]));
  });

  it("accepts an outer-edge EntitySelect inset of 12px and native subpixel insets around 13px", () => {
    const args = fixture(11, false);
    args.nativePickerIcons = [0, 1, 2].map((index) => ({ index, right: 400 - 13.25 }));
    const icons = measureFormGeometry(args).trailingIcons;
    expect(icons.map((icon) => [icon.rightInset, icon.valid])).toEqual([
      [11, true], [12.3, true], [12.3, true], [12.3, true],
    ]);
  });

  it("fails unmeasured native icons instead of substituting host padding", () => {
    const args = fixture(12, false);
    args.nativePickerIcons = [];
    const icons = measureFormGeometry(args).trailingIcons;
    expect(icons.filter((icon) => icon.kind !== "entity").map((icon) => [icon.rightInset, icon.valid])).toEqual([[null, false], [null, false], [null, false]]);
  });
});

describe("native picker measurement", () => {
  it("reads actual shadow content quads and detaches the session", async () => {
    const detach = vi.fn();
    const send = vi.fn(async (method: string) => {
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (method === "DOM.querySelector") return { nodeId: 2 };
      if (method === "DOM.querySelectorAll") return { nodeIds: [3] };
      if (method === "DOM.describeNode") return { node: { nodeId: 3, backendNodeId: 3, shadowRoots: [{ nodeId: 0, backendNodeId: 4, children: [{ nodeId: 0, backendNodeId: 5, attributes: ["id", "picker"] }] }] } };
      if (method === "DOM.getBoxModel") return { model: { width: 16, height: 16, content: [372, 10, 388, 10, 388, 26, 372, 26] } };
      throw new Error(method);
    });
    const page = { context: () => ({ newCDPSession: async () => ({ send, detach }) }) } as unknown as Page;
    expect(await measureNativePickerIcons(page)).toEqual([{ index: 0, right: 388 }]);
    expect(send).toHaveBeenCalledWith("DOM.describeNode", { nodeId: 3, depth: -1, pierce: true });
    expect(send).toHaveBeenCalledWith("DOM.getBoxModel", { backendNodeId: 5 });
    expect(detach).toHaveBeenCalledOnce();
  });
});
