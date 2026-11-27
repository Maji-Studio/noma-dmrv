import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UncarbonizedBadge } from "./uncarbonized-badge";
import { EntityOptionText } from "@/components/forms/entity-select/entity-select-row";

describe("UncarbonizedBadge", () => {
  it("renders the Uncarbonized chip", () => {
    expect(renderToStaticMarkup(<UncarbonizedBadge />)).toContain(">Uncarbonized</span>");
  });

  it("shows on entity-select options that carry the tag, and only those", () => {
    expect(renderToStaticMarkup(<EntityOptionText option={{ id: "a", code: "B1", name: "Reject bin", uncarbonized: true }} />)).toContain("Uncarbonized");
    expect(renderToStaticMarkup(<EntityOptionText option={{ id: "b", code: "B2", name: "Bin 2", uncarbonized: false }} />)).not.toContain("Uncarbonized");
  });
});
