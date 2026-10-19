import { formatFacilityDate } from "@/lib/date-utils";

const FALLBACK_TIME_ZONES = ["Africa/Dar_es_Salaam", "America/New_York"];

/** Keep relative dates unambiguous while still exercising a non-UTC facility. */
export function chooseApplicationTimeZone(
  now = new Date(), localZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const sessionDate = formatFacilityDate(now, localZone);
  const canonicalZone = new Intl.DateTimeFormat("en", { timeZone: localZone }).resolvedOptions().timeZone;
  if (canonicalZone !== "UTC") return canonicalZone;
  return FALLBACK_TIME_ZONES.find((zone) => formatFacilityDate(now, zone) === sessionDate)!;
}
