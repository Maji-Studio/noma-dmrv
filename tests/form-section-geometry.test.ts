// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { measureFormGeometry } from "./visual/form-geometry";

const BODY_WIDTH = 640;
const ROW_HEIGHT = 40;
const SECTION_GAP = 36;
const SECOND_SECTION_TOP = ROW_HEIGHT + SECTION_GAP;

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("headingless section capture geometry", () => {
  it.each(["data-form-section", "data-detail-section"])("recognizes %s dividers, spacing and field groups without headings", (attribute) => {
    document.body.innerHTML = `<main data-capture-root style="opacity:1">
      <div style="opacity:1">
        <section ${attribute} style="opacity:1">
          <div style="opacity:1">
            <div style="opacity:1"><label for="name" style="opacity:1">Name</label></div>
            <input id="name" style="opacity:1">
          </div>
        </section>
        <section ${attribute} style="opacity:1;border-top:1px solid black">
          <div style="opacity:1">
            <div style="opacity:1"><label for="description" style="opacity:1">Description</label></div>
            <textarea id="description" style="opacity:1"></textarea>
          </div>
        </section>
      </div>
    </main>`;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const top = this.closest(`section:nth-child(2)`) ? SECOND_SECTION_TOP : 0;
      return { top, bottom: top + ROW_HEIGHT, left: 0, right: BODY_WIDTH, width: BODY_WIDTH, height: ROW_HEIGHT, x: 0, y: top, toJSON: () => ({}) };
    });
    const geometry = measureFormGeometry({ kind: "page", mode: "form", nativePickerIcons: [] });
    expect(geometry.lines.items).toEqual([expect.objectContaining({ allowed: "section-divider" })]);
    expect(geometry.lines.violations).toBe(0);
    expect(geometry.rhythm.gaps.filter(gap => gap.level === "section")).toEqual([
      { level: "section", value: SECTION_GAP, between: "Name → Description" },
    ]);
    expect(geometry.alignment.controlLeftEdges.map(group => group.section)).toEqual(["Name", "Description"]);
    expect(geometry.r1.sectionTitles).toEqual([]);
  });
});
