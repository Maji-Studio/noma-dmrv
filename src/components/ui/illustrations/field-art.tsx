/** Where biochar is applied: a location pin, a field boundary, a photo of the field. */

import { Dots, IllustrationFrame, Motion, VERTEX_RADIUS, type IllustrationProps } from "./illustration-frame";

/** Location pin: a teardrop pin standing on a ripple. */
const PIN_BODY = "M28 30 C21 22 18 19 18 14 A10 10 0 0 1 38 14 C38 19 35 22 28 30 Z";
const PIN_HOLE = { cx: 28, cy: 14, r: 3.5 } as const;
const PIN_RIPPLE = { cx: 28, cy: 31.5, rx: 9, ry: 2.5 } as const;

export function LocationPinArt(props: IllustrationProps) {
  return (
    <IllustrationFrame {...props}>
      <Motion kind="pop" largeOnly>
        <ellipse {...PIN_RIPPLE} />
      </Motion>
      <Motion kind="bob">
        <path d={PIN_BODY} />
        <circle {...PIN_HOLE} />
      </Motion>
    </IllustrationFrame>
  );
}

/** Field boundary: an irregular polygon with a dot at each corner and furrows inside. */
const BOUNDARY_CORNERS = [[8, 26], [14, 9], [36, 6], [49, 18], [42, 33], [18, 34]] as const;
const BOUNDARY_OUTLINE = `M${BOUNDARY_CORNERS.map(([x, y]) => `${x} ${y}`).join(" L")} Z`;
const BOUNDARY_FURROWS = "M17 16 L41 14 M14 23 L44 22 M19 29 L40 29";
const BOUNDARY_FURROW_OPACITY = 0.5;
/** Corner dots pop one after another, walking the boundary. */
const BOUNDARY_CORNER_STAGGER = 120;

export function FieldBoundaryArt(props: IllustrationProps) {
  return (
    <IllustrationFrame {...props}>
      <path d={BOUNDARY_FURROWS} opacity={BOUNDARY_FURROW_OPACITY} />
      <Motion kind="draw" largeOnly>
        <path d={BOUNDARY_OUTLINE} pathLength={1} />
      </Motion>
      {BOUNDARY_CORNERS.map((corner, index) => (
        <Motion key={corner.join("-")} kind="pop" delay={index * BOUNDARY_CORNER_STAGGER}>
          <Dots points={[corner]} radius={VERTEX_RADIUS} />
        </Motion>
      ))}
    </IllustrationFrame>
  );
}

/** Photo evidence: a camera, its lens showing a hill under a small sun. */
const CAMERA_BODY = "M8 13 H19 L22 8 H34 L37 13 H48 V34 H8 Z";
const CAMERA_LENS = { cx: 28, cy: 23.5, r: 7.5 } as const;
const CAMERA_HILLS = "M23 27 L26.5 23 L28.5 25 L30.5 22.5 L33 27";
const CAMERA_SUN = [[25.5, 19.5]] as const;
const CAMERA_SUN_RADIUS = 1.1;
const CAMERA_FLASH = [[43, 18]] as const;

export function PhotoEvidenceArt(props: IllustrationProps) {
  return (
    <IllustrationFrame {...props}>
      <path d={CAMERA_BODY} />
      <circle {...CAMERA_LENS} />
      <path d={CAMERA_HILLS} />
      <Motion kind="bob" largeOnly>
        <Dots points={CAMERA_SUN} radius={CAMERA_SUN_RADIUS} />
      </Motion>
      <Motion kind="pop">
        <Dots points={CAMERA_FLASH} />
      </Motion>
    </IllustrationFrame>
  );
}
