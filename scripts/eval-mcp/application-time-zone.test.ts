import { expect, it } from "vitest";
import { chooseApplicationTimeZone } from "./application-time-zone";
import { formatFacilityDate } from "@/lib/date-utils";

it.each([
  ["2026-10-15T00:30:00Z", "UTC", "2026-10-15"],
  ["2026-10-15T23:30:00Z", "UTC", "2026-10-15"],
  ["2026-10-15T23:30:00Z", "Europe/Zurich", "2026-10-16"],
  ["2026-10-15T00:30:00Z", "America/New_York", "2026-10-14"],
])("matches the session calendar at %s in %s", (instant, localZone, expectedDate) => {
  const now = new Date(instant);
  const zone = chooseApplicationTimeZone(now, localZone);
  expect(zone).not.toBe("UTC");
  expect(formatFacilityDate(now, zone)).toBe(expectedDate);
});
