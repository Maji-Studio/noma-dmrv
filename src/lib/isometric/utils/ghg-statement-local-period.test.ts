import { describe, expect, it } from "vitest";
import {
  chooseStoredRemotePeriodEnd,
  UNKNOWN_REMOTE_PERIOD_END_ON,
} from "./ghg-statement-local-period";

describe("GHG statement local period allocation", () => {
  it("stores an unoccupied authoritative registry end directly", () => {
    expect(
      chooseStoredRemotePeriodEnd("2026-03-31", new Set()),
    ).toEqual({
      endOn: "2026-03-31",
      synthetic: false,
    });
  });

  it("allocates distinct surrogates for duplicate and null registry periods", () => {
    const occupied = new Set(["2026-03-31", UNKNOWN_REMOTE_PERIOD_END_ON]);

    const duplicate = chooseStoredRemotePeriodEnd("2026-03-31", occupied);
    expect(duplicate).toEqual({
      endOn: "9999-12-30",
      synthetic: true,
    });
    occupied.add(duplicate.endOn);
    expect(chooseStoredRemotePeriodEnd(null, occupied)).toEqual({
      endOn: "9999-12-29",
      synthetic: true,
    });
  });
});
