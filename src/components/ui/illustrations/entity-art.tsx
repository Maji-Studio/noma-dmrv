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

/** Supplier: a warehouse with a roller door, filled sacks on a pallet outside. */
const WAREHOUSE = "M5 35 V17 L20 9 L35 17 V35";
const WAREHOUSE_DOOR = "M12 35 V23 H28 V35";
const WAREHOUSE_DOOR_SLATS = "M12 26.5 H28 M12 30 H28";
const SUPPLY_PALLET = "M38 35 V32.5 H52 V35";
const SUPPLY_SACK_SIZE = { width: 6.5, height: 5.5, rx: 2.5 } as const;
const SUPPLY_SACKS_BELOW = [[38.5, 27], [45, 27]] as const;
const SUPPLY_SACK_TOP = [41.75, 21.5] as const;

export function SupplierArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <path d={WAREHOUSE} />
      <path d={WAREHOUSE_DOOR} />
      <Motion kind="draw" largeOnly>
        <path d={WAREHOUSE_DOOR_SLATS} pathLength={1} />
      </Motion>
      <path d={SUPPLY_PALLET} />
      {SUPPLY_SACKS_BELOW.map(([x, y]) => (
        <rect key={x} x={x} y={y} {...SUPPLY_SACK_SIZE} />
      ))}
      <Motion kind="drop">
        <rect x={SUPPLY_SACK_TOP[0]} y={SUPPLY_SACK_TOP[1]} {...SUPPLY_SACK_SIZE} />
      </Motion>
    </IllustrationFrame>
  );
}

/** Feedstock: a heap of mixed biomass, chips and twigs, a sprig growing from the top. */
const HEAP = "M7 35 C12 22 20 17 28 17 C36 17 44 22 49 35";
const HEAP_CHIPS = "M15 30 L19 28 M24 25.5 L28 27 M33 29.5 L37 27.5 M20 33 L23.5 32 M29 21.5 L32.5 21 M38 32.5 L41 31";
const HEAP_GRAINS = [[18, 23.5], [26, 31], [40, 25]] as const;
const SPRIG_STEM = "M30 17 C30.5 13 31.5 10.5 33.5 8";
const SPRIG_LEAVES = "M32 11 C34 8 37.5 7.5 39.5 8.5 C38 11.5 34.5 12.5 32 11 Z M30.5 14 C28.5 11.5 25.5 11 23.5 12 C25 14.5 28 15.5 30.5 14 Z";

export function FeedstockArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <path d={HEAP} />
      <path d={HEAP_CHIPS} />
      <Motion kind="pop" largeOnly>
        <Dots points={HEAP_GRAINS} />
      </Motion>
      <Motion kind="sway">
        <path d={SPRIG_STEM} />
        <path d={SPRIG_LEAVES} />
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

/** Biochar product: a sack, its neck tied, a leaf printed on the front. */
const SACK_TOP = "M22 12.5 L19 6 Q22.5 7.8 25 5.5 Q28 8.2 31 5.5 Q33.5 7.8 37 6 L34 12.5";
const SACK_TIE = "M21 13 Q28 15.5 35 13";
const SACK_BODY = "M21.5 13.5 C13 17 11 27 13 35 H43 C45 27 43 17 34.5 13.5";
const SACK_LEAF = "M24 29 C25 24 29 21.5 33 21.5 C33 26 29.5 29 24 29 Z M24 29 L29 24.5";

export function BiocharProductArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <Motion kind="lift">
        <path d={SACK_TOP} />
        <path d={SACK_TIE} />
        <path d={SACK_BODY} />
        <Motion kind="pop" largeOnly>
          <path d={SACK_LEAF} />
        </Motion>
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
