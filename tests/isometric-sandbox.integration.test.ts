/**
 * Isometric sandbox integration smoke test.
 *
 * Opt-in only: skipped unless `RUN_ISOMETRIC_SANDBOX_TESTS=1`.
 * Run via `pnpm test:integration`, which sets the env var and includes
 * this file. Default `pnpm test` skips it so unit runs never hit the
 * live sandbox API.
 *
 * Additional preconditions (also enforced; missing → skipped):
 *   - `ISOMETRIC_CLIENT_SECRET` and `ISOMETRIC_ACCESS_TOKEN` set
 *   - `ISOMETRIC_ENVIRONMENT === "sandbox"`
 *   - `ISOMETRIC_DEMO_PROJECT_ID` set (no hard-coded fallback; same
 *     guardrail as scripts/isometric-smoke.ts)
 *
 * Out of scope: write paths (POST /datapoints, POST /removals,
 * POST /ghg_statements). Sandbox templates currently have unmapped
 * monitored inputs and unbound fixed constants — see
 * `docs/open-questions.md` → `phase-3-input-coverage` /
 * `phase-3-fixed-constants`.
 */
import { config as loadDotenv } from "dotenv";
import { describe, expect, it } from "vitest";

loadDotenv({ path: ".env.local", override: false });

const OPTED_IN = process.env.RUN_ISOMETRIC_SANDBOX_TESTS === "1";
const MISSING_SANDBOX_VARS = [
  !process.env.ISOMETRIC_CLIENT_SECRET && "ISOMETRIC_CLIENT_SECRET",
  !process.env.ISOMETRIC_ACCESS_TOKEN && "ISOMETRIC_ACCESS_TOKEN",
  process.env.ISOMETRIC_ENVIRONMENT !== "sandbox" &&
    'ISOMETRIC_ENVIRONMENT (must equal "sandbox")',
  !process.env.ISOMETRIC_DEMO_PROJECT_ID && "ISOMETRIC_DEMO_PROJECT_ID",
].filter(Boolean) as string[];
const SANDBOX_CONFIGURED = OPTED_IN && MISSING_SANDBOX_VARS.length === 0;

if (OPTED_IN && !SANDBOX_CONFIGURED) {
  throw new Error(
    `RUN_ISOMETRIC_SANDBOX_TESTS=1 but sandbox env is incomplete. Missing/misconfigured: ${MISSING_SANDBOX_VARS.join(
      ", ",
    )}.`,
  );
}

const TEST_TIMEOUT_MS = 30_000;

describe.skipIf(!SANDBOX_CONFIGURED)(
  "Isometric sandbox read paths",
  () => {
    it(
      "lists projects and includes the configured demo project",
      async () => {
        const { listProjects } = await import("@/lib/isometric");
        const projects = await listProjects();
        expect(projects.length).toBeGreaterThan(0);
        const demoId = process.env.ISOMETRIC_DEMO_PROJECT_ID as string;
        expect(projects.some((p) => p.id === demoId)).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "lists removal templates for the demo project",
      async () => {
        const { listRemovalTemplates } = await import("@/lib/isometric");
        const demoId = process.env.ISOMETRIC_DEMO_PROJECT_ID as string;
        const templates = await listRemovalTemplates(demoId);
        expect(templates.length).toBeGreaterThan(0);
        for (const template of templates) {
          expect(typeof template.id).toBe("string");
          expect(template.id.length).toBeGreaterThan(0);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "lists component blueprints from the global catalog",
      async () => {
        const { listComponentBlueprints } = await import("@/lib/isometric");
        const blueprints = await listComponentBlueprints();
        expect(blueprints.length).toBeGreaterThan(0);
        for (const blueprint of blueprints) {
          expect(typeof blueprint.key).toBe("string");
          expect(blueprint.key.length).toBeGreaterThan(0);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);

describe.skipIf(SANDBOX_CONFIGURED)(
  "Isometric sandbox read paths (skipped — opt in via RUN_ISOMETRIC_SANDBOX_TESTS=1 + sandbox env)",
  () => {
    it("skipped because RUN_ISOMETRIC_SANDBOX_TESTS or sandbox env vars are not set", () => {
      // Placeholder so the file always reports something useful when
      // sandbox env is absent. Vitest still emits the describe name.
      expect(SANDBOX_CONFIGURED).toBe(false);
    });
  },
);
