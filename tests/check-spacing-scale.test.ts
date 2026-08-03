/**
 * The spacing-scale gate's parser.
 *
 * Worth testing on its own because the gate is the only thing standing between
 * an off-scale utility and a control that renders at the wrong size: Tailwind
 * emits no rule and no warning, `tsc` sees a string, and ESLint sees a string.
 * If this parser silently stops matching a family, nothing else notices.
 */
import { describe, expect, it } from "vitest";
import { parseUtility } from "../scripts/check-spacing-scale";

describe("parseUtility", () => {
  it("reads a plain spacing utility", () => {
    expect(parseUtility("p-16")).toEqual({ prefix: "p", value: 16 });
    expect(parseUtility("gap-24")).toEqual({ prefix: "gap", value: 24 });
  });

  it("prefers the longest matching prefix", () => {
    // `min-w-4` is not `m` with the value `in-w-4`, and `gap-x-8` is not `gap`.
    expect(parseUtility("min-w-4")).toEqual({ prefix: "min-w", value: 4 });
    expect(parseUtility("gap-x-8")).toEqual({ prefix: "gap-x", value: 8 });
  });

  it("strips variants, however many are stacked", () => {
    expect(parseUtility("md:p-16")).toEqual({ prefix: "p", value: 16 });
    expect(parseUtility("dark:lg:hover:gap-24")).toEqual({
      prefix: "gap",
      value: 24,
    });
    // Arbitrary variants end in `:` too, so the same rule covers them.
    expect(parseUtility("[&_th]:py-14")).toEqual({ prefix: "py", value: 14 });
  });

  it("strips both important forms", () => {
    // Tailwind accepts a leading and a trailing `!`, and an off-scale value
    // compiles to nothing under either.
    expect(parseUtility("!p-3")).toEqual({ prefix: "p", value: 3 });
    expect(parseUtility("p-3!")).toEqual({ prefix: "p", value: 3 });
    expect(parseUtility("md:!mt-3")).toEqual({ prefix: "mt", value: 3 });
  });

  it("reads a negative utility as its magnitude", () => {
    expect(parseUtility("-mt-16")).toEqual({ prefix: "mt", value: 16 });
  });

  it("covers the less obvious members of the spacing namespace", () => {
    // These read as their own scales but are not: each resolves through
    // `--spacing-*` and so dies with it.
    expect(parseUtility("basis-3")).toEqual({ prefix: "basis", value: 3 });
    expect(parseUtility("translate-x-3")).toEqual({
      prefix: "translate-x",
      value: 3,
    });
    expect(parseUtility("scroll-mt-3")).toEqual({
      prefix: "scroll-mt",
      value: 3,
    });
    expect(parseUtility("indent-3")).toEqual({ prefix: "indent", value: 3 });
    expect(parseUtility("border-spacing-3")).toEqual({
      prefix: "border-spacing",
      value: 3,
    });
    expect(parseUtility("leading-3")).toEqual({ prefix: "leading", value: 3 });
  });

  it("ignores anything that is not a bare integer", () => {
    // Each of these is valid CSS under this theme and none of them touches the
    // numeric scale, so flagging them would make the gate unusable.
    for (const token of [
      "w-full",
      "h-screen",
      "w-1/2",
      "size-[44px]",
      "max-w-[560px]",
      "min-w-0px",
      "inset-x-auto",
      "p-(--custom)",
    ]) {
      expect(parseUtility(token), token).toBeNull();
    }
  });

  it("ignores numeric utilities backed by a different scale", () => {
    // These survive `--spacing-*: initial` because they never read it.
    for (const token of [
      "border-2",
      "z-10",
      "opacity-40",
      "order-2",
      "grid-cols-3",
      "col-span-2",
      "line-clamp-2",
      "duration-200",
      "grow-0",
    ]) {
      expect(parseUtility(token), token).toBeNull();
    }
  });

  it("ignores ordinary words that happen to contain a hyphen and a number", () => {
    // The scanner reads every string literal, not only class attributes, so
    // query keys and slugs pass through here.
    for (const token of [
      "storage-locations",
      "credit-batch-2",
      "2026-07-28",
      "biochar_sequestration_1000_year",
    ]) {
      expect(parseUtility(token), token).toBeNull();
    }
  });
});
