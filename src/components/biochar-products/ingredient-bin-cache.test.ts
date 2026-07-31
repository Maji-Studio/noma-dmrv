import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { seedEntityCache } from "@/components/forms/entity-select/cache-utils";
import type { EntityOption } from "@/components/forms/entity-select/types";
import { formatIngredientBinLabel } from "./ingredient-bin-field";

describe("ingredient-bin quick-add cache", () => {
  it("keeps canonical usage and stock context in the selected label", () => {
    const queryClient = new QueryClient();
    const created: EntityOption = {
      id: "storage-location-1",
      code: "FB-001",
      name: "Manure Bin",
      subtitle: "Feedstock bin · Manure (Blend) · 0 kg stored",
    };

    seedEntityCache(queryClient, "storageLocation", created);

    const selected = queryClient.getQueryData<EntityOption>([
      "entity",
      "storageLocation",
      created.id,
    ]);
    expect(selected).toEqual(created);
    expect(formatIngredientBinLabel(selected!)).toBe(
      "Manure Bin · Manure (Blend) · 0 kg stored",
    );
  });
});
