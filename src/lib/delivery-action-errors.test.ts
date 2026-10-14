import { expect, it } from "vitest";
import { deliveryActionFieldIssues, deliveryActionIssues, throwDeliveryActionError } from "./delivery-action-errors";
import { deliveryReferenceNotFound } from "./delivery-domain-errors";

it("shows a source bin not_found refusal on the source bin field", () => {
  const refusal = deliveryReferenceNotFound(["storageLocationId"], "Source bin");
  try { throwDeliveryActionError({ success: false, error: refusal.message, code: refusal.code, issues: refusal.issues }); }
  catch (error) {
    expect(deliveryActionFieldIssues(error, ["storageLocationId"])).toEqual([
      { field: "storageLocationId", message: "Source bin was not found." },
    ]);
    return;
  }
  expect.fail("Expected the action refusal to throw");
});
it("keeps typed field issues when the action is thrown by the hook", () => {
  const issues = [{ path: ["deliveryDate"], code: "validation_failed", message: "Enter a time at or before now." }];
  try { throwDeliveryActionError({ success: false, error: issues[0].message, issues }); }
  catch (error) { expect(deliveryActionIssues(error)).toEqual(issues); }
});

const renderedFields = ["deliveryDate", "deliveredWetMassKg"] as const;
const issue = (path: (string | number)[]) => ({ path, code: "validation_failed", message: "Refused" });
const refusal = (paths: (string | number)[][]) => Object.assign(new Error("Refused"), { issues: paths.map(issue) });

it("maps every issue to rendered fields, including source issues to mass", () => {
  expect(deliveryActionFieldIssues(refusal([["deliveryDate"], ["sources", 0, "layerId"]]), renderedFields)).toEqual([
    { field: "deliveryDate", message: "Refused" },
    { field: "deliveredWetMassKg", message: "Refused" },
  ]);
});

it("leaves partly mapped refusals to the banner", () => {
  expect(deliveryActionFieldIssues(refusal([["deliveryDate"], ["driverId"]]), renderedFields)).toBeUndefined();
});

it("leaves unmapped refusals to the banner", () => {
  expect(deliveryActionFieldIssues(refusal([["driverId"]]), renderedFields)).toBeUndefined();
});

it("leaves errors without issues to the banner", () => {
  expect(deliveryActionFieldIssues(new Error("Refused"), renderedFields)).toBeUndefined();
  expect(deliveryActionFieldIssues(refusal([]), renderedFields)).toBeUndefined();
});
