import { expect, it } from "vitest";
import { locationDistanceFillWarnings } from "./location-write-warnings";

it.each([
  ["supplier", 1, "Filled the missing distance on 1 intake."],
  ["supplier", 3, "Filled the missing distance on 3 intakes."],
  ["customer", 1, "Recorded the distance on 1 delivery."],
  ["customer", 2, "Recorded the distance on 2 deliveries."],
] as const)("words %s fills for %s rows", (kind, filled, message) => {
  expect(locationDistanceFillWarnings(kind, { filled, skipped: { submitted: 0, concurrent: 0, repointed: 0 } })).toEqual([message]);
});

it.each([
  ["supplier", 1, "1 intake belongs to a submitted Removal and was left unchanged."],
  ["supplier", 2, "2 intakes belong to a submitted Removal and were left unchanged."],
  ["customer", 1, "1 delivery belongs to a submitted Removal and was left unchanged."],
  ["customer", 2, "2 deliveries belong to a submitted Removal and were left unchanged."],
] as const)("words %s submitted skips for %s rows", (kind, submitted, message) => {
  expect(locationDistanceFillWarnings(kind, { filled: 0, skipped: { submitted, concurrent: 0, repointed: 0 } })).toEqual([message]);
});

it("keeps each skip reason separate from filled rows", () => {
  expect(locationDistanceFillWarnings("supplier", { filled: 3, skipped: { submitted: 1, concurrent: 2, repointed: 1 } })).toEqual([
    "Filled the missing distance on 3 intakes.",
    "1 intake belongs to a submitted Removal and was left unchanged.",
    "2 intakes changed while the location was being saved and were left unchanged.",
    "1 intake moved to another supplier or facility and was left unchanged.",
  ]);
  expect(locationDistanceFillWarnings("customer", { filled: 0, skipped: { submitted: 0, concurrent: 0, repointed: 0 } })).toEqual([]);
});
