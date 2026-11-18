// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartialFiguresNotice } from "./shared";

describe("PartialFiguresNotice", () => {
  it("says which stages may read low and how to find the failing batch", () => {
    render(<PartialFiguresNotice />);
    expect(screen.getByText("Biochar and Delivery may be low.")).toBeTruthy();
    expect(screen.getByText(/Pick one credit batch to see which one needs fixing\./)).toBeTruthy();
  });
});
