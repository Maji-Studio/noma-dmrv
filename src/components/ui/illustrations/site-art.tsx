/** Places and machines on a producer's site: storage bin, reactor, facility, delivery truck. Flat front view. */

import { Dots, IllustrationFrame, type IllustrationProps } from "./illustration-frame";

/** Storage bin: a domed silo with a hopper base, legs and a ladder. */
const BIN_BODY = "M14 13 V28 L21 34 H27 L34 28 V13";
const BIN_ROOF = "M14 13 Q24 3 34 13 Z";
const BIN_VENT = "M24 8 V5.5 M22 5.5 H26";
const BIN_BAND = "M14 20 H34";
const BIN_DOOR = "M16 30 V37 M32 30 V37";
const BIN_LADDER = "M38 14 V37 M42 14 V37 M38 18 H42 M38 22 H42 M38 26 H42 M38 30 H42 M38 34 H42";
const BIN_GRAINS = [[19, 25], [24, 26], [29, 24]] as const;

export function StorageBinArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <path d={BIN_BODY} />
      <path d={BIN_ROOF} />
      <path d={BIN_VENT} />
      <path d={BIN_BAND} />
      <path d={BIN_DOOR} />
      <path d={BIN_LADDER} />
      <Dots points={BIN_GRAINS} />
    </IllustrationFrame>
  );
}

/** Reactor: an arched kiln with a flame in its door and a chimney on the shoulder. */
const REACTOR_BODY = "M8 35 V23 Q8 9 24 9 Q40 9 40 23 V35";
const REACTOR_DOOR = "M17 35 V28 Q17 22 24 22 Q31 22 31 28 V35";
const REACTOR_FLAME = "M24 34 C21.5 31.5 22 29 24 26.5 C26 29 26.5 31.5 24 34 Z";
const REACTOR_CHIMNEY = "M33 10.6 V6 H39 V16.9";
/** Two rising wisps above the chimney mouth. */
const REACTOR_SMOKE = "M35 4.6 C33.8 3.4 36.2 2.2 35 0.9 M37.8 4.6 C36.6 3.4 39 2.2 37.8 0.9";

export function ReactorArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <path d={REACTOR_BODY} />
      <path d={REACTOR_DOOR} />
      <path d={REACTOR_FLAME} />
      <path d={REACTOR_CHIMNEY} />
      <path d={REACTOR_SMOKE} />
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
const FACILITY_SMOKE = "M31.6 7 C30.4 5.6 32.8 4.2 31.6 2.8 M34.4 7 C33.2 5.6 35.6 4.2 34.4 2.8";
const FACILITY_FENCE = "M42 35 V29 M46 35 V29 M50 35 V29 M41 31.5 H51";

export function FacilityArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="solid" {...props}>
      <path d={FACILITY_SHED} />
      <path d={FACILITY_DOOR} />
      <path d={FACILITY_WINDOWS} />
      <path d={FACILITY_CHIMNEY} />
      <path d={FACILITY_SMOKE} />
      <path d={FACILITY_FENCE} />
    </IllustrationFrame>
  );
}

/** Delivery truck: a loaded trailer on a dotted road. */
const TRUCK_TRAILER = "M4 9 H32 V30 H4 Z";
const TRUCK_CAB = "M32 16 H42 L48 23 V30 H32";
const TRUCK_WINDOW = "M36 19 H41 L44 23 H36 Z";
const TRUCK_WHEEL_Y = 32.5;
const TRUCK_WHEEL_RADIUS = 3.8;
const TRUCK_WHEEL_XS = [13, 40] as const;
const TRUCK_LOAD = [[10, 26], [15, 26], [20, 26], [25, 26], [12.5, 22], [17.5, 22], [22.5, 22]] as const;
const TRUCK_HUB_RADIUS = 0.9;

export function DeliveryTruckArt(props: IllustrationProps) {
  return (
    <IllustrationFrame ground="dotted" {...props}>
      <path d={TRUCK_TRAILER} />
      <path d={TRUCK_CAB} />
      <path d={TRUCK_WINDOW} />
      {TRUCK_WHEEL_XS.map((cx) => (
        <circle key={cx} cx={cx} cy={TRUCK_WHEEL_Y} r={TRUCK_WHEEL_RADIUS} />
      ))}
      <Dots points={TRUCK_WHEEL_XS.map((x) => [x, TRUCK_WHEEL_Y] as const)} radius={TRUCK_HUB_RADIUS} />
      <Dots points={TRUCK_LOAD} />
    </IllustrationFrame>
  );
}
