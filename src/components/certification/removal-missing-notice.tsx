"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { usePrepareRemovalResend, useRemovalRegistryPresence } from "@/hooks/use-removal-resend";

export const MISSING_IN_ISOMETRIC_TITLE = "Missing in Isometric";
export const MISSING_IN_ISOMETRIC_BODY = "Send again submits today's records as a new version.";
export const SEND_AGAIN_LABEL = "Send again";

/**
 * Admin only, for a Sent Removal: asks the registry once and says so only when it confirms the
 * record is gone. Present and unknown show nothing, so a slow or failed check never raises an alarm.
 * Send again retires the missing version, then opens the same review the first submission used.
 */
export function RemovalMissingNotice({ facilityId, removalId, reviewHref }: { facilityId: string; removalId: string; reviewHref: string }) {
  const router = useRouter();
  const presence = useRemovalRegistryPresence(facilityId, removalId, true);
  const prepare = usePrepareRemovalResend();
  // mutateAsync, not mutate's callbacks: the refreshed status can unmount this notice before they run.
  const send = async () => {
    try {
      await prepare.mutateAsync({ facilityId, removalId });
      router.push(reviewHref);
    } catch {
      // The failure shows inline from prepare.error.
    }
  };
  if (presence.data !== "missing") return null;
  return (
    <>
    <Notice
      tone="warning"
      title={MISSING_IN_ISOMETRIC_TITLE}
      data-removal-missing-in-registry=""
      action={(
        <Button
          variant="weak"
          size="small"
          className={INLINE_HIT_AREA}
          // Busy until the review is on screen, so a second press cannot start another attempt.
          busy={prepare.isPending || prepare.isSuccess}
          onClick={() => void send()}
        >
          {SEND_AGAIN_LABEL}
        </Button>
      )}
    >
      {MISSING_IN_ISOMETRIC_BODY}
    </Notice>
    {prepare.error instanceof Error && <Notice tone="error">{prepare.error.message}</Notice>}
    </>
  );
}
