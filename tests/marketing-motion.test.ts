import { describe, expect, it } from "vitest";
import { durationMs } from "../site/src/components/site/motion.js";

describe("marketing animation durations", () => {
  it.each([
    ["3000ms", 3000],
    ["3s", 3000],
    ["300ms", 300],
    [".3s", 300],
    [" 0s ", 0],
  ])("preserves the duration of %s after CSS minification", (value, expected) => {
    expect(durationMs(value)).toBe(expected);
  });

  it.each(["", "invalid", "-1s"])("uses the fallback for %s", (value) => {
    expect(durationMs(value, 3000)).toBe(3000);
  });
});
