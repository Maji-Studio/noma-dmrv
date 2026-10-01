/**
 * The records along the chain that have no place or machine of their own:
 * customers, suppliers, feedstock, orders, biochar products, credit batches,
 * members. Flat front view, same grid and stroke as the rest of the set.
 */

import { Dots, IllustrationFrame, Motion, type IllustrationProps } from "./illustration-frame";

/** Customer: a farm, a barn beside a tree. */
const BARN_BODY = "M9 35 V20 L19 11 L29 20 V35";
const BARN_DOOR = "M15 35 V27 H23 V35 M15 27 L23 35";
const BARN_LOFT = "M17.5 16.5 H20.5 V19.5 H17.5 Z";
const FARM_TREE_TRUNK = "M42 35 V27";
const FARM_TREE_CROWN = { cx: 42, cy: 20.5, r: 6.5 } as const;

export function CustomerArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <path d={BARN_BODY} />
      <path d={BARN_DOOR} />
      <path d={BARN_LOFT} />
      <Motion kind="sway">
        <path d={FARM_TREE_TRUNK} />
        <circle {...FARM_TREE_CROWN} />
      </Motion>
    </IllustrationFrame>
  );
}

/** Supplier: where feedstock comes from, two tiered pines. */
const PINE_TALL = "M21 5 L27 14 H24 L29.5 22 H26 L31 30 H11 L16 22 H12.5 L18 14 H15 Z";
const PINE_TALL_TRUNK = "M21 30 V35";
const PINE_SHORT = "M41 13 L45.5 19.5 H43.5 L47.5 25 H45 L49 30 H33 L37 25 H34.5 L38.5 19.5 H36.5 Z";
const PINE_SHORT_TRUNK = "M41 30 V35";
/** The short pine sways out of step with the tall one. */
const PINE_STAGGER = 350;

export function SupplierArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <Motion kind="sway">
        <path d={PINE_TALL} />
        <path d={PINE_TALL_TRUNK} />
      </Motion>
      <Motion kind="sway" delay={PINE_STAGGER} largeOnly>
        <path d={PINE_SHORT} />
        <path d={PINE_SHORT_TRUNK} />
      </Motion>
    </IllustrationFrame>
  );
}

/** Feedstock: a stack of logs seen end on, three, two, one. */
const LOG_RADIUS = 5;
const LOG_CORE_RADIUS = 1.1;
const LOGS_BOTTOM = [[18, 30], [28, 30], [38, 30]] as const;
const LOGS_MIDDLE = [[23, 21.34], [33, 21.34]] as const;
const LOG_TOP = [28, 12.68] as const;
/** The middle row lands, then the top log. */
const LOG_TOP_DELAY = 250;

function Logs({ centres }: { centres: readonly (readonly [number, number])[] }) {
  return (
    <>
      {centres.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={LOG_RADIUS} />
      ))}
      <Dots points={centres} radius={LOG_CORE_RADIUS} />
    </>
  );
}

export function FeedstockArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <Logs centres={LOGS_BOTTOM} />
      <Motion kind="drop" largeOnly>
        <Logs centres={LOGS_MIDDLE} />
      </Motion>
      <Motion kind="drop" delay={LOG_TOP_DELAY}>
        <Logs centres={[LOG_TOP]} />
      </Motion>
    </IllustrationFrame>
  );
}

/** Order: a receipt with a torn edge, item lines with their amounts, and a total. */
const RECEIPT = "M16 4 H40 V34 L37 36 L34 34 L31 36 L28 34 L25 36 L22 34 L19 36 L16 34 Z";
const RECEIPT_ITEMS = ["M21 11 H30 M33 11 H35", "M21 17 H30 M33 17 H35", "M21 23 H27 M33 23 H35"] as const;
const RECEIPT_TOTAL = "M28 29 H35";
/** Items are written in one after another, then the total. */
const RECEIPT_LINE_STAGGER = 160;

export function OrderArt(props: IllustrationProps) {
  return (
    <IllustrationFrame {...props}>
      <path d={RECEIPT} />
      {RECEIPT_ITEMS.map((item, index) => (
        <Motion key={item} kind="draw" delay={index * RECEIPT_LINE_STAGGER} largeOnly={index > 0}>
          <path d={item} pathLength={1} />
        </Motion>
      ))}
      <Motion kind="draw" delay={RECEIPT_ITEMS.length * RECEIPT_LINE_STAGGER} largeOnly>
        <path d={RECEIPT_TOTAL} pathLength={1} />
      </Motion>
    </IllustrationFrame>
  );
}

/** Biochar product: a bulk bag on its lifting loops, filled with biochar. */
const BAG_BODY = "M13 14 V33 Q13 35 15 35 H41 Q43 35 43 33 V14 Z";
const BAG_LOOPS = "M16 14 V9.5 Q16 7.5 18 7.5 Q20 7.5 20 9.5 V14 M36 14 V9.5 Q36 7.5 38 7.5 Q40 7.5 40 9.5 V14";
const BAG_LEVEL = "M13 20 H43";
const BAG_GRAINS = [[19, 25], [31, 25], [25, 28.5], [37, 28.5], [22, 32], [34, 32]] as const;
const BAG_GRAIN_STAGGER = 90;

export function BiocharProductArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <Motion kind="lift">
        <path d={BAG_BODY} />
        <path d={BAG_LOOPS} />
        <path d={BAG_LEVEL} />
        {BAG_GRAINS.map((grain, index) => (
          <Motion key={grain.join("-")} kind="drop" delay={index * BAG_GRAIN_STAGGER} largeOnly>
            <Dots points={[grain]} />
          </Motion>
        ))}
      </Motion>
    </IllustrationFrame>
  );
}

/** Credit batch: a certificate with lines of text and a seal on a notched ribbon. */
const CERTIFICATE = "M6 6 H50 V34 H6 Z";
const CERTIFICATE_LINES = ["M12 13 H30", "M12 19 H30", "M12 25 H24"] as const;
const SEAL = { cx: 40, cy: 19, r: 5.5 } as const;
const SEAL_CORE = { cx: 40, cy: 19, r: 2.5 } as const;
/** The ribbon meets the seal's rim at x 37 and 43. */
const SEAL_RIBBON = "M37 23.6 V30 L40 28 L43 30 V23.6";
const CERTIFICATE_LINE_STAGGER = 160;

export function CreditBatchArt(props: IllustrationProps) {
  return (
    <IllustrationFrame {...props}>
      <path d={CERTIFICATE} />
      {CERTIFICATE_LINES.map((line, index) => (
        <Motion key={line} kind="draw" delay={index * CERTIFICATE_LINE_STAGGER} largeOnly>
          <path d={line} pathLength={1} />
        </Motion>
      ))}
      <Motion kind="stamp" delay={CERTIFICATE_LINES.length * CERTIFICATE_LINE_STAGGER}>
        <circle {...SEAL} />
        <circle {...SEAL_CORE} />
        <path d={SEAL_RIBBON} />
      </Motion>
    </IllustrationFrame>
  );
}

/** Members: two people side by side, head and shoulders. */
const PERSON_FRONT_HEAD = { cx: 20, cy: 13, r: 5 } as const;
const PERSON_FRONT_BUST = "M11 35 V31 C11 25.5 15 22 20 22 C25 22 29 25.5 29 31 V35";
const PERSON_BACK_HEAD = { cx: 38, cy: 16.5, r: 4.2 } as const;
const PERSON_BACK_BUST = "M31 35 V32 C31 27.5 34 24.5 38 24.5 C42 24.5 45 27.5 45 32 V35";
/** The second person nods a beat after the first. */
const PERSON_STAGGER = 300;

export function MembersArt(props: IllustrationProps) {
  return (
    <IllustrationFrame {...props}>
      <Motion kind="bob">
        <circle {...PERSON_FRONT_HEAD} />
      </Motion>
      <path d={PERSON_FRONT_BUST} />
      <Motion kind="bob" delay={PERSON_STAGGER} largeOnly>
        <circle {...PERSON_BACK_HEAD} />
      </Motion>
      <path d={PERSON_BACK_BUST} />
    </IllustrationFrame>
  );
}
