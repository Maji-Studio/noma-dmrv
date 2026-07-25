import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Enforce the 1000-line file-size cap (CLAUDE.md). Set to "warn" so it
  // surfaces existing violations without blocking the build; flip to "error"
  // once the current offenders are split (architecture audit, Phase 4).
  // Generated Isometric types and the seed script are exempt — they are not
  // hand-maintained code.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/isometric/generated/**", "src/db/seed-data.ts"],
    rules: {
      "max-lines": [
        "warn",
        { max: 1000, skipBlankLines: false, skipComments: false },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // eslint-config-next only ignores the ROOT .next. A build run from a git
    // worktree under .claude/worktrees/ leaves its own .next inside the repo,
    // which ESLint then walks — turning `pnpm lint` red with hundreds of
    // errors that belong to generated code in a checkout nobody is editing.
    "**/.next/**",
    ".claude/worktrees/**",
    // Untracked QA run tooling (only markdown reports are committed —
    // docs/organization.md); driver scripts are throwaway, not lintable code.
    "docs/qa/artifacts/**",
  ]),
]);

export default eslintConfig;
