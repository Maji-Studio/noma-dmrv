import { featureEnabledSchema } from "@/config/feature-switches";
import { DomainError } from "@/lib/domain-errors";
import { productionRunValidationError } from "@/lib/production-run-domain-errors";

// Parse private variables directly without importing the full server environment.
// Browser bundles have no private variables and always read these switches off.
export function mcpEnabled(): boolean {
  return featureEnabledSchema.parse(process.env.MCP_ENABLED);
}

export function stockAdjustmentsEnabled(): boolean {
  return featureEnabledSchema.parse(process.env.STOCK_ADJUSTMENTS_ENABLED);
}

export function multiBinRunsEnabled(): boolean {
  return featureEnabledSchema.parse(process.env.MULTI_BIN_RUNS_ENABLED);
}

export function requireStockAdjustmentsEnabled(): void {
  if (!stockAdjustmentsEnabled()) {
    throw new DomainError("conflict", "Lost mass and stock counts are turned off on this server.");
  }
}

export function requireMultiBinRunsEnabled(): void {
  if (!multiBinRunsEnabled()) {
    throw productionRunValidationError(
      "Runs take feedstock from one bin. Several source bins are turned off on this server.",
      ["feedstockDraws"],
    );
  }
}
