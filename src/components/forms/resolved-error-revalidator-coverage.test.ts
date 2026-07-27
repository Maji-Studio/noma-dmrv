import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CROSS_FIELD_FORM_FILES = {
  "applications/application-form.tsx": 1,
  "auth/reset-password-form.tsx": 1,
  "auth/set-password-form.tsx": 1,
  "credit-batches/credit-batch-form.tsx": 1,
  "deliveries/delivery-form.tsx": 1,
  "facilities/facility-form.tsx": 1,
  "feedstock-types/feedstock-type-form.tsx": 1,
  "feedstocks/feedstock-form.tsx": 1,
  "formulations/formulation-form.tsx": 1,
  "production-runs/production-run-form.tsx": 1,
  "samples/sample-form.tsx": 1,
  "storage-locations/bin-reconcile-sheet.tsx": 2,
  "storage-locations/storage-location-form.tsx": 1,
} as const;

describe("cross-field form error-revalidation coverage", () => {
  it.each(Object.entries(CROSS_FIELD_FORM_FILES))(
    "covers every resolver form in %s",
    (relativePath, expectedCount) => {
      const source = readFileSync(
        resolve(process.cwd(), "src/components", relativePath),
        "utf8",
      );
      const resolverCount = source.match(/\bresolver\s*:/g)?.length ?? 0;
      const revalidatorCount =
        source.match(/<ResolvedErrorRevalidator\b/g)?.length ?? 0;

      expect(resolverCount).toBe(expectedCount);
      expect(revalidatorCount).toBe(expectedCount);
    },
  );
});
