/**
 * FlowHeroDefs — the shared isometric line-art glyphs (bin, big-bag, truck,
 * heap), defined once in a zero-size SVG so both the desktop scene and the
 * mobile stacked fallback can reference them via <use>. Every stroke/fill
 * binds to currentColor so context tints the glyph (accent-ink triad).
 */

/** Scene surface — the warm page field, so the line art sits on the brand wash. */
export const SCENE_BG = "var(--bg)";

export function FlowHeroDefs() {
  return (
    <svg width={0} height={0} className="absolute" aria-hidden focusable="false">
      <defs>
        <g id="fh-bin">
          <path
            d="M-16,-34 L-16,-4 A16,8 0 0 0 16,-4 L16,-34 Z"
            fill="currentColor"
            fillOpacity=".07"
            stroke="none"
          />
          <path d="M-16,-34 L-16,-4 M16,-34 L16,-4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M-16,-4 A16,8 0 0 0 16,-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <ellipse cx="0" cy="-34" rx="16" ry="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <ellipse
            cx="0"
            cy="-34"
            rx="11"
            ry="5.5"
            fill="currentColor"
            fillOpacity=".18"
            stroke="currentColor"
            strokeWidth="1"
            strokeOpacity=".5"
          />
          <path
            d="M-16,-16 A16,8 0 0 0 16,-16"
            stroke="currentColor"
            strokeWidth="1"
            strokeOpacity=".35"
            fill="none"
          />
        </g>
        <g id="fh-bag">
          <path d="M-22,3 L30,-23" stroke="currentColor" strokeWidth="1" strokeOpacity=".35" />
          <path
            d="M0,0 L24,-12 C29,-20 29,-32 24,-38 Q12,-29 0,-26 C3,-18 3,-8 0,0 Z"
            fill="currentColor"
            fillOpacity=".06"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M0,0 L-18,-9 C-23,-17 -23,-29 -18,-35 Q-9,-27 0,-26 C3,-18 3,-8 0,0 Z"
            fill="currentColor"
            fillOpacity=".13"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M-18,-35 Q3,-45 24,-38" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <path d="M-1,-41 L-1,-47 M7,-42 L7,-48" stroke="currentColor" strokeWidth="1.2" />
          <path d="M-1,-47 Q3,-49 7,-48" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </g>
        <g id="fh-truck">
          <path
            d="M0,0 L50,-25 L50,-53 L0,-28 Z"
            fill="currentColor"
            fillOpacity=".06"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M0,0 L-18,-9 L-18,-37 L0,-28 Z"
            fill="currentColor"
            fillOpacity=".13"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M0,-28 L50,-53 L32,-62 L-18,-37 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M50,-25 L68,-34 L68,-46 L58,-52 L50,-53 Z"
            fill="currentColor"
            fillOpacity=".06"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M58,-38 L66,-42 L66,-47 L58,-43 Z"
            fill="currentColor"
            fillOpacity=".2"
            stroke="currentColor"
            strokeWidth="1"
          />
          <circle cx="10" cy="-1" r="4.5" fill={SCENE_BG} stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="-1" r="1.8" fill="currentColor" />
          <circle cx="38" cy="-15" r="4.5" fill={SCENE_BG} stroke="currentColor" strokeWidth="1.5" />
          <circle cx="38" cy="-15" r="1.8" fill="currentColor" />
          <circle cx="60" cy="-26" r="4.5" fill={SCENE_BG} stroke="currentColor" strokeWidth="1.5" />
          <circle cx="60" cy="-26" r="1.8" fill="currentColor" />
        </g>
        <g id="fh-heap">
          <path
            d="M0,0 L15,-23 L31,-16 L44,0 Z"
            fill="currentColor"
            fillOpacity=".1"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M12,-4 L24,-17 M22,-3 L33,-13 M32,-2 L40,-8"
            stroke="currentColor"
            strokeWidth="1"
            strokeOpacity=".5"
          />
        </g>
      </defs>
    </svg>
  );
}
