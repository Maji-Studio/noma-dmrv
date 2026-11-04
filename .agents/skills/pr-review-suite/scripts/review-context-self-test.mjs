import { deepStrictEqual } from "node:assert/strict";

import { selectDesignContextPaths } from "./review-context.mjs";
import { createPrompt, extractPracticeDefinition, REVIEW_SCHEMA } from "./review-prompt.mjs";
import { aggregateReport, displayPractice } from "./review-report.mjs";
import { DEFAULT_PRACTICES, parseArgs, selectPractices } from "./review-runtime.mjs";

export function selfTestDesignContext() {
  const projectPaths = [
    ".agents/skills/noma-design/SKILL.md",
    ".agents/skills/noma-design/references/design-review.md",
    ".agents/skills/other-design/SKILL.md",
    ".agents/skills/other-design/references/forms.md",
  ];
  const basePaths = [
    ...projectPaths,
    ".agents/skills/noma-design/README.md",
    ".agents/skills/noma-design/references/nested/ignored.md",
    ".agents/skills/noma-design/references/ignored.txt",
    ".agents/skills/noma-design-extra/SKILL.md",
    ".agents/skills/pr-review-suite/SKILL.md",
    ".agents/skills/nested/noma-design/SKILL.md",
    "docs/design-system.md",
    "src/example.tsx",
  ];
  const docs = [
    "docs/design-system.md",
    "docs/ux-writing.md",
    "docs/design-decisions.md",
    "docs/forms.md",
  ];
  deepStrictEqual(selectDesignContextPaths(basePaths, ["design"]), [
    ...projectPaths, ...docs,
  ]);
  deepStrictEqual(
    selectDesignContextPaths(basePaths, ["standards", "design", "spec"]),
    [...projectPaths, ...docs],
  );
  deepStrictEqual(selectDesignContextPaths([], ["design"]), docs);
  deepStrictEqual(selectDesignContextPaths(basePaths, []), []);
  deepStrictEqual(
    selectDesignContextPaths(basePaths, ["standards", "spec", "deep-correctness"]),
    [],
  );
}

export function selfTestDesignRuntime(reference) {
  if (
    !parseArgs(["--plan", "--practices", "design"]).practices.includes("design") ||
    !REVIEW_SCHEMA.properties.practice.enum.includes("design") ||
    displayPractice("design") !== "Design"
  ) {
    throw new Error("Design selection/schema self-test failed");
  }
  const selectionCases = [
    [["src/example.ts"], reference, "No UI files changed"],
    [["src/components/foo.tsx"], reference, undefined],
    [["src/components/foo.test.tsx"], reference, "No UI files changed"],
    ...["jsx", "css", "scss", "html", "vue", "svelte"].map((extension) =>
      [[`src/foo.${extension}`], reference, undefined]),
    ...["e2e", "tests", "__tests__", "__mocks__"].map((directory) =>
      [[`src/${directory}/foo.tsx`], reference, "No UI files changed"]),
    [["src/foo.spec.tsx"], reference, "No UI files changed"],
    [["src/tests-helper/foo.tsx", "src/foo.test.tsx"], reference, undefined],
    [["src/foo.tsx"], undefined, "No Design practice in the base branch"],
    [["src/foo.tsx"], reference.replace(/^## Design$/gm, "## Other"), "No Design practice in the base branch"],
  ];
  for (const [changedFiles, basePracticeReference, reason] of selectionCases) {
    const selection = selectPractices({
      practices: DEFAULT_PRACTICES, spec: undefined, changedFiles, basePracticeReference,
    });
    if (
      selection.skippedPractices.get("design") !== reason ||
      selection.practices.includes("design") !== (reason === undefined) ||
      selection.skippedPractices.get("spec") !== "No spec available" ||
      selection.practices.length !== (reason ? 2 : 3)
    ) {
      throw new Error(`practice selection self-test failed for ${changedFiles}`);
    }
    const selectionReport = aggregateReport({
      pr: { number: 1, url: "https://github.com/example/repo/pull/1", baseRefName: "staging" },
      baseSha: "a".repeat(40), headSha: "b".repeat(40), reports: [],
      skippedPractices: selection.skippedPractices,
    });
    if (
      !selectionReport.includes("_No spec available; practice skipped._") ||
      !selectionReport.includes("**Spec:** skipped; no spec available.") ||
      (reason && (!selectionReport.includes(`_${reason}; practice skipped._`) ||
        !selectionReport.includes(`**Design:** skipped; ${reason[0].toLowerCase()}${reason.slice(1)}.`)))
    ) {
      throw new Error("practice skip reason self-test failed");
    }
  }
  const contextFiles = [
    { path: "GLOSSARY.md", absolute: "/artifacts/base-context/GLOSSARY.md" },
  ];
  const designContextFiles = [
    { path: "docs/ux-writing.md", absolute: "/artifacts/base-context/docs/ux-writing.md" },
    {
      path: "global-skills/maji-design-app/SKILL.md",
      absolute: "/artifacts/base-context/global-skills/maji-design-app/SKILL.md",
      source: "global",
    },
  ];
  for (const practice of DEFAULT_PRACTICES) {
    const practiceDefinition = extractPracticeDefinition(reference, practice);
    if (!practiceDefinition.startsWith(`## ${displayPractice(practice)}`)) {
      throw new Error(`practice definition self-test failed for ${practice}`);
    }
    const prompt = createPrompt({
      practice,
      model: "codex",
      pr: { number: 1, title: "Example", body: "Body" },
      baseRef: "a".repeat(40),
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diff: {
        diffRange: "base...HEAD",
        changedFiles: ["src/example.ts"],
        commits: "abc1234 example",
        patch: "diff --git a/src/example.ts b/src/example.ts",
      },
      contextFiles: practice === "design" ? [...contextFiles, ...designContextFiles] : contextFiles,
      spec: undefined,
      practiceDefinition,
    });
    if (
      !prompt.includes(practiceDefinition) ||
      !prompt.includes(contextFiles[0].absolute)
    ) {
      throw new Error(`prompt self-test failed for ${practice}`);
    }
    const [baseContext, globalContext] = prompt.split(
      "Global design skill (copied from the operator's machine, not the base branch):",
    );
    if (practice === "design") {
      if (
        !baseContext.includes(designContextFiles[0].absolute) ||
        baseContext.includes(designContextFiles[1].path) ||
        !globalContext?.includes(designContextFiles[1].absolute)
      ) {
        throw new Error("Design prompt context provenance self-test failed");
      }
    } else if (
      prompt.includes("global-skills/maji-design-app") ||
      prompt.includes("docs/ux-writing.md") ||
      globalContext !== undefined
    ) {
      throw new Error(`Design context leaked into ${practice} prompt`);
    }
  }
}
