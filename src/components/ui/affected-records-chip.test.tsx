// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AffectedRecordsChip } from "./affected-records-chip";

describe("AffectedRecordsChip", () => {
  afterEach(cleanup);

  it("uses the singular for one record", () => {
    render(<AffectedRecordsChip count={1} singular="order" plural="orders" />);
    expect(screen.getByText("1 affected order")).toBeTruthy();
  });

  it("uses the plural otherwise", () => {
    render(<AffectedRecordsChip count={3} singular="order" plural="orders" />);
    expect(screen.getByText("3 affected orders")).toBeTruthy();
  });
});
