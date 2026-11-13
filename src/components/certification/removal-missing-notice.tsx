"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { usePrepareRemovalResend, useRemovalRegistryPresence } from "@/hooks/use-removal-resend";

export const MISSING_IN_ISOMETRIC_TITLE = "Missing in Isometric";
export const MISSING_IN_ISOMETRIC_BODY = "Send again submits today's records as a new version.";
/** Deliberate: the Removal was already sent, so this is a second send of it, not a resubmit or a first review. */
export const SEND_AGAIN_LABEL = "Send again";

interface ResendState {
  missing: boolean;
  busy: boolean;
  error: string | null;
  send: () => void;
}
const ResendContext = createContext<ResendState | null>(null);

function ActiveScope({ facilityId, removalId, reviewHref, children }: { facilityId: string; removalId: string; reviewHref: string; children: ReactNode }) {
  const router = useRouter();
  const presence = useRemovalRegistryPresence(facilityId, removalId, true);
  const prepare = usePrepareRemovalResend();
  // mutateAsync, not mutate's callbacks: the refreshed status can unmount the button before they run.
  const send = async () => {
    try {
      await prepare.mutateAsync({ facilityId, removalId });
      router.push(reviewHref);
    } catch {
      // The refusal shows from prepare.error.
    }
  };
  const state: ResendState = {
    missing: presence.data === "missing",
    // Busy until the review is on screen, so a second press cannot start another attempt.
    busy: prepare.isPending || prepare.isSuccess,
    error: prepare.error instanceof Error ? prepare.error.message : null,
    send: () => void send(),
  };
  return <ResendContext.Provider value={state}>{children}</ResendContext.Provider>;
}

/**
 * Admin only, for a Sent Removal: asks the registry once. Present and unknown show nothing, so a
 * slow or failed check never raises an alarm. Only a confirmed "missing" shows the notice and the
 * footer's Send again. With `enabled` off nothing is read and the children render as they are.
 */
export function RemovalResendScope({ enabled, ...props }: { enabled: boolean; facilityId: string; removalId: string; reviewHref: string; children: ReactNode }) {
  return enabled ? <ActiveScope {...props} /> : <>{props.children}</>;
}

/** The notice (no action, like the resubmit notice) and, apart from it, the refusal of the last Send again. */
export function RemovalMissingNotice() {
  const state = useContext(ResendContext);
  if (!state) return null;
  return (
    <>
      {state.missing && (
        <Notice tone="warning" title={MISSING_IN_ISOMETRIC_TITLE} data-removal-missing-in-registry="">
          {MISSING_IN_ISOMETRIC_BODY}
        </Notice>
      )}
      {/* Independent of the check: a refusal that says it is still in Isometric removes the notice but must stay readable. */}
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </>
  );
}

/** The sheet footer's primary button, only while the Removal is confirmed missing. */
export function SendAgainButton() {
  const state = useContext(ResendContext);
  if (!state?.missing) return null;
  return (
    <Button variant="primary" className={PHONE_TOUCH_TARGET} busy={state.busy} onClick={state.send}>
      {SEND_AGAIN_LABEL}
    </Button>
  );
}
