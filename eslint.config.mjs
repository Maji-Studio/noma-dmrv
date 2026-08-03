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
  // Phosphor has two entry points that are not interchangeable, and picking
  // the wrong one fails in a way that does not name the import (see
  // docs/design-system.md → Phosphor icons).
  //
  // The root entry's icons are built on `IconBase` (`useContext`) and pull in a
  // module that calls `createContext` at module scope, so the entry is
  // client-only and fails at IMPORT time under the `react-server` condition:
  // "The requested module 'react' does not provide an export named
  // 'createContext'" — an error that names React, not the icon. The `/dist/ssr`
  // icons use the hook-free `SSRBase` and import cleanly in both environments
  // with identical prop defaults. The root entry also re-exports the whole
  // `/dist/ssr` barrel on top of its own.
  //
  // The `Icon` / `IconProps` / `IconWeight` TYPES, however, live only on the
  // root. Hence `allowTypeImports` — a type-only import erases at compile time,
  // so it costs no runtime module and cannot drag `IconBase` into a server
  // bundle. This is why the rule needs the @typescript-eslint variant.
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@phosphor-icons/react",
              message:
                "Import icon components from '@phosphor-icons/react/dist/ssr' (hook-free, works in Server Components). Only the `Icon`/`IconProps`/`IconWeight` types come from this entry, and only via `import type`.",
              allowTypeImports: true,
            },
          ],
        },
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
