import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { CENTRED_HIT_AREA } from "@/components/ui/touch-target";
import type { SheetReadOnly } from "@/lib/linked-record-read-only";
import { RECORD_LOCK_RETRY_LABEL } from "@/lib/record-lock-view";

/** The one boxed line a read-only record opens with: why it cannot change, and Try again when the facility check failed. */
export function ReadOnlyNotice({ readOnly }: { readOnly: SheetReadOnly }) {
  return (
    <Notice
      tone={readOnly.tone}
      boxed
      data-read-only-notice={readOnly.tone}
      action={readOnly.retry ? (
        <Button variant="default" size="small" className={CENTRED_HIT_AREA} busy={readOnly.retry.running} onClick={readOnly.retry.run}>
          {RECORD_LOCK_RETRY_LABEL}
        </Button>
      ) : undefined}
    >
      {readOnly.message}
    </Notice>
  );
}
