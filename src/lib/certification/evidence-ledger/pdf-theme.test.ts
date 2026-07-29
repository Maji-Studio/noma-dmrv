import { describe, expect, it } from "vitest";
import { C } from "./pdf-theme";

// @react-pdf/pdfkit's `_normalizeColor` mis-parses the 8-digit hex that
// @react-pdf/stylesheet folds `rgba()` into, so any translucent token paints
// border strokes bright red. Tokens must stay 6-digit hex, pre-flattened over
// paper — this guards the regression rather than the exact shades.
describe("evidence-ledger PDF tokens", () => {
  it.each(Object.entries(C))("%s is a 6-digit hex colour", (_name, value) => {
    expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });
});
