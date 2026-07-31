import { describe, expect, it } from "vitest";
import { findDashViolations } from "../scripts/check-ux-copy";

describe("check-ux-copy dash scanner", () => {
  it("flags an em dash in a string literal", () => {
    const violations = findDashViolations(
      'const message = "Saved — review the record.";\n',
      "sample.ts",
    );

    expect(violations).toMatchObject([{ line: 1, character: "em dash" }]);
  });

  it("flags an en dash in a template literal", () => {
    const violations = findDashViolations(
      "const range = `2024–2026 window for ${code}`;\n",
      "sample.ts",
    );

    expect(violations).toMatchObject([{ line: 1, character: "en dash" }]);
  });

  it("flags an em dash in JSX text", () => {
    const violations = findDashViolations(
      "export function Note() {\n  return <p>Ready — submit now.</p>;\n}\n",
      "sample.tsx",
    );

    expect(violations).toMatchObject([{ line: 2, character: "em dash" }]);
  });

  it("ignores dashes in comments", () => {
    const violations = findDashViolations(
      '// A prose comment — with an em dash.\n/* Another — one. */\nconst ok = "clean copy";\n',
      "sample.ts",
    );

    expect(violations).toEqual([]);
  });

  it("allows a lone dash used as an empty-value placeholder glyph", () => {
    const violations = findDashViolations(
      'const emptyCell = "—";\nconst padded = " — ";\n',
      "sample.ts",
    );

    expect(violations).toEqual([]);
  });

  it("ignores hyphens and clean copy", () => {
    const violations = findDashViolations(
      'const label = "Credit-batch code (read-only)";\n',
      "sample.ts",
    );

    expect(violations).toEqual([]);
  });
});
