// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { KeyboardEvent, WheelEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Input,
  preventNumberInputKeyChange,
  preventNumberInputWheelChange,
} from "./index";

afterEach(cleanup);

describe("Input trailing icons", () => {
  it.each(["date", "time", "datetime-local"])("keeps native %s values and picker spacing", (type) => {
    render(<Input type={type} aria-label="Event time" />);
    const input = screen.getByLabelText("Event time");

    expect(input.getAttribute("type")).toBe(type);
    for (const className of [
      "px-12", "[display:revert]", "text-left",
      "[&::-webkit-datetime-edit]:flex-1", "[&::-webkit-datetime-edit]:min-w-0",
      "[&::-webkit-datetime-edit]:p-0", "[&::-webkit-date-and-time-value]:text-left",
      "[&::-webkit-calendar-picker-indicator]:m-0", "[&::-webkit-calendar-picker-indicator]:ms-8",
      "[&::-webkit-calendar-picker-indicator]:p-0", "[&::-webkit-calendar-picker-indicator]:shrink-0",
    ]) expect(input.classList.contains(className)).toBe(true);
    expect(input.classList.contains("flex")).toBe(false);
  });

  it("preserves native search-cancel vertical centering", () => {
    render(<Input type="search" aria-label="Search records" />);
    const input = screen.getByRole("searchbox", { name: "Search records" });

    expect(input.classList.contains("[&::-webkit-search-cancel-button]:mx-0")).toBe(true);
    expect(input.classList.contains("[&::-webkit-search-cancel-button]:m-0")).toBe(false);
  });
});

describe("preventNumberInputWheelChange", () => {
  it("removes focus so scrolling cannot change the numeric value", () => {
    const blur = vi.fn();
    const event = {
      currentTarget: { blur },
    } as unknown as WheelEvent<HTMLInputElement>;

    preventNumberInputWheelChange(event);

    expect(blur).toHaveBeenCalledOnce();
  });
});

describe("preventNumberInputKeyChange", () => {
  it.each(["ArrowUp", "ArrowDown"])(
    "prevents %s from stepping the numeric value",
    (key) => {
      const preventDefault = vi.fn();
      const event = {
        key,
        preventDefault,
      } as unknown as KeyboardEvent<HTMLInputElement>;

      preventNumberInputKeyChange(event);

      expect(preventDefault).toHaveBeenCalledOnce();
    },
  );

  it.each(["1", ".", "Tab", "ArrowLeft", "ArrowRight"])(
    "preserves normal number entry for %s",
    (key) => {
      const preventDefault = vi.fn();
      const event = {
        key,
        preventDefault,
      } as unknown as KeyboardEvent<HTMLInputElement>;

      preventNumberInputKeyChange(event);

      expect(preventDefault).not.toHaveBeenCalled();
    },
  );
});
