/** Records and lab work: sample vial, computed estimate, file upload, pasted text, envelope. */

import { Dots, IllustrationFrame, VERTEX_RADIUS, type IllustrationProps } from "./illustration-frame";

/** Sample vial: a jar of biochar beside a small tube. */
const VIAL_JAR = "M28 14 V32 Q28 35 31 35 H39 Q42 35 42 32 V14";
const VIAL_LID = "M26 8 H44 V14 H26 Z";
const VIAL_LEVEL = "M28 22 H42";
const VIAL_GRAINS = [[32, 27], [36, 26], [39, 29], [33, 31], [37, 32]] as const;
const VIAL_TUBE = "M11 12 V31 A3 3 0 0 0 17 31 V12";
const VIAL_TUBE_CAP = "M10 8 H18 V12 H10 Z";
const VIAL_TUBE_LEVEL = "M11 22 H17";

export function SampleVialArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <path d={VIAL_JAR} />
      <path d={VIAL_LID} />
      <path d={VIAL_LEVEL} />
      <Dots points={VIAL_GRAINS} />
      <path d={VIAL_TUBE} />
      <path d={VIAL_TUBE_CAP} />
      <path d={VIAL_TUBE_LEVEL} />
    </IllustrationFrame>
  );
}

/** Computed estimate: axes and a curve through three computed points. */
const ESTIMATE_AXES = "M8 5 V34 H50";
const ESTIMATE_CURVE = "M11 30 C19 30 21 13 31 13 S42 11 48 9";
const ESTIMATE_POINTS = [[11, 30], [31, 13], [48, 9]] as const;

export function ComputedEstimateArt(props: IllustrationProps) {
  return (
    <IllustrationFrame {...props}>
      <path d={ESTIMATE_AXES} />
      <path d={ESTIMATE_CURVE} />
      <Dots points={ESTIMATE_POINTS} radius={VERTEX_RADIUS} />
    </IllustrationFrame>
  );
}

/** File upload: a sheet with a folded corner and an arrow leaving it upward. */
const SHEET = "M14 4 H32 L42 14 V36 H14 Z";
const SHEET_FOLD = "M32 4 V14 H42";
const UPLOAD_ARROW = "M28 31 V20 M23 25 L28 20 L33 25";

export function FileUploadArt(props: IllustrationProps) {
  return (
    <IllustrationFrame {...props}>
      <path d={SHEET} />
      <path d={SHEET_FOLD} />
      <path d={UPLOAD_ARROW} />
    </IllustrationFrame>
  );
}

/** Pasted text: a clipboard with lines of text. */
const CLIPBOARD_BOARD = "M22 6 H14 V36 H42 V6 H34";
const CLIPBOARD_CLIP = { x: 22, y: 3, width: 12, height: 6, rx: 1.5 } as const;
const CLIPBOARD_LINES = "M19 17 H37 M19 23 H37 M19 29 H30";

export function PasteTextArt(props: IllustrationProps) {
  return (
    <IllustrationFrame {...props}>
      <path d={CLIPBOARD_BOARD} />
      <rect {...CLIPBOARD_CLIP} />
      <path d={CLIPBOARD_LINES} />
    </IllustrationFrame>
  );
}

/** Envelope: a letter tucked in, its flap closed. */
const ENVELOPE_LETTER = "M14 14 V7 H42 V14";
const ENVELOPE_BODY = "M8 14 H48 V34 H8 Z";
const ENVELOPE_FLAP = "M8 14 L28 27 L48 14";
const ENVELOPE_FOLDS = "M8 34 L21 23.5 M48 34 L35 23.5";

export function EnvelopeArt(props: IllustrationProps) {
  return (
    <IllustrationFrame {...props}>
      <path d={ENVELOPE_LETTER} />
      <path d={ENVELOPE_BODY} />
      <path d={ENVELOPE_FLAP} />
      <path d={ENVELOPE_FOLDS} />
    </IllustrationFrame>
  );
}
