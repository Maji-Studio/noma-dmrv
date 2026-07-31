import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findDashViolations } from "../scripts/check-ux-copy";

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");
const CHECK_UX_COPY_SCRIPT = fileURLToPath(
  new URL("../scripts/check-ux-copy.ts", import.meta.url),
);

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

  it("ignores entity spellings in comments and non-entity strings", () => {
    const violations = findDashViolations(
      [
        "// Explain why &mdash; is banned in rendered copy.",
        'const nearMiss = "Ready &mdash submit now";',
      ].join("\n"),
      "sample.ts",
    );

    expect(violations).toEqual([]);
  });

  it("flags an entity-encoded dash in JSX text", () => {
    const violations = findDashViolations(
      "export function Note() {\n  return <p>Standard &mdash; specimen</p>;\n}\n",
      "sample.tsx",
    );

    expect(violations).toMatchObject([{ line: 2, character: "dash entity" }]);
  });

  it("flags entity-encoded dashes in JSX attributes and plain strings", () => {
    const violations = findDashViolations(
      [
        'const message = "Ready &ndash; submit now.";',
        'export const Note = () => <p aria-label="Ready &mdash; submit now">Ready</p>;',
      ].join("\n"),
      "sample.tsx",
    );

    expect(violations).toMatchObject([
      { line: 1, character: "dash entity" },
      { line: 2, character: "dash entity" },
    ]);
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

  it("fails the CLI for a file whose only violation is an encoded entity", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "check-ux-copy-"));
    const fixture = join(projectRoot, "src", "entity-only.tsx");

    try {
      mkdirSync(dirname(fixture), { recursive: true });
      writeFileSync(
        fixture,
        'export const Note = () => <p title="Ready &mdash; submit">Ready</p>;\n',
      );

      const result = spawnSync(process.execPath, [TSX_CLI, CHECK_UX_COPY_SCRIPT], {
        cwd: projectRoot,
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("src/entity-only.tsx:1");
      expect(result.stderr).toContain("dash entity");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
