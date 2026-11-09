// The draft keeps its registry references, so it cannot be rebuilt from changed
// data without duplicating what was already sent. Delete Removal removes what
// reached Isometric (including unconfirmed sends), then the operator starts
// again from current data (#1114).
export const INTERRUPTED_REMOVAL_DRIFT_MESSAGE =
  "This Removal stopped after part of it reached Isometric, and its data or settings changed since you reviewed it. Select Delete Removal to remove what reached Isometric, then create the Removal again.";
