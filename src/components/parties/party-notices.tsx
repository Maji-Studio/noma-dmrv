/**
 * Supplier and customer wording for the shared lifecycle notices: the archived
 * banner says what an archived party can no longer be used for.
 */
"use client";

import { ArchivedRecordNotice } from "@/components/ui/lifecycle-notices";

interface ArchivedPartyNoticeProps {
  onRestore: () => void;
  isPending: boolean;
}

export function ArchivedSupplierNotice(props: ArchivedPartyNoticeProps) {
  return (
    <ArchivedRecordNotice {...props}>
      This supplier is archived. Pickers hide it and new intakes cannot use it.
    </ArchivedRecordNotice>
  );
}

export function ArchivedCustomerNotice(props: ArchivedPartyNoticeProps) {
  return (
    <ArchivedRecordNotice {...props}>
      This customer is archived. Pickers hide it and new orders and deliveries cannot use it.
    </ArchivedRecordNotice>
  );
}
