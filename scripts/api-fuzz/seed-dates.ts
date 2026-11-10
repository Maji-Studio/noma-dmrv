import { formatFacilityDate } from "@/lib/date-utils";

export const SEEDED_RUN_START_HOURS_AGO = 3;
export const OUTPUT_RUN_START_HOURS_AGO = 6;
export const MS_PER_HOUR = 3_600_000;
// A full UTC facility day makes the intake day strictly earlier even at midnight.
const INTAKE_MARGIN_HOURS = 24;

/** The caller supplies the same clock used for every seeded run. */
export function seedIntakeDate(now: number, timeZone: string): string {
  const intakeHoursAgo = Math.max(SEEDED_RUN_START_HOURS_AGO, OUTPUT_RUN_START_HOURS_AGO) + INTAKE_MARGIN_HOURS;
  return formatFacilityDate(new Date(now - intakeHoursAgo * MS_PER_HOUR), timeZone);
}
