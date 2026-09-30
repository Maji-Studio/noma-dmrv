/**
 * Shared opt-in gate for the live Isometric sandbox suites:
 *   - tests/isometric-sandbox-health.integration.test.ts (read-only health checks)
 *   - tests/isometric-sandbox.integration.test.ts (write paths)
 *
 * Opt-in only: suites skip unless `RUN_ISOMETRIC_SANDBOX_TESTS=1`. Once opted
 * in, importing this module throws unless the sandbox env is complete, so a
 * misconfigured run fails at collection instead of reporting a false green:
 *   - `ISOMETRIC_CLIENT_SECRET` and `ISOMETRIC_ACCESS_TOKEN` set
 *   - `ISOMETRIC_ENVIRONMENT === "sandbox"`
 *   - `ISOMETRIC_DEMO_PROJECT_ID` set (no hard-coded fallback; same guardrail
 *     as scripts/isometric-smoke.ts)
 */
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local", override: false });

const OPTED_IN = process.env.RUN_ISOMETRIC_SANDBOX_TESTS === "1";
const MISSING_SANDBOX_VARS = [
  !process.env.ISOMETRIC_CLIENT_SECRET && "ISOMETRIC_CLIENT_SECRET",
  !process.env.ISOMETRIC_ACCESS_TOKEN && "ISOMETRIC_ACCESS_TOKEN",
  process.env.ISOMETRIC_ENVIRONMENT !== "sandbox" &&
    'ISOMETRIC_ENVIRONMENT (must equal "sandbox")',
  !process.env.ISOMETRIC_DEMO_PROJECT_ID && "ISOMETRIC_DEMO_PROJECT_ID",
].filter(Boolean) as string[];

export const SANDBOX_CONFIGURED = OPTED_IN && MISSING_SANDBOX_VARS.length === 0;

if (OPTED_IN && !SANDBOX_CONFIGURED) {
  throw new Error(
    `RUN_ISOMETRIC_SANDBOX_TESTS=1 but sandbox env is incomplete. Missing/misconfigured: ${MISSING_SANDBOX_VARS.join(
      ", ",
    )}.`,
  );
}

export const SANDBOX_TEST_TIMEOUT_MS = 30_000;

export async function getSandboxClient() {
  const { getIsometricClientFromEnv } = await import("@/lib/isometric");
  return getIsometricClientFromEnv();
}
