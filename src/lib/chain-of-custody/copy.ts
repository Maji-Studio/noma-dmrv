/** Shown when a credit batch has no member production runs to trace. */
export const EMPTY_CREDIT_BATCH_WARNING =
  "This credit batch has no member production runs yet.";

/** Shown when a credit batch has runs but nothing applied yet. */
export const NO_APPLICATION_YET_WARNING =
  "No application in this credit batch yet. The roll-up stops where the biochar is now.";

/** Sankey: the mass balance runs to applications, so it needs at least one. */
export const NO_APPLICATION_SANKEY_MESSAGE =
  "Nothing is applied yet, so there is no mass balance to show. Open DAG or Map to see where the biochar is now.";

/** Shown when the Run filter matches no lineage in the batch. */
export const NO_LINEAGE_FOR_SELECTED_RUN =
  "No lineage in this batch flows through the selected production run.";
