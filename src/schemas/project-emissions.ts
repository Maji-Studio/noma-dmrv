import { z } from "zod";
import { emptyToNull, requiredNumber } from "@/schemas/helpers";

// Six canonical LCA emission categories (ADR 0005). Mirrors the
// `project_emission_category` pgEnum in `src/db/schema/common.ts` exactly —
// keep these in sync or migrations + Zod validation will diverge. Each
// pins to one Isometric blueprint via CATEGORY_TO_BLUEPRINT in
// `src/lib/isometric/utils/project-emission-match.ts`.
export const projectEmissionCategoryValues = [
  "staff_travel",
  "pyrolyzer_direct",
  "biochar_storage_fuel",
  "miscellaneous",
  "lab_electricity",
  "sampling_consumables",
] as const;

export type ProjectEmissionCategory =
  (typeof projectEmissionCategoryValues)[number];

// Allocation-strategy recommendations surfaced to the operator (informational
// copy they paste into the Isometric UI). The default is `CUSTOM_TIME_PERIOD`
// because LCAs are bounded windows; the other strategies are operator
// overrides per ADR 0005 §2.
export const projectEmissionAllocationStrategies = [
  "CUSTOM_TIME_PERIOD",
  "ESTIMATED_PROJECT_TONNAGE",
  "ESTIMATED_PROJECT_LIFETIME",
  "MANUAL",
] as const;

export type ProjectEmissionAllocationStrategy =
  (typeof projectEmissionAllocationStrategies)[number];

// Rejects shapes that pass the regex but are not real calendar dates
// (e.g. 2026-02-31). The Date round-trip ensures month/day in range and
// catches non-leap Feb-29 — otherwise superRefine could compare two
// "valid-looking" strings that don't denote actual days.
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "Not a valid calendar date");

// Base shape shared between create + update — extracted so the two variants
// stay in lockstep per CLAUDE.md.
const projectEmissionBaseSchema = z
  .object({
    facilityId: z.string().uuid("Select a facility"),
    category: z.enum(projectEmissionCategoryValues, {
      error: "Pick a category",
    }),
    lcaWindowStartOn: dateString,
    lcaWindowEndOn: dateString,
    magnitude: requiredNumber("Magnitude is required").pipe(
      z.number().min(0, "Magnitude must be non-negative"),
    ),
    unit: z.string().min(1, "Unit is required"),
    allocationStrategyRecommendation: z
      .enum(projectEmissionAllocationStrategies)
      .default("CUSTOM_TIME_PERIOD"),
    sourceDocumentId: emptyToNull
      .or(z.string().uuid())
      .nullable()
      .optional(),
    notes: emptyToNull.or(z.string()).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.lcaWindowStartOn > value.lcaWindowEndOn) {
      ctx.addIssue({
        code: "custom",
        path: ["lcaWindowEndOn"],
        message: "Window end must be on or after window start",
      });
    }
  });

export const createProjectEmissionSchema = projectEmissionBaseSchema;
export type CreateProjectEmissionInput = z.infer<
  typeof createProjectEmissionSchema
>;

// `expectedUpdatedAt` powers the optimistic-concurrency check in
// `updateProjectEmission` — the form passes the `updatedAt` value it loaded
// so a concurrent edit by another admin fails loud instead of silently
// clobbering the first edit. Optional (legacy callers).
export const updateProjectEmissionSchema = z.intersection(
  z.object({
    id: z.string().uuid(),
    expectedUpdatedAt: z.coerce.date().optional(),
  }),
  projectEmissionBaseSchema,
);
export type UpdateProjectEmissionInput = z.infer<
  typeof updateProjectEmissionSchema
>;

export const deleteProjectEmissionSchema = z.object({
  id: z.string().uuid(),
});
export type DeleteProjectEmissionInput = z.infer<
  typeof deleteProjectEmissionSchema
>;

export type ProjectEmissionFormData = z.infer<
  typeof projectEmissionBaseSchema
>;
