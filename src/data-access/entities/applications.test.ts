import { describe, expect, it } from "vitest";
import { toApplicationOption } from "./applications";

describe("toApplicationOption", () => {
  it("uses the field name, date, and status without visible application or delivery codes", () => {
    expect(
      toApplicationOption({
        id: "application-1",
        code: "AP-26-001",
        applicationDate: new Date("2026-05-17T00:00:00.000Z"),
        status: "applied",
        fieldIdentifier: "North Field",
      }),
    ).toEqual({
      id: "application-1",
      code: "AP-26-001",
      name: "North Field",
      subtitle: "May 17, 2026 · Applied",
    });
  });

  it("uses the date as the primary label when no field name is recorded", () => {
    expect(
      toApplicationOption({
        id: "application-2",
        code: "AP-26-002",
        applicationDate: new Date("2026-05-18T00:00:00.000Z"),
        status: "delivered",
        fieldIdentifier: " ",
      }),
    ).toEqual({
      id: "application-2",
      code: "AP-26-002",
      name: "May 18, 2026",
      subtitle: "Delivered",
    });
  });
});
