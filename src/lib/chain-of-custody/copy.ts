/** Shown when a credit batch has no member production runs to trace. */
export const EMPTY_CREDIT_BATCH_WARNING =
  "This credit batch has no member production runs yet.";

/** Shown when a credit batch has runs but nothing applied yet. */
export const NO_APPLICATION_YET_WARNING =
  "No application in this credit batch yet. The roll-up stops where the biochar is now.";

/** Run filter: the selected run has nothing applied, even if others do. */
export const NO_RUN_APPLICATION_YET_WARNING =
  "Nothing from this production run is applied yet. The roll-up stops where the biochar is now.";

/** Sankey empty state, under a title that says nothing is applied. */
export const SANKEY_EMPTY_DESCRIPTION =
  "The mass balance starts once biochar is applied on a field.";

/** Sankey empty state when applications exist but no mass is recorded on them. */
export const SANKEY_NO_DRY_MASS_DESCRIPTION =
  "Enter the dry masses on the production runs and applications to see the mass balance.";

/** Sankey empty state when the Run filter leaves no application. */
export const SANKEY_RUN_EMPTY_DESCRIPTION =
  "Pick another run or clear the Run filter to see the batch.";

/** Shown when the Run filter matches no lineage in the batch. */
export const NO_LINEAGE_FOR_SELECTED_RUN =
  "No lineage in this batch flows through the selected production run.";
