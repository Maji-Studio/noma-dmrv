import { deepStrictEqual } from "node:assert/strict";

import { selectDesignContextPaths } from "./review-context.mjs";

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
