import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const FONT_EXTENSION = /\.(?:woff2?|otf|ttf)$/i;

it("does not track commercially licensed GT Flexa font files", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    encoding: "utf8",
  }).split("\0");
  expect(tracked.filter((path) => /gt-flexa/i.test(path) && FONT_EXTENSION.test(path))).toEqual([]);
});
