import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * Opt-in visual capture (tests/visual). Reuses the E2E config's localhost
 * guard and base URL, but never starts or tears down anything: the capture
 * runs against an already running, seeded dev server and writes no records.
 *
 * Headless Chromium on macOS has no WebGL2 (#801); SwiftShader gives the map
 * a software GL context so map surfaces render in the capture.
 */
const SWIFTSHADER_ARGS = [
  "--use-angle=swiftshader",
  "--use-gl=angle",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

export default defineConfig({
  ...base,
  testDir: "./tests/visual",
  globalTeardown: undefined,
  webServer: undefined,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    ...base.use,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        locale: "en-US",
        launchOptions: { args: SWIFTSHADER_ARGS },
      },
    },
  ],
});
