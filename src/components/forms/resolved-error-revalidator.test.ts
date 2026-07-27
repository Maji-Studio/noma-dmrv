import { zodResolver } from "@hookform/resolvers/zod";
import { createFormControl, type FieldErrors } from "react-hook-form";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { makeProductionRunFormSchema } from "@/schemas/production-runs";
import {
  getErrorFieldNames,
  revalidateResolvedErrors,
} from "./resolved-error-revalidator";

const FIXED_NOW = new Date("2026-07-26T12:00:00.000Z");

const productionRunSchema = makeProductionRunFormSchema(
  "Africa/Dar_es_Salaam",
  () => FIXED_NOW,
);
type ProductionRunInput = z.input<typeof productionRunSchema>;
type ProductionRunOutput = z.output<typeof productionRunSchema>;

const productionRunValues: ProductionRunInput = {
  facilityId: "11111111-1111-4111-8111-111111111111",
  reactorId: "22222222-2222-4222-8222-222222222222",
  status: "complete" as const,
  startDate: "2026-07-25",
  startTime: "08:00",
  endDate: "2026-07-26",
  endTime: "20:00",
  feedstockStorageLocationId: "33333333-3333-4333-8333-333333333333",
  feedstockWetMassKg: 3000,
  feedstockMoisturePercent: 15,
  biocharOutputKg: 1000,
  biocharMoisturePercent: 10,
};

describe("resolved error revalidation", () => {
  it("clears a cross-field error after a related field resolves it", async () => {
    const form = createFormControl<
      ProductionRunInput,
      unknown,
      ProductionRunOutput
    >({
      resolver: zodResolver(productionRunSchema),
      mode: "onTouched",
      defaultValues: productionRunValues,
    });
    const unsubscribe = form.subscribe({
      formState: { errors: true, values: true },
      callback: () => undefined,
    });

    for (const name of Object.keys(productionRunValues)) {
      form.register(name as keyof typeof productionRunValues);
    }

    await form.trigger();
    expect(form.getFieldState("endTime").error?.message).toBe(
      "End time cannot be in the future. Enter a time at or before now.",
    );

    form.setValue("endDate", "2026-07-25");
    await form.trigger("endDate");

    // React Hook Form only updates the changed field, so the valid form still
    // displays the old error attached to its related end-time field.
    expect(form.getFieldState("endTime").error?.message).toBe(
      "End time cannot be in the future. Enter a time at or before now.",
    );

    const errors: FieldErrors<ProductionRunInput> = {
      endTime: form.getFieldState("endTime").error,
    };
    await revalidateResolvedErrors(errors, form.trigger);

    expect(form.getFieldState("endTime").error).toBeUndefined();
    unsubscribe();
  });

  it("collects nested and array field paths without descending into error metadata", () => {
    expect(
      getErrorFieldNames({
        address: {
          latitude: { type: "custom", message: "Required" },
        },
        ingredients: [
          undefined,
          {
            sharePercent: { type: "custom", message: "Too large" },
          },
        ],
        serverControlled: {
          type: "server",
          message: "Still rejected by the server",
        },
        manuallyControlled: {
          type: "manual",
          message: "Requires explicit cleanup",
        },
      } as unknown as FieldErrors),
    ).toEqual(["address.latitude", "ingredients.1.sharePercent"]);
  });
});
