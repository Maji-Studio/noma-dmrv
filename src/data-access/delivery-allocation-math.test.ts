import { describe, expect, it } from "vitest";
import { allocateApplicationShares, massGrams, splitGrams, type DeliveryRunShare } from "./delivery-allocation-math";

const truck: DeliveryRunShare[] = [
  { deliveryId: "truck", biocharProductId: "A", productionRunId: "shared", dryMassKg: 600, wetMassKg: 1047.62 },
  { deliveryId: "truck", biocharProductId: "A", productionRunId: "second", dryMassKg: 300, wetMassKg: 523.809 },
  { deliveryId: "truck", biocharProductId: "B", productionRunId: "shared", dryMassKg: 250, wetMassKg: 428.571 },
];

describe("saved truck application shares", () => {
  it("applies half the truck as A450 + B125 without erasing the shared run", () => {
    const result = allocateApplicationShares(truck, [], 1000, 575);
    expect(result.map(s => s.dryMassKg)).toEqual([300, 150, 125]);
    expect(result.reduce((n, s) => n + massGrams(s.wetMassKg), 0)).toBe(1_000_000);
    expect(result[2].wetMassKg).toBe(214.285);
    expect(result[0].productionRunId).toBe(result[2].productionRunId);
    expect(result[0].biocharProductId).not.toBe(result[2].biocharProductId);
  });

  it("closes every product/run gram after three partial applications and the final remainder", () => {
    const used: DeliveryRunShare[] = [];
    for (let i = 0; i < 3; i++) used.push(...allocateApplicationShares(truck, used, 333.333, 191.667));
    const wetRemaining = 2000 - used.reduce((n, s) => n + massGrams(s.wetMassKg), 0) / 1000;
    const dryRemaining = 1150 - used.reduce((n, s) => n + massGrams(s.dryMassKg), 0) / 1000;
    used.push(...allocateApplicationShares(truck, used, wetRemaining, dryRemaining));
    for (const source of truck) {
      const rows = used.filter(s => s.biocharProductId === source.biocharProductId && s.productionRunId === source.productionRunId);
      expect(rows.reduce((n, s) => n + massGrams(s.dryMassKg), 0)).toBe(massGrams(source.dryMassKg));
      expect(rows.reduce((n, s) => n + massGrams(s.wetMassKg), 0)).toBe(massGrams(source.wetMassKg));
    }
  });

  it("rejects a one-gram overdraft and invalid inputs", () => {
    expect(() => allocateApplicationShares(truck, [], 2000.001, 1150)).toThrow();
    expect(() => allocateApplicationShares(truck, [], 2000, 1150.001)).toThrow();
    expect(() => allocateApplicationShares(truck, [], NaN, 1)).toThrow();
    expect(() => splitGrams(1, [])).toThrow();
    expect(() => splitGrams(-1, [1])).toThrow();
  });

  it("splits measured wet shares by the saved solids composition, separately from dry", () => {
    expect(splitGrams(2_000_000, [1_100_000, 300_000])).toEqual([1_571_429, 428_571]);
    expect(splitGrams(1_150_000, [900_000, 250_000])).toEqual([900_000, 250_000]);
    expect(splitGrams(1_571_429, [600_000, 300_000])).toEqual([1_047_619, 523_810]);
  });
});

it("tracks cumulative quotas instead of starving B on repeated one-gram applications", () => {
  const saved: DeliveryRunShare[] = [
    { deliveryId: "D", biocharProductId: "A", productionRunId: "R", dryMassKg: 0.9, wetMassKg: 0.9 },
    { deliveryId: "D", biocharProductId: "B", productionRunId: "R", dryMassKg: 0.25, wetMassKg: 0.25 },
  ];
  const used: DeliveryRunShare[] = [];
  for (let i = 0; i < 575; i++) used.push(...allocateApplicationShares(saved, used, 0.001, 0.001));
  expect(used.filter(s => s.biocharProductId === "A").reduce((n, s) => n + massGrams(s.dryMassKg), 0)).toBe(450);
  expect(used.filter(s => s.biocharProductId === "B").reduce((n, s) => n + massGrams(s.dryMassKg), 0)).toBe(125);
});


it("uses the same monotone source entitlement regardless of database row order", () => {
  const saved: DeliveryRunShare[] = [
    { deliveryId: "D", biocharProductId: "A", productionRunId: "R", dryMassKg: 0.003, wetMassKg: 0.003 },
    { deliveryId: "D", biocharProductId: "B", productionRunId: "R", dryMassKg: 0.002, wetMassKg: 0.002 },
  ];
  const first = allocateApplicationShares(saved, [], 0.001, 0.001);
  const second = allocateApplicationShares([...saved].reverse(), first, 0.001, 0.001);
  expect(first.find(share => share.biocharProductId === "A")?.dryMassKg).toBe(0.001);
  expect(second.find(share => share.biocharProductId === "B")?.dryMassKg).toBe(0.001);
  const final = allocateApplicationShares(saved, [...first, ...second], 0.003, 0.003);
  for (const source of saved) {
    expect([...first, ...second, ...final].filter(share => share.biocharProductId === source.biocharProductId)
      .reduce((total, share) => total + massGrams(share.dryMassKg), 0)).toBe(massGrams(source.dryMassKg));
  }
});

it("fills only positive remaining entitlements after an earlier application is deleted", () => {
  const saved: DeliveryRunShare[] = [
    { deliveryId: "D", biocharProductId: "A", productionRunId: "R", dryMassKg: 0.003, wetMassKg: 0.003 },
    { deliveryId: "D", biocharProductId: "B", productionRunId: "R", dryMassKg: 0.002, wetMassKg: 0.002 },
  ];
  const preserved = [{ ...saved[1], dryMassKg: 0.002, wetMassKg: 0.002 }];
  const result = allocateApplicationShares(saved, preserved, 0.001, 0.001);
  expect(result.find(share => share.biocharProductId === "A")?.dryMassKg).toBe(0.001);
  expect(result.find(share => share.biocharProductId === "B")?.dryMassKg).toBe(0);
});
