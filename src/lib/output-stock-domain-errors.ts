import { OutputStockShortageError, StockBasisChangedError } from "@/data-access/output-stock-errors";
import { StockOverdrawError } from "@/data-access/stock-overdraw-error";
import { DomainError } from "@/lib/domain-errors";
import { ActionConflictError, SafeError } from "@/lib/errors";
import type { OutputStockShortage } from "@/lib/output-stock";

type Path = (string | number)[];
type Pointer<T> = Path | ((detail: T) => Path);
type StockOverdrawDetails = NonNullable<StockOverdrawError["details"]>;

const DEFAULT_SHORTAGE_PATH: Path = ["wetMassKg"];
const DEFAULT_INGREDIENT_PATH: Path = ["ingredients"];
/** An ingredient bin keeps wet stock: its shortage is in wet kilograms, never solids. */
const INGREDIENT_MEASURE = "ingredient_wet_stock";

export interface OutputStockErrorPaths {
  /** Where an output-bin shortage points. A function can point a short sub-bin at its `sources` entry. */
  shortage?: Pointer<OutputStockShortage>;
  /** Where an ingredient-bin overdraw points. A function can point the bin at its `ingredients` entry. */
  ingredient?: Pointer<StockOverdrawDetails>;
  /** Where any other guard refusal points; none when omitted. */
  validation?: Path;
}

function pointer<T>(target: Pointer<T> | undefined, fallback: Path, detail: T): Path {
  if (!target) return fallback;
  return typeof target === "function" ? target(detail) : target;
}

/**
 * Output-stock and product guards as typed outcomes across the runner
 * boundary, like `withProductionRunErrors`. A stale stock basis becomes
 * `stock_basis_changed` (bin `conflict` kept; the adapter adds `preview`);
 * planner and ingredient shortages become `insufficient_stock` with solids or
 * wet kilograms as issue metadata, and a `measure` naming which: dry biochar
 * (biochar bin), total solids (product bin) or ingredient wet stock. Certification-lineage refusals arrive
 * already typed: call sites wrap `assertCanMutateCertifiedLineage` in
 * `withFeedstockErrors(..., "certification_locked")`, as 4a does, and a
 * `DomainError` passes through unchanged.
 */
export async function withOutputStockErrors<T>(work: () => Promise<T>, paths: OutputStockErrorPaths = {}): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (error instanceof StockBasisChangedError) {
      throw new DomainError("stock_basis_changed", error.message, { conflict: error.conflict, blockers: error.blockers });
    }
    if (error instanceof OutputStockShortageError) {
      throw new DomainError("insufficient_stock", error.message, {
        issues: [{ path: pointer(paths.shortage, DEFAULT_SHORTAGE_PATH, error.details), code: "insufficient_stock", message: error.message,
          meta: { ...error.details, unit: "kg" } }],
      });
    }
    if (error instanceof StockOverdrawError && error.details) {
      throw new DomainError("insufficient_stock", error.message, {
        issues: [{ path: pointer(paths.ingredient, DEFAULT_INGREDIENT_PATH, error.details), code: "insufficient_stock", message: error.message,
          meta: { ...error.details, measure: INGREDIENT_MEASURE, unit: "kg" } }],
      });
    }
    if (error instanceof ActionConflictError) {
      throw new DomainError("conflict", error.message, { conflict: error.conflict, blockers: error.blockers });
    }
    if (error instanceof SafeError) {
      const failure = new DomainError("validation_failed", error.message, {
        issues: paths.validation ? [{ path: paths.validation, code: "validation_failed", message: error.message }] : undefined,
      });
      // The guard already normalized this operator message through SafeError.
      failure.message = error.message;
      throw failure;
    }
    throw error;
  }
}
