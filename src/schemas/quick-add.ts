/**
 * Quick Add Validation Schemas
 *
 * Server action input schemas for inline quick-add entity creation.
 * Form-level validation now uses canonical schemas from each entity's schema file.
 * This file defines the server action wire format (which may differ from the form shape).
 */

import { z } from "zod";
import {
  emptyToNull,
  gpsPairSuperRefine,
  positiveMassKgSchema,
  requiredLatitudeSchema,
  requiredLongitudeSchema,
  toNumberOrUndefined,
} from "./helpers";
import {
  storageLocationTypes,
  type StorageLocationType,
  formatStorageLocationType,
  isFeedstockBinType,
} from "./storage-locations";

// ============================================
// Driver Quick Add Schema
// ============================================

export {
  driverFormSchema as driverQuickAddSchema,
  type DriverFormData as DriverQuickAddData,
} from "./drivers";

// ============================================
// Operator Quick Add Schema
// ============================================

export {
  operatorFormSchema as operatorQuickAddSchema,
  type OperatorFormData as OperatorQuickAddData,
} from "./operators";

// ============================================
// Vehicle Quick Add Schema
// Server action expects fuelConsumptionLPerKm (L/km),
// while the form uses L/100km — dialog handler converts.
// ============================================

export const vehicleQuickAddSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Vehicle name is required")
    .max(255, "Vehicle name must be less than 255 characters"),
  identifier: z
    .string()
    .max(50, "Identifier must be less than 50 characters")
    .nullish(),
  vehicleType: z
    .string()
    .min(1, "Vehicle type is required")
    .max(50, "Vehicle type must be less than 50 characters"),
  fuelType: z
    .string()
    .max(50, "Fuel type must be less than 50 characters")
    .nullish(),
  fuelConsumptionLPerKm: z
    .number()
    .nonnegative("Fuel consumption must be zero or positive")
    .max(10, "Fuel consumption seems too high")
    .nullish(),
  modelYear: z
    .number()
    .int("Model year must be a whole number")
    .min(1900, "Model year must be 1900 or later")
    .max(new Date().getFullYear() + 1, "Model year cannot be in the future")
    .nullish(),
});

export type VehicleQuickAddData = z.infer<typeof vehicleQuickAddSchema>;

// ============================================
// Supplier Quick Add Schema
// ============================================

export const supplierQuickAddSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Supplier name is required")
      .max(255, "Supplier name must be less than 255 characters"),
    country: z
      .string()
      .trim()
      .min(1, "Country is required")
      .max(100, "Country must be less than 100 characters"),
    gpsLatitude: z.preprocess(
      toNumberOrUndefined,
      requiredLatitudeSchema,
    ),
    gpsLongitude: z.preprocess(
      toNumberOrUndefined,
      requiredLongitudeSchema,
    ),
  })
  .superRefine(gpsPairSuperRefine);

export type SupplierQuickAddData = z.infer<typeof supplierQuickAddSchema>;
export type SupplierQuickAddInput = z.input<typeof supplierQuickAddSchema>;

// ============================================
// Feedstock Type Quick Add Schema
// ============================================

export {
  feedstockTypeFormSchema as feedstockTypeQuickAddSchema,
  feedstockCategories,
  type FeedstockCategory,
  FEEDSTOCK_CATEGORY_OPTIONS,
  type FeedstockTypeFormData as FeedstockTypeQuickAddData,
} from "./feedstock-types";

// ============================================
// Storage Location Quick Add Schema
// Server action expects a flat subset of StorageLocationFormData.
// ============================================

const FORMULATION_PRODUCT_BIN_MESSAGE =
  "A formulation can only be assigned to a product bin";

const FEEDSTOCK_TYPE_REQUIRED_MESSAGE =
  "Feedstock bins must be restricted to one feedstock type";

const FEEDSTOCK_TYPE_FEEDSTOCK_BIN_MESSAGE =
  "A feedstock type can only be assigned to a feedstock bin";

export const storageLocationQuickAddSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Bin name is required")
    .max(255, "Name must be less than 255 characters"),
  type: z.enum(storageLocationTypes, { message: "Bin type is required" }),
  facilityId: z
    .string()
    .uuid("Choose a valid facility."),
  capacityKg: positiveMassKgSchema("Capacity must be positive")
    .optional()
    .nullable(),
  // Feedstock bins only — restricts the bin to one feedstock type
  feedstockTypeId: emptyToNull.or(z.string().uuid("Choose a valid feedstock type.")).nullable().optional(),
  // Product bins only — restricts the bin to one formulation (empty = pure biochar)
  formulationId: emptyToNull.or(z.string().uuid("Choose a valid formulation.")).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.formulationId && data.type !== "product_bin") {
    ctx.addIssue({
      code: "custom",
      path: ["formulationId"],
      message: FORMULATION_PRODUCT_BIN_MESSAGE,
    });
  }
  if (isFeedstockBinType(data.type) && !data.feedstockTypeId) {
    ctx.addIssue({
      code: "custom",
      path: ["feedstockTypeId"],
      message: FEEDSTOCK_TYPE_REQUIRED_MESSAGE,
    });
  }
  if (!isFeedstockBinType(data.type) && data.feedstockTypeId) {
    ctx.addIssue({
      code: "custom",
      path: ["feedstockTypeId"],
      message: FEEDSTOCK_TYPE_FEEDSTOCK_BIN_MESSAGE,
    });
  }
});

export type StorageLocationQuickAddData = z.infer<typeof storageLocationQuickAddSchema>;

export { storageLocationTypes, type StorageLocationType as StorageLocationTypeOption };

export const STORAGE_LOCATION_TYPE_OPTIONS = storageLocationTypes.map((type) => ({
  value: type,
  label: formatStorageLocationType(type),
}));
