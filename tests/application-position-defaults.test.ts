import { describe, expect, it } from "vitest";
import { resolveApplicationPositionDefault } from "@/components/applications/mass-utils";

describe("application position defaults", () => {
  it("prefills the field position from the delivery destination customer location", () => {
    expect(
      resolveApplicationPositionDefault({
        delivery: {
          destinationGpsLatitude: -3.3,
          destinationGpsLongitude: 37.3,
        },
      }),
    ).toEqual({
      gpsLatitude: -3.3,
      gpsLongitude: 37.3,
    });
  });

  it("yields no prefill when the destination has no GPS", () => {
    expect(
      resolveApplicationPositionDefault({
        delivery: {
          destinationGpsLatitude: null,
          destinationGpsLongitude: null,
        },
      }),
    ).toBeNull();
  });

  it("yields no prefill when the destination GPS is partial", () => {
    expect(
      resolveApplicationPositionDefault({
        delivery: {
          destinationGpsLatitude: -3.3,
          destinationGpsLongitude: null,
        },
      }),
    ).toBeNull();
  });

  it("yields no prefill without a selected delivery", () => {
    expect(resolveApplicationPositionDefault({ delivery: null })).toBeNull();
    expect(resolveApplicationPositionDefault({ delivery: undefined })).toBeNull();
  });
});
