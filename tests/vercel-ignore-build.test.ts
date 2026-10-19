import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = resolve(import.meta.dirname, "../scripts/vercel-ignore-build.sh");
const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, "utf8");
const APP_PROJECT_ID = SCRIPT_SOURCE.match(/^APP_PROJECT_ID="([^"]+)"$/m)![1];
const SITE_PROJECT_ID = SCRIPT_SOURCE.match(/^SITE_PROJECT_ID="([^"]+)"$/m)![1];
const BUILD_EXIT_CODE = 1;
const SKIP_EXIT_CODE = 0;
const GIT_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Build test",
  GIT_AUTHOR_EMAIL: "build-test@example.invalid",
  GIT_COMMITTER_NAME: "Build test",
  GIT_COMMITTER_EMAIL: "build-test@example.invalid",
};

describe("Vercel ignored build step", () => {
  let directory: string;

  function git(...args: string[]) {
    return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: directory, env: GIT_ENV, encoding: "utf8", stdio: "pipe",
    }).trim();
  }

  function commitFile(path: string, contents: string) {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
    git("add", "--", path);
    git("commit", "--quiet", "--no-gpg-sign", "-m", "Build fixture");
  }

  function runScript(previousSha: string, projectId = APP_PROJECT_ID) {
    const result = spawnSync("sh", [SCRIPT_PATH], {
      cwd: directory,
      env: { ...GIT_ENV, VERCEL_PROJECT_ID: projectId, VERCEL_GIT_PREVIOUS_SHA: previousSha },
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    return result.status;
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "vercel-ignore-build-"));
    git("init", "--quiet", "--template=");
    commitFile("site/index.html", "Initial site\n");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    ["app", APP_PROJECT_ID],
    ["site", SITE_PROJECT_ID],
  ])("builds a redeploy of HEAD for the %s project", (_name, projectId) => {
    expect(runScript(git("rev-parse", "HEAD"), projectId)).toBe(BUILD_EXIT_CODE);
  });

  it("skips the app when only site/ changed since the previous commit", () => {
    const previousSha = git("rev-parse", "HEAD");
    commitFile("site/index.html", "Updated site\n");
    expect(runScript(previousSha)).toBe(SKIP_EXIT_CODE);
  });

  it("builds the app when src/ changed since the previous commit", () => {
    const previousSha = git("rev-parse", "HEAD");
    commitFile("src/app.ts", "export const updated = true;\n");
    expect(runScript(previousSha)).toBe(BUILD_EXIT_CODE);
  });

  it("builds when there is no previous deployment SHA", () => {
    expect(runScript("")).toBe(BUILD_EXIT_CODE);
  });
});
