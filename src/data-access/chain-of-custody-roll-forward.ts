/**
 * Chain of custody — run roll-forwards.
 *
 * The roll-up's application rollbacks only reach runs whose biochar has been
 * applied. A roll-forward starts at a member production run instead and walks
 * downstream to wherever its biochar is now: the product layers drawn from the
 * run, then the deliveries that shipped the run's share of those layers. It
 * stops at the last recorded step, so a credit batch is traceable before its
 * first application.
 *
 * Pure projection: the facts come from the consolidated roll-up loader
 * (`loadCreditBatchRollups(..., { includeRunForwards: true })`).
 */
import {
  CHAIN_HREFS,
  sourceLineageFromRunFact,
  type ChainBiocharProductLineage,
  type ChainDeliveryLineage,
  type ChainSourceLineage,
} from "./chain-of-custody";
import type { CreditBatchLineageFacts } from "./credit-batch-lineage-types";

export interface ChainRollForwardDelivery {
  delivery: ChainDeliveryLineage;
  /** This run's share of the shipped product layer (reversals netted). */
  wetMassKg: number | null;
  dryMassKg: number;
}

export interface ChainRollForwardProduct {
  product: ChainBiocharProductLineage;
  /** Biochar drawn from the run into this product, on both mass bases. */
  drawnWetMassKg: number;
  drawnDryMassKg: number;
  deliveries: ChainRollForwardDelivery[];
}

export interface ChainRunRollForward {
  /** The run's upstream block; its allocated masses stay null. */
  source: ChainSourceLineage;
  products: ChainRollForwardProduct[];
}

export function projectRunRollForwards(
  facts: CreditBatchLineageFacts,
): ChainRunRollForward[] {
  return facts.runs.map((run) => ({
    source: sourceLineageFromRunFact(run, null),
    products: (facts.runForwards?.[run.id] ?? []).map(
      ({ drawnWetMassKg, drawnDryMassKg, deliveries, ...product }) => ({
        product: {
          ...product,
          linkedProductionRunId: run.id,
          href: CHAIN_HREFS.biocharProduct,
        },
        drawnWetMassKg,
        drawnDryMassKg,
        deliveries: deliveries.map(({ wetMassKg, dryMassKg, ...delivery }) => ({
          delivery: { ...delivery, href: CHAIN_HREFS.delivery },
          wetMassKg,
          dryMassKg,
        })),
      }),
    ),
  }));
}
