import { describe, expect, it } from "vitest";
import { settledPreview } from "./use-settled-preview";

describe("settledPreview", () => {
  const answer = { state: "match" };

  it("is pending while the input settles or any check runs, even with an earlier answer", () => {
    expect(settledPreview(true, { isFetching: false, isError: false, data: answer })).toEqual({ state: "pending" });
    expect(settledPreview(false, { isFetching: true, isError: false, data: answer })).toEqual({ state: "pending" });
  });

  it("puts an error before old data", () => {
    expect(settledPreview(false, { isFetching: false, isError: true, data: answer })).toEqual({ state: "error" });
  });

  it("shows the settled answer, and is pending without one", () => {
    expect(settledPreview(false, { isFetching: false, isError: false, data: answer })).toEqual({ state: "ready", data: answer });
    expect(settledPreview(false, { isFetching: false, isError: false })).toEqual({ state: "pending" });
  });
});
