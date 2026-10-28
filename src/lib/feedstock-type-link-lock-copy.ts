import { joinWithAnd } from "@/lib/removal-correction-copy";
import { SENT_HOW_TO_FREE } from "@/lib/record-lock";

/** The reason a sent Removal fixes a saved Isometric link; the holding Removals follow it. */
export const ISOMETRIC_LINK_LOCKED_REASON =
  "The Isometric link can't be changed, because this feedstock type was sent to Isometric with";

/** The reason as the server refusal words it, so the sheet's note and the refusal agree. */
export function isometricLinkLockedMessage(removalCodes: readonly string[]): string {
  const removals = joinWithAnd(removalCodes.map((code) => `Removal ${code}`));
  return `${ISOMETRIC_LINK_LOCKED_REASON} ${removals}. ${SENT_HOW_TO_FREE}`;
}

/** Sent ends the note with the same how-to-free sentence the other Sent lock lines use. */
export const ISOMETRIC_LINK_LOCKED_HOW_TO_FREE = SENT_HOW_TO_FREE;
