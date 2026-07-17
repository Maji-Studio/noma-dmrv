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
        {/* FIBC big-bag — iso cube with softly bulged sides, top rhombus,
            four lifting loops and a tied neck. Origin = front bottom corner. */}
        <g id="fh-bag">
          <path
            d="M0,0 L16,-8 C19,-16 19,-27 16,-34 L0,-26 C1.5,-18 1.5,-8 0,0 Z"
            fill="currentColor"
            fillOpacity=".06"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M0,0 L-16,-8 C-19,-16 -19,-27 -16,-34 L0,-26 C1.5,-18 1.5,-8 0,0 Z"
            fill="currentColor"
            fillOpacity=".13"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M0,-26 L16,-34 L0,-42 L-16,-34 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8,-4 C10,-12 10,-24 8,-30 M-8,-4 C-10,-12 -10,-24 -8,-30"
            stroke="currentColor"
            strokeWidth="1"
            strokeOpacity=".35"
            fill="none"
          />
          <path
            d="M14,-34 Q16,-40 18,-34 M-14,-34 Q-16,-40 -18,-34 M-2,-42 Q0,-48 2,-42 M-2,-26 Q0,-32 2,-26"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <path
            d="M-2.5,-32 L-1.5,-38 M2.5,-32 L1.5,-38 M-1.5,-38 Q0,-40 1.5,-38"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
        </g>
        {/* Compact production facility — iso hall, roller door, chimney.
            Origin = front bottom corner (used by the mobile stack). */}
        <g id="fh-plant">
          <path
            d="M0,0 L44,-22 L44,-46 L0,-24 Z"
            fill="currentColor"
            fillOpacity=".06"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M0,0 L-20,-10 L-20,-34 L0,-24 Z"
            fill="currentColor"
            fillOpacity=".13"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M0,-24 L44,-46 L24,-56 L-20,-34 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10,-7 L26,-15 L26,-29 L10,-21 Z"
            fill="currentColor"
            fillOpacity=".08"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M18,-44 L18,-66 L26,-66 L26,-44" fill={SCENE_BG} stroke="currentColor" strokeWidth="1.5" />
          <ellipse
            cx="22"
            cy="-66"
            rx="4"
            ry="2"
            fill="currentColor"
            fillOpacity=".08"
            stroke="currentColor"
            strokeWidth="1.5"
          />
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
