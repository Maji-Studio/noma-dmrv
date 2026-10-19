import type { SoilTemperatureSource } from "@/schemas/applications";

export const FACILITY_REFERENCE_TEMPERATURE_NOTICE = "Submission uses the facility reference temperature.";
export const MIX_BIN_CREDIT_HOLD_NOTICE = "Not in a credit batch: this biochar was drawn from a mix bin. Mix-bin biochar is held out of credit batches until the project design document (PDD) covers mixing.";
/** The source used by the application's delivery-derived prefill. */
export const SOIL_TEMPERATURE_SOURCE_GLOBAL = "global_database" satisfies SoilTemperatureSource;
