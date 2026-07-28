/**
 * Guard test for the ISOMETRIC_ENVIRONMENT production requirement.
 *
 * This gate is easy to get wrong in a way that only shows up in CI: `next build`
 * runs with `NODE_ENV=production`, so a naive `NODE_ENV === "production"` check
 * fails every hermetic production bundle (it did — it broke the `build` job once
 * already). The CI carve-out is therefore load-bearing, and so is the gate
 * itself, since an unset value silently routes every registry call to the
 * sandbox. Both halves are pinned here.
 *
 * `env` parses at module load, so each case re-imports the module against a
 * mutated `process.env` rather than exporting the schema just for tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_MODULE = "./env";

/** Parse `env` fresh under an overridden process.env; return the raised issues. */
async function parseEnvWith(
  overrides: Record<string, string | undefined>,
): Promise<{ threw: boolean; paths: string[] }> {
  vi.resetModules();
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await import(ENV_MODULE);
    return { threw: false, paths: [] };
  } catch (error) {
    const issues = (error as { issues?: Array<{ path: unknown[] }> }).issues;
    return {
      threw: true,
      paths: (issues ?? []).map((issue) => String(issue.path[0])),
    };
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  }
}

afterEach(() => {
  vi.resetModules();
});

describe("ISOMETRIC_ENVIRONMENT production gate", () => {
  it("rejects an unset value in a real production deployment", async () => {
    const { threw, paths } = await parseEnvWith({
      NODE_ENV: "production",
      CI: undefined,
      ISOMETRIC_ENVIRONMENT: undefined,
    });

    expect(threw).toBe(true);
    expect(paths).toContain("ISOMETRIC_ENVIRONMENT");
  });

  // The regression: GitHub Actions sets CI=true and builds a production bundle
  // without this var. Firing here fails `pnpm build` for everyone.
  it("does not fire for a hermetic CI production build", async () => {
    const { paths } = await parseEnvWith({
      NODE_ENV: "production",
      CI: "true",
      ISOMETRIC_ENVIRONMENT: undefined,
    });

    expect(paths).not.toContain("ISOMETRIC_ENVIRONMENT");
  });

  it("accepts an explicit value in production", async () => {
    const { paths } = await parseEnvWith({
      NODE_ENV: "production",
      CI: undefined,
      ISOMETRIC_ENVIRONMENT: "production",
    });

    expect(paths).not.toContain("ISOMETRIC_ENVIRONMENT");
  });

  it("leaves non-production environments on the sandbox default", async () => {
    const { threw, paths } = await parseEnvWith({
      ISOMETRIC_ENVIRONMENT: undefined,
    });

    expect(threw).toBe(false);
    expect(paths).not.toContain("ISOMETRIC_ENVIRONMENT");
  });
});
