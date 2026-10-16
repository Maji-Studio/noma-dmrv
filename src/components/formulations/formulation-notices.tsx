/**
 * Formulation wording for the shared lifecycle notices: the archived banner
 * says what an archived formulation can no longer be used for.
 */
"use client";

import { ArchivedRecordNotice } from "@/components/ui/lifecycle-notices";

export function ArchivedFormulationNotice({
  onRestore,
  isPending,
}: {
  onRestore: () => void;
  isPending: boolean;
}) {
  return (
    <ArchivedRecordNotice onRestore={onRestore} isPending={isPending}>
      This formulation is archived. Pickers hide it and new products, orders and bins cannot use it.
    </ArchivedRecordNotice>
  );
}
