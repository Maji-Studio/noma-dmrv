import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

const DESIGN_SKILL_PATH_PATTERN =
  /^\.agents\/skills\/[^/]+-design\/(?:SKILL\.md|references\/[^/]+\.md)$/;
const DESIGN_DOC_PATHS = [
  "docs/design-system.md",
  "docs/ux-writing.md",
  "docs/design-decisions.md",
  "docs/forms.md",
];
const GLOBAL_DESIGN_SKILL_PATH = "global-skills/maji-design-app/SKILL.md";
const GLOBAL_DESIGN_SKILL_CANDIDATES = [
  join(homedir(), ".agents/skills/maji-design-app/SKILL.md"),
  join(homedir(), ".claude/skills/maji-design-app/SKILL.md"),
];

// Only base-tree paths are eligible; missing owning docs are skipped when copied.
export function selectDesignContextPaths(basePaths, practices) {
  if (!practices.includes("design")) return [];
  return [
    ...basePaths.filter((path) => DESIGN_SKILL_PATH_PATTERN.test(path)),
    ...DESIGN_DOC_PATHS,
  ];
}

export function materializeGlobalDesignSkill(artifactDir) {
  const source = GLOBAL_DESIGN_SKILL_CANDIDATES.find((path) => existsSync(path));
  if (!source) {
    process.stderr.write(
      "Warning: maji-design-app/SKILL.md is missing from both global skill locations; Design criteria may be incomplete.\n",
    );
    return { designGlobalSkill: "missing" };
  }
  const absolute = join(artifactDir, "base-context", GLOBAL_DESIGN_SKILL_PATH);
  const content = readFileSync(source, "utf8");
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return {
    designGlobalSkill: source,
    contextFile: { path: GLOBAL_DESIGN_SKILL_PATH, absolute },
  };
}
