import { describe, expect, it } from "vitest";
import { splitErrorMessage } from "./error-title";

describe("splitErrorMessage", () => {
  it("keeps one sentence as a title with no detail", () => {
    expect(splitErrorMessage("Something went wrong.")).toEqual({ title: "Something went wrong.", detail: null });
    expect(splitErrorMessage("No full stop")).toEqual({ title: "No full stop", detail: null });
  });

  it("makes the first sentence the title and the rest the detail", () => {
    expect(splitErrorMessage("Held by application AP-26-001. To change this, first correct or remove that application.")).toEqual({
      title: "Held by application AP-26-001.",
      detail: "To change this, first correct or remove that application.",
    });
  });

  it("drops a 'was not saved' lead into the title", () => {
    expect(
      splitErrorMessage("Feedstock was not saved. The bin would go below zero on Sep 22, 2026. Lower the mass."),
    ).toEqual({
      title: "Not saved. The bin would go below zero on Sep 22, 2026.",
      detail: "Lower the mass.",
    });
    expect(splitErrorMessage("Deliveries were not saved. Check the date.")).toEqual({
      title: "Not saved. Check the date.",
      detail: null,
    });
  });

  it("keeps a lone 'was not saved' lead as the title", () => {
    expect(splitErrorMessage("Delivery was not saved.")).toEqual({ title: "Delivery was not saved.", detail: null });
  });

  it("does not split on dates, decimals or codes inside a sentence", () => {
    expect(splitErrorMessage("Moves the delivery past Lost mass (Oct 2, 2026, 08:00) by 1.5 kg.")).toEqual({
      title: "Moves the delivery past Lost mass (Oct 2, 2026, 08:00) by 1.5 kg.",
      detail: null,
    });
  });

  it("splits before a digit", () => {
    expect(splitErrorMessage("Locked. 2 records use it.")).toEqual({ title: "Locked.", detail: "2 records use it." });
  });
});
