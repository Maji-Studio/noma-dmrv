import { describe, expect, it } from "vitest";
import { ActionError } from "./action-error";
import { conflictCode } from "./conflict-ref";
import { STALE_VERSION_CONFLICT_CODE, StaleVersionError, throwActionError } from "./stale-version";
import { deliveryReferenceNotFound } from "./delivery-domain-errors";
import { LOCKED_FIELD_MESSAGE, planSaveRefusal } from "./save-refusal";

const LOCK_REASON = "Sent to a Removal. Fix it by correcting the Removal first.";
const issue = (path: (string | number)[], message = "Refused", code = "validation_failed") => ({ path, code, message });
const refusal = (issues: ReturnType<typeof issue>[], code?: "certification_locked") =>
  new ActionError({ error: issues[0]?.message ?? "Refused", code, issues });
const lock = (...fields: string[]) =>
  refusal(fields.map((field) => issue([field], LOCK_REASON, "certification_locked")), "certification_locked");

const everything = { isShown: () => true, isChanged: () => true };

describe("planSaveRefusal", () => {
  it("shows a lock on a changed, shown field as Locked and gives the reason once", () => {
    const plan = planSaveRefusal(lock("massWetKg", "moistureContentPercent"), everything);
    expect(plan).toEqual({
      fieldErrors: [
        { field: "massWetKg", message: LOCKED_FIELD_MESSAGE, locked: true },
        { field: "moistureContentPercent", message: LOCKED_FIELD_MESSAGE, locked: true },
      ],
      footer: LOCK_REASON,
    });
  });

  it("sends a lock on a field the operator did not change to the footer", () => {
    const plan = planSaveRefusal(lock("supplierId"), { isShown: () => true, isChanged: () => false });
    expect(plan).toEqual({ fieldErrors: [], footer: LOCK_REASON });
  });

  it("sends a lock on a field that is not shown to the footer", () => {
    const plan = planSaveRefusal(lock("applicationId"), { isShown: () => false, isChanged: () => true });
    expect(plan).toEqual({ fieldErrors: [], footer: LOCK_REASON });
  });

  it("splits shown and hidden ordinary issues", () => {
    const error = refusal([
      issue(["deliveryDate"], "Enter a time at or before now."),
      issue(["driverId"], "Driver was not found."),
    ]);
    const plan = planSaveRefusal(error, { isShown: (field) => field === "deliveryDate", isChanged: () => false });
    expect(plan).toEqual({
      fieldErrors: [{ field: "deliveryDate", message: "Enter a time at or before now.", locked: false }],
      footer: "Driver was not found.",
    });
  });

  it("keeps a second reason for the same field in the footer", () => {
    const error = refusal([issue(["fieldSizeHa"], "Enter a field size."), issue(["fieldSizeHa"], "Field size is too large.")]);
    expect(planSaveRefusal(error, everything)).toEqual({
      fieldErrors: [{ field: "fieldSizeHa", message: "Enter a field size.", locked: false }],
      footer: "Field size is too large.",
    });
  });

  it("does not need a change to show an ordinary issue", () => {
    const plan = planSaveRefusal(refusal([issue(["notes"], "Too long.")]), { isShown: () => true, isChanged: () => false });
    expect(plan?.fieldErrors).toEqual([{ field: "notes", message: "Too long.", locked: false }]);
    expect(plan?.footer).toBeNull();
  });

  it("combines a lock reason and a hidden ordinary issue in the footer", () => {
    const error = refusal([
      issue(["massWetKg"], LOCK_REASON, "certification_locked"),
      issue(["driverId"], "Driver was not found."),
    ]);
    const plan = planSaveRefusal(error, { isShown: (field) => field === "massWetKg", isChanged: () => true });
    expect(plan?.fieldErrors).toEqual([{ field: "massWetKg", message: LOCKED_FIELD_MESSAGE, locked: true }]);
    expect(plan?.footer).toBe(`${LOCK_REASON} Driver was not found.`);
  });

  it("renames server paths with the form's alias map, whole path first", () => {
    const aliases = { moistureContentPercent: "moisturePercent", sources: "deliveredWetMassKg", "allocations.0": "x" };
    const seen: string[] = [];
    const plan = planSaveRefusal(
      refusal([issue(["moistureContentPercent"]), issue(["sources", 0, "layerId"])]),
      { aliases, isShown: (field) => (seen.push(field), true), isChanged: () => true },
    );
    expect(plan?.fieldErrors.map((e) => e.field)).toEqual(["moisturePercent", "deliveredWetMassKg"]);
    expect(seen).toContain("moisturePercent");
  });

  it.each([0, 12, "selected"])("captures one wildcard segment (%s) in an alias", (segment) => {
    const plan = planSaveRefusal(refusal([issue(["ingredients", segment, "wetMassKg"])]), {
      ...everything, aliases: { "ingredients.*.wetMassKg": "ingredientBins.*.massKg" },
    });
    expect(plan?.fieldErrors).toEqual([{ field: `ingredientBins.${segment}.massKg`, message: "Refused", locked: false }]);
    expect(plan?.footer).toBeNull();
  });

  it("maps a supplier quick-add location field to its flat form name", () => {
    const plan = planSaveRefusal(refusal([issue(["locations", 0, "gpsLatitude"])]), {
      ...everything, aliases: { "locations.0.*": "*" },
    });
    expect(plan?.fieldErrors).toEqual([{ field: "gpsLatitude", message: "Refused", locked: false }]);
  });

  it.each([
    ["ingredients", "wetMassKg"],
    ["ingredients", 0, "nested", "wetMassKg"],
    ["ingredients", 0, "moisturePercent"],
    ["other", 0, "wetMassKg"],
  ])("does not match wildcard aliases against a different path %j", (...path) => {
    const plan = planSaveRefusal(refusal([issue(path)]), {
      ...everything, aliases: { "ingredients.*.wetMassKg": "ingredientBins.*.massKg" },
    });
    expect(plan?.fieldErrors[0].field).toBe(path.join("."));
  });

  it("prefers a whole-path alias over a wildcard, then a wildcard over a first-segment alias", () => {
    const plan = planSaveRefusal(refusal([
      issue(["ingredients", 0, "wetMassKg"]),
      issue(["ingredients", 1, "wetMassKg"]),
      issue(["ingredients", 2, "moisturePercent"]),
    ]), {
      ...everything,
      aliases: {
        ingredients: "allIngredients",
        "ingredients.*.wetMassKg": "ingredientBins.*.massKg",
        "ingredients.0.wetMassKg": "firstMassKg",
      },
    });
    expect(plan?.fieldErrors.map(({ field }) => field)).toEqual(["firstMassKg", "ingredientBins.1.massKg", "allIngredients"]);
  });

  it("joins numeric path parts with dots", () => {
    const plan = planSaveRefusal(refusal([issue(["allocations", 0, "storageLocationId"])]), everything);
    expect(plan?.fieldErrors[0].field).toBe("allocations.0.storageLocationId");
  });

  it("keeps the same message once when two hidden issues repeat it", () => {
    const plan = planSaveRefusal(refusal([issue(["a"], "Same."), issue(["b"], "Same.")]), { isShown: () => false, isChanged: () => false });
    expect(plan?.footer).toBe("Same.");
  });

  it("leaves non-ActionErrors, empty issue lists and lock-without-issues to the caller", () => {
    expect(planSaveRefusal(new Error("Refused"), everything)).toBeNull();
    expect(planSaveRefusal("boom", everything)).toBeNull();
    expect(planSaveRefusal(refusal([]), everything)).toBeNull();
  });

  it("leaves stale-version and conflict refusals to their own UI", () => {
    const conflict = { code: STALE_VERSION_CONFLICT_CODE, entity: "feedstock", id: "f1" };
    try {
      throwActionError({ success: false, error: "Changed", conflict, issues: [issue(["x"])] });
    } catch (error) {
      expect(error).toBeInstanceOf(StaleVersionError);
      expect(planSaveRefusal(error, everything)).toBeNull();
    }
    const other = new ActionError({ error: "Taken", code: "conflict", conflict: { code: conflictCode("BIN-1"), entity: "storageLocation", id: "b1" }, issues: [issue(["x"])] });
    expect(planSaveRefusal(other, everything)).toBeNull();
    const stale = new ActionError({ error: "Changed", code: "stale_version", issues: [issue(["massWetKg"])] });
    expect(planSaveRefusal(stale, everything)).toBeNull();
  });

  it("plans an insufficient-stock conflict at the field and preserves its bin and blockers", () => {
    const message = "Bin SL-26-001 would go 999 kg below zero.";
    const conflict = { entity: "storageLocation", id: "bin-id", code: conflictCode("SL-26-001") };
    const blockers = [{ entity: "productionRun", id: "run-id", code: conflictCode("PR-26-001") }];
    try {
      throwActionError({
        error: `Feedstock was not saved. ${message} Review bin intake and withdrawal history.`,
        code: "insufficient_stock", conflict, blockers,
        issues: [issue(["massWetKg"], message, "insufficient_stock")],
      });
    } catch (error) {
      expect(planSaveRefusal(error, everything)).toEqual({
        fieldErrors: [{ field: "massWetKg", message, locked: false }],
        footer: null,
      });
      expect(error).toMatchObject({ conflict, blockers });
      return;
    }
    expect.fail("Expected the action refusal to throw");
  });

  it("shows a delivery source bin not_found refusal on the source bin field", () => {
    const missing = deliveryReferenceNotFound(["storageLocationId"], "Source bin");
    try {
      throwActionError({ success: false, error: missing.message, code: missing.code, issues: missing.issues });
    } catch (error) {
      expect(planSaveRefusal(error, everything)).toEqual({
        fieldErrors: [{ field: "storageLocationId", message: "Source bin was not found.", locked: false }],
        footer: null,
      });
      return;
    }
    expect.fail("Expected the action refusal to throw");
  });
});
