export const UNKNOWN_REMOTE_PERIOD_END_ON = "9999-12-31";

const REMOTE_PERIOD_SURROGATE_CAPACITY = 10_000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface StoredRemotePeriodEnd {
  endOn: string;
  synthetic: boolean;
}

/**
 * Chooses a unique non-null local date for a registry statement. The local
 * schema predates nullable/duplicate registry periods, so collisions use a
 * reserved far-future date while metadata retains the authoritative period.
 */
export function chooseStoredRemotePeriodEnd(
  remoteEndOn: string | null,
  occupiedEndOns: ReadonlySet<string>,
): StoredRemotePeriodEnd {
  if (remoteEndOn !== null && !occupiedEndOns.has(remoteEndOn)) {
    return { endOn: remoteEndOn, synthetic: false };
  }

  for (
    let offsetDays = 0;
    offsetDays < REMOTE_PERIOD_SURROGATE_CAPACITY;
    offsetDays += 1
  ) {
    const candidate = subtractCalendarDays(
      UNKNOWN_REMOTE_PERIOD_END_ON,
      offsetDays,
    );
    if (!occupiedEndOns.has(candidate) && candidate !== remoteEndOn) {
      return { endOn: candidate, synthetic: true };
    }
  }

  throw new Error("No local reporting-period surrogate is available.");
}

function subtractCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year, month - 1, day) - days * MILLISECONDS_PER_DAY,
  );
  return [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
