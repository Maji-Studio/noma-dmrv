/**
 * The IANA timezone catalogue behind the timezone picker and every timezone
 * validator.
 *
 * Source: `@vvo/tzdb` (one entry per distinct zone, with country, main cities and
 * a readable name, plus the aliases each entry stands for) and a manual UTC entry,
 * which the library leaves out. Pure data and string matching, so it runs on the
 * server (validation) and in the browser (search) alike. Display labels, which
 * depend on the clock, live in `@/lib/date-utils` (`formatTimezoneLabel`).
 */
import { rawTimeZones } from "@vvo/tzdb";

export interface TimezoneEntry {
  /** Canonical IANA id stored on the facility, e.g. "Africa/Dar_es_Salaam". */
  id: string;
  /** Every IANA id this entry stands for (aliases included). */
  aliases: readonly string[];
  /** ISO 3166-1 alpha-2, or "" for zones that belong to no country. */
  countryCode: string;
  countryName: string;
  /** Readable zone name, e.g. "East Africa Time". */
  readableName: string;
  cities: readonly string[];
}

export const UTC_TIMEZONE_ID = "UTC";

const UTC_ENTRY: TimezoneEntry = {
  id: UTC_TIMEZONE_ID,
  aliases: [UTC_TIMEZONE_ID, "Etc/UTC"],
  countryCode: "",
  countryName: "",
  readableName: "Coordinated Universal Time",
  cities: [],
};

export const TIMEZONE_ENTRIES: readonly TimezoneEntry[] = [
  ...rawTimeZones.map(
    (zone): TimezoneEntry => ({
      id: zone.name,
      aliases: zone.group,
      countryCode: zone.countryCode,
      countryName: zone.countryName,
      readableName: zone.alternativeName,
      cities: zone.mainCities.filter(Boolean),
    }),
  ),
  UTC_ENTRY,
].sort((a, b) => a.id.localeCompare(b.id));

/** Every IANA id (canonical or alias, case-sensitive) -> the entry it belongs to. */
const ENTRY_BY_ID: ReadonlyMap<string, TimezoneEntry> = (() => {
  const map = new Map<string, TimezoneEntry>();
  // Groups overlap (Nairobi's lists Dar_es_Salaam), so aliases go in first and
  // a canonical id always overwrites an alias of another entry.
  for (const entry of TIMEZONE_ENTRIES) {
    for (const alias of entry.aliases) map.set(alias, entry);
  }
  for (const entry of TIMEZONE_ENTRIES) map.set(entry.id, entry);
  return map;
})();

/**
 * The entry a stored id belongs to. A valid alias ("Australia/Melbourne" under
 * "Australia/Sydney") resolves to its entry; the stored value is never rewritten.
 */
export function findTimezoneEntry(value: unknown): TimezoneEntry | undefined {
  return typeof value === "string" ? ENTRY_BY_ID.get(value) : undefined;
}

/** True for any IANA id the catalogue knows, canonical or alias. */
export function isValidIanaTimezone(value: unknown): value is string {
  return findTimezoneEntry(value) !== undefined;
}

/** Lowercase, accent-free, punctuation collapsed to single spaces. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Country text -> zones
// ---------------------------------------------------------------------------

const regionNames = new Intl.DisplayNames("en", { type: "region" });

/** Normalized country name or alpha-2 code -> alpha-2 code. */
const COUNTRY_CODE_BY_TEXT: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const entry of TIMEZONE_ENTRIES) {
    if (!entry.countryCode) continue;
    map.set(normalizeSearchText(entry.countryName), entry.countryCode);
    map.set(normalizeSearchText(entry.countryCode), entry.countryCode);
    const intlName = regionNames.of(entry.countryCode);
    if (intlName) map.set(normalizeSearchText(intlName), entry.countryCode);
  }
  return map;
})();

/** The alpha-2 code for free-text country input ("Tanzania", "tz"), or null. */
export function countryCodeFromText(country: string | null | undefined): string | null {
  if (!country) return null;
  return COUNTRY_CODE_BY_TEXT.get(normalizeSearchText(country)) ?? null;
}

/** The zones of the country the text names; empty when it names none we know. */
export function timezonesForCountry(
  country: string | null | undefined,
): readonly TimezoneEntry[] {
  const code = countryCodeFromText(country);
  if (!code) return [];
  return TIMEZONE_ENTRIES.filter((entry) => entry.countryCode === code);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Lower rank = better match. */
const RANK_WORD_EXACT = 0;
const RANK_WORD_PREFIX = 1;
const RANK_SUBSTRING = 2;
const RANK_NONE = Number.POSITIVE_INFINITY;

interface SearchableEntry {
  entry: TimezoneEntry;
  /** Each field as normalized text; matched word by word, then as a substring. */
  fields: readonly string[];
}

const SEARCHABLE_ENTRIES: readonly SearchableEntry[] = TIMEZONE_ENTRIES.map(
  (entry) => ({
    entry,
    // Offsets are deliberately absent: "UTC" must not match every zone.
    fields: [
      ...entry.aliases,
      entry.countryName,
      entry.countryCode,
      entry.readableName,
      ...entry.cities,
    ]
      .filter(Boolean)
      .map(normalizeSearchText),
  }),
);

function rankToken(token: string, fields: readonly string[]): number {
  let best = RANK_NONE;
  for (const field of fields) {
    if (field === token) return RANK_WORD_EXACT;
    const words = field.split(" ");
    if (words.includes(token)) best = Math.min(best, RANK_WORD_EXACT);
    else if (words.some((word) => word.startsWith(token))) {
      best = Math.min(best, RANK_WORD_PREFIX);
    } else if (token.length > 2 && field.includes(token)) {
      best = Math.min(best, RANK_SUBSTRING);
    }
  }
  return best;
}

/**
 * Zones matching `query` by country, city, IANA id or readable name, best match
 * first. Every whitespace-separated word must match somewhere. An empty query
 * returns every zone. `first` ids (e.g. the facility country's zones) sort ahead
 * of equally ranked results.
 */
export function searchTimezones(
  query: string,
  first: ReadonlySet<string> = new Set(),
): readonly TimezoneEntry[] {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  const ranked: { entry: TimezoneEntry; rank: number }[] = [];
  for (const { entry, fields } of SEARCHABLE_ENTRIES) {
    let rank = 0;
    for (const token of tokens) {
      rank += rankToken(token, fields);
      if (rank === RANK_NONE) break;
    }
    if (rank !== RANK_NONE) ranked.push({ entry, rank });
  }
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(first.has(b.entry.id)) - Number(first.has(a.entry.id)) ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .map(({ entry }) => entry);
}

/** Suggestions first, then everything else, for an empty query. */
export function orderWithSuggestions(
  suggested: readonly TimezoneEntry[],
): readonly TimezoneEntry[] {
  const suggestedIds = new Set(suggested.map((entry) => entry.id));
  return [
    ...suggested,
    ...TIMEZONE_ENTRIES.filter((entry) => !suggestedIds.has(entry.id)),
  ];
}

/** Base UI's reason for the user typing in the input (vs. an automatic fill). */
export const INPUT_CHANGE_REASON = "input-change";

/**
 * The search text after an input-value change. Only the user typing counts:
 * Base UI also rewrites the input to the chosen label on a pick, a focus-out or
 * a reopen, and those must not filter the list. Comparing the text with the
 * selected label cannot tell the two apart (typing "UTC" over a selected "UTC").
 */
export function searchQueryAfterInputChange(value: string, reason: string): string {
  return reason === INPUT_CHANGE_REASON ? value.trim() : "";
}
