import { expect, it } from "vitest";
import { emissionDeliveryShares } from "./emission-delivery-shares";
import type { CreditBatchLineageFacts } from "@/data-access/credit-batch-lineage-types";
it("returns each delivery once, combines distinct run shares and ignores duplicate coordinates", () => {
  const share = (mass: number) => ({ id: "delivery", wetMassKg: mass });
  const forwards = {
    run1: [{ id: "product", deliveries: [share(0.1), share(0.1)] }],
    run2: [{ id: "product", deliveries: [share(0.2)] }],
  } as unknown as CreditBatchLineageFacts["runForwards"];
  expect(emissionDeliveryShares(forwards)).toMatchObject([{ id: "delivery", exactWetMassKg: "0.3" }]);
});
it("does not hide a missing share behind another run's load", () => {
  const forwards = {
    run: [
      { id: "a", deliveries: [{ id: "delivery", wetMassKg: null }] },
      { id: "b", deliveries: [{ id: "delivery", wetMassKg: 10 }] },
    ],
  } as unknown as CreditBatchLineageFacts["runForwards"];
  expect(emissionDeliveryShares(forwards)[0].exactWetMassKg).toBeNull();
});
