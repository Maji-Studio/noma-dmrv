/** Places and machines on a producer's site: storage bin, reactor, facility, delivery truck. Flat front view. */

import { Dots, IllustrationFrame, Motion, type IllustrationProps } from "./illustration-frame";

/** Storage bin: the stock-mode bin, an open box with its grains in rows, the lid lifted off. */
const BIN_BODY = "M12 15 V35 H44 V15";
const BIN_LID = "M10 9 H46 V12 H10 Z";
const BIN_HANDLE = "M25 9 V7 H31 V9";
const BIN_GRAIN_RADIUS = 1.1;
const BIN_GRAIN_XS = [16, 20, 24, 28, 32, 36, 40] as const;
const BIN_GRAIN_YS = [20, 24, 28, 32] as const;
/** The top row pops back in on large drawings, as if just poured. */
const BIN_GRAINS_TOP = BIN_GRAIN_XS.map((x) => [x, BIN_GRAIN_YS[0]] as const);
const BIN_GRAINS_BELOW = BIN_GRAIN_YS.slice(1).flatMap((y) => BIN_GRAIN_XS.map((x) => [x, y] as const));

export function StorageBinArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <Motion kind="lift">
        <path d={BIN_LID} />
        <path d={BIN_HANDLE} />
      </Motion>
      <path d={BIN_BODY} />
      <Motion kind="pop" largeOnly>
        <Dots points={BIN_GRAINS_TOP} radius={BIN_GRAIN_RADIUS} />
      </Motion>
      <Dots points={BIN_GRAINS_BELOW} radius={BIN_GRAIN_RADIUS} />
    </IllustrationFrame>
  );
}

/** Reactor: an open Kon-Tiki cone kiln standing on short legs, flames rising from its rim. */
const KILN_RIM = { cx: 28, cy: 16, rx: 17, ry: 3 } as const;
const KILN_CONE = "M11 16 L23 34 H33 L45 16";
const KILN_BAND = "M17 25 Q28 27.5 39 25";
const KILN_LEGS = "M24.5 34 V37 M31.5 34 V37";
/** Flames stand on the back edge of the rim, so no line crosses them. */
const KILN_FLAME_CENTRE = "M25 13.1 C24.5 10 26.5 8 28 4 C29.5 8 31.5 10 31 13.1";
const KILN_FLAME_LEFT = "M17.5 13.6 C17.5 12 18.6 10.6 19.5 8.5 C20.4 10.6 21.5 12 21.5 13.2";
const KILN_FLAME_RIGHT = "M38.5 13.6 C38.5 12 37.4 10.6 36.5 8.5 C35.6 10.6 34.5 12 34.5 13.2";
/** Side flames flicker out of step with the centre one. */
const KILN_FLAME_STAGGER = 260;

export function ReactorArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <ellipse {...KILN_RIM} />
      <path d={KILN_CONE} />
      <path d={KILN_BAND} />
      <path d={KILN_LEGS} />
      <Motion kind="flicker">
        <path d={KILN_FLAME_CENTRE} />
      </Motion>
      <Motion kind="flicker" delay={KILN_FLAME_STAGGER} largeOnly>
        <path d={KILN_FLAME_LEFT} />
      </Motion>
      <Motion kind="flicker" delay={KILN_FLAME_STAGGER * 2} largeOnly>
        <path d={KILN_FLAME_RIGHT} />
      </Motion>
    </IllustrationFrame>
  );
}

/** Facility: a saw-tooth shed with a chimney built onto its end wall, and a fence. */
const FACILITY_SHED = "M6 35 V13 L14 19 V13 L22 19 V13 L30 19 V35";
const FACILITY_DOOR = "M15 35 V28 H21 V35";
const FACILITY_WINDOWS = "M9 24 H12 V27 H9 Z M24 24 H27 V27 H24 Z";
/** Shares the shed's end wall at x 30, so it reads as one building. */
const FACILITY_CHIMNEY = "M30 19 V9 H36 V35";
/** Two rising wisps above the chimney mouth. */
const FACILITY_SMOKE_LEFT = "M31.6 7 C30.4 5.6 32.8 4.2 31.6 2.8";
const FACILITY_SMOKE_RIGHT = "M34.4 7 C33.2 5.6 35.6 4.2 34.4 2.8";
const FACILITY_SMOKE_STAGGER = 500;
const FACILITY_FENCE = "M42 35 V29 M46 35 V29 M50 35 V29 M41 31.5 H51";

export function FacilityArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <path d={FACILITY_SHED} />
      <path d={FACILITY_DOOR} />
      <path d={FACILITY_WINDOWS} />
      <path d={FACILITY_CHIMNEY} />
      <Motion kind="rise">
        <path d={FACILITY_SMOKE_LEFT} />
      </Motion>
      <Motion kind="rise" delay={FACILITY_SMOKE_STAGGER} largeOnly>
        <path d={FACILITY_SMOKE_RIGHT} />
      </Motion>
      <path d={FACILITY_FENCE} />
    </IllustrationFrame>
  );
}

/** Delivery truck: a tipper carrying a heap of biochar, the wheels clear of the body, on a dotted road. */
const TRUCK_BED = "M5 15 V28 H32 V15";
const TRUCK_HEAP = "M5 15 Q18.5 5 32 15";
const TRUCK_LOAD = [[13.5, 13.2], [18.5, 12.4], [23.5, 13.2]] as const;
const TRUCK_CAB = "M32 17 H41 L47 23 V28 H32";
const TRUCK_WINDOW = "M35 20 H40 L43 23.5 H35 Z";
/** Wheel tops sit just under the chassis line at y 28. */
const TRUCK_WHEEL_Y = 32;
const TRUCK_WHEEL_RADIUS = 3.5;
const TRUCK_WHEEL_XS = [13, 40] as const;

export function DeliveryTruckArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="dotted" {...props}>
      <Motion kind="bob" largeOnly>
        <path d={TRUCK_BED} />
        <path d={TRUCK_HEAP} />
        <Dots points={TRUCK_LOAD} />
        <path d={TRUCK_CAB} />
        <path d={TRUCK_WINDOW} />
      </Motion>
      {TRUCK_WHEEL_XS.map((cx) => (
        <circle key={cx} cx={cx} cy={TRUCK_WHEEL_Y} r={TRUCK_WHEEL_RADIUS} />
      ))}
    </IllustrationFrame>
  );
}
