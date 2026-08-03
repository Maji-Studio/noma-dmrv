import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useForm, type UseFormReturn } from "react-hook-form";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { IngredientBin } from "./types";
import {
  useBiocharComposition,
  type UseBiocharCompositionResult,
} from "./use-biochar-composition";

const mocks = vi.hoisted(() => ({
  formulation: {
    id: "formulation-1",
    biocharRatio: 0.7,
    ingredients: [
      {
        id: "line-1",
        feedstockTypeId: "feedstock-type-1",
        feedstockType: {
          id: "feedstock-type-1",
          name: "Live compost name",
          category: "live-category",
        },
        ratio: 0.4,
      },
      {
        id: "line-2",
        feedstockTypeId: "feedstock-type-2",
        feedstockType: {
          id: "feedstock-type-2",
          name: "New recipe line",
          category: "mineral",
        },
        ratio: 0.1,
      },
    ],
  },
}));

vi.mock("@/hooks/use-formulations", () => ({
  useFormulation: () => ({ data: mocks.formulation, isLoading: false }),
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

interface HarnessCapture {
  form: UseFormReturn<{ ingredientBins: IngredientBin[] }>;
  composition: UseBiocharCompositionResult;
}

const persistedRows: IngredientBin[] = [
  {
    formulationIngredientId: "line-1",
    feedstockTypeId: "feedstock-type-1",
    feedstockTypeName: "Recorded compost name",
    feedstockTypeCategory: "recorded-category",
    ratio: 0.2,
    storageLocationId: "bin-1",
    massKg: 25,
    massDryKg: 20,
    moistureContentPercent: 20,
  },
];

function Harness({
  allocationFrozen,
  onCapture,
}: {
  allocationFrozen: boolean;
  onCapture: (capture: HarnessCapture) => void;
}) {
  const form = useForm<{ ingredientBins: IngredientBin[] }>({
    defaultValues: { ingredientBins: persistedRows },
  });
  const composition = useBiocharComposition(form, {
    formulationId: "formulation-1",
    facilityId: "facility-1",
    productMassKg: 100,
    allocationFrozen,
  });

  useEffect(() => {
    onCapture({ form, composition });
  }, [composition, form, onCapture]);

  return null;
}

async function renderHarness(allocationFrozen: boolean) {
  let capture: HarnessCapture | undefined;
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <Harness
        allocationFrozen={allocationFrozen}
        onCapture={(next) => {
          capture = next;
        }}
      />,
    );
  });

  return {
    get capture() {
      if (!capture) throw new Error("Hook harness did not capture a result");
      return capture;
    },
    unmount: async () => {
      await act(async () => renderer?.unmount());
    },
  };
}

describe("useBiocharComposition", () => {
  it("keeps exact persisted ingredient rows and metadata while allocation is frozen", async () => {
    const harness = await renderHarness(true);

    expect(harness.capture.form.getValues("ingredientBins")).toEqual(
      persistedRows,
    );
    expect(harness.capture.composition.rows).toHaveLength(1);
    expect(harness.capture.composition.rows[0]).toMatchObject({
      formulationIngredientId: "line-1",
      feedstockTypeName: "Recorded compost name",
      feedstockTypeCategory: "recorded-category",
      ratio: 0.2,
    });

    await harness.unmount();
  });

  it("still reconciles saved rows against the live formulation while unfrozen", async () => {
    const harness = await renderHarness(false);

    expect(harness.capture.form.getValues("ingredientBins")).toEqual([
      {
        formulationIngredientId: "line-1",
        feedstockTypeId: "feedstock-type-1",
        feedstockTypeName: "Live compost name",
        feedstockTypeCategory: "live-category",
        ratio: 0.4,
        storageLocationId: "bin-1",
        massKg: 25,
        massDryKg: 20,
        moistureContentPercent: 20,
      },
      {
        formulationIngredientId: "line-2",
        feedstockTypeId: "feedstock-type-2",
        feedstockTypeName: "New recipe line",
        feedstockTypeCategory: "mineral",
        ratio: 0.1,
        storageLocationId: null,
        massKg: null,
        massDryKg: null,
        moistureContentPercent: null,
      },
    ]);

    await harness.unmount();
  });
});
