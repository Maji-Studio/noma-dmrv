/**
 * Small monoline drawings for the stock mode cards (split / mix). Decorative:
 * ChoiceCardGroup hides the art slot from assistive tech. Phase 4 replaces
 * these with the shared illustration set.
 */

const ART_SIZE = { width: 44, height: 30 } as const;

const ART_PROPS = {
  ...ART_SIZE,
  viewBox: "0 0 48 32",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Three heaps kept apart by dashed dividers: every batch stays its own sub-bin. */
export function SplitPilesArt() {
  return (
    <svg {...ART_PROPS}>
      <path d="M3 28 H45" />
      <path d="M5 28 Q10.5 15 16 28" />
      <path d="M18 28 Q24 11 30 28" />
      <path d="M32 28 Q37.5 17 43 28" />
      <path d="M17 12 V26 M31 12 V26" strokeDasharray="1.5 2.5" strokeWidth={1.2} />
    </svg>
  );
}

/** One heap of blended grains: batches are drawn in proportion. */
export function MixPileArt() {
  return (
    <svg {...ART_PROPS}>
      <path d="M3 28 H45" />
      <path d="M6 28 Q24 1 42 28" />
      <circle cx="18" cy="22" r="1" fill="currentColor" stroke="none" />
      <circle cx="24" cy="17" r="1" fill="currentColor" stroke="none" />
      <circle cx="29" cy="23" r="1" fill="currentColor" stroke="none" />
      <circle cx="22" cy="25" r="1" fill="currentColor" stroke="none" />
      <circle cx="31" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
