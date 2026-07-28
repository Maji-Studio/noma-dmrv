import { formatDate, formatDateRange } from "@/lib/format-utils";
import { formatCount } from "@/lib/copy-utils";

export interface SubmissionWarningNote {
  key: string;
  summary: string;
  detail?: string;
}

interface PostWindowSampleWarning {
  sampleCode: string;
  samplingDay: string;
  batchCode: string;
  windowStart: string;
  windowEnd: string;
}

type WarningEntry =
  | { kind: "postWindow"; groupKey: string }
  | { kind: "note"; note: SubmissionWarningNote };

const POST_WINDOW_SAMPLE_PATTERN =
  /^Sample (.+?) was taken on (\d{4}-\d{2}-\d{2}), after credit batch (.+?)'s production window, (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\./;
const REPORTING_WINDOW_PATTERN =
  /^Reporting window spans multiple months \(production started (\d{4}-\d{2}), latest application (\d{4}-\d{2})\)/;
const SOIL_TEMPERATURE_PATTERN =
  /^An application site soil temperature \(([\d.]+) °C\) exceeds the declared facility reference \(([\d.]+) °C\)/;

function parsePostWindowSample(
  warning: string,
): PostWindowSampleWarning | null {
  const match = warning.match(POST_WINDOW_SAMPLE_PATTERN);
  if (!match) return null;
  return {
    sampleCode: match[1],
    samplingDay: match[2],
    batchCode: match[3],
    windowStart: match[4],
    windowEnd: match[5],
  };
}

function formatList(values: string[]): string {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function postWindowNote(
  groupKey: string,
  samples: PostWindowSampleWarning[],
): SubmissionWarningNote {
  const first = samples[0];
  const samplingDays = samples.map((sample) => sample.samplingDay).sort();
  const samplingRange =
    samplingDays[0] === samplingDays.at(-1)
      ? formatDate(samplingDays[0])
      : formatDateRange(samplingDays[0], samplingDays.at(-1));
  const productionWindow =
    first.windowStart === first.windowEnd
      ? formatDate(first.windowStart)
      : formatDateRange(first.windowStart, first.windowEnd);
  const sampleSubject = formatList(
    samples.map((sample) => sample.sampleCode),
  );
  const sampleVerb = samples.length === 1 ? "was" : "were";

  return {
    key: `post-window-${groupKey}`,
    summary: `${formatCount(samples.length, "Sample")} ${sampleVerb} taken after production ended.`,
    detail:
      `${sampleSubject} ${sampleVerb} sampled ${samplingRange}, ` +
      `after ${first.batchCode}'s production window (${productionWindow}). Under §8.3.1, ` +
      "stored-material Samples must represent the batch's full range; confirm this with the registry.",
  };
}

function knownWarningNote(
  warning: string,
  index: number,
): SubmissionWarningNote {
  if (warning.startsWith("Diesel fuel (genset and/or startup/preprocessing)")) {
    return {
      key: `unmapped-diesel-${index}`,
      summary: "Some recorded fuel emissions cannot be submitted.",
      detail:
        "The active Removal template has no compatible field for this fuel use. Update the template or confirm how these emissions should be reported.",
    };
  }

  const reportingWindow = warning.match(REPORTING_WINDOW_PATTERN);
  if (reportingWindow) {
    const [, productionMonth, applicationMonth] = reportingWindow;
    return {
      key: `reporting-window-${index}`,
      summary: "Production and application fall in different reporting months.",
      detail:
        `Production began in ${productionMonth}; the latest application was in ${applicationMonth}. ` +
        "Operations emissions should be assigned to the month they occur (§8.6.2). Consider splitting this Removal.",
    };
  }

  const soilTemperature = warning.match(SOIL_TEMPERATURE_PATTERN);
  if (soilTemperature) {
    const [, siteTemperature, referenceTemperature] = soilTemperature;
    return {
      key: `soil-temperature-${index}`,
      summary: "A site is warmer than the facility reference temperature.",
      detail:
        `The site is ${siteTemperature} °C and the reference is ${referenceTemperature} °C. ` +
        "This may over-credit durability; review the facility reference or its PDD justification.",
    };
  }

  // Keep unknown future warnings visible until a deliberately simplified
  // operator-facing version is added for them.
  return {
    key: `warning-${index}`,
    summary: warning,
  };
}

/**
 * Converts technical submission warnings into short operator notes. Repeated
 * stored-material warnings for one batch become a single note; protocol detail
 * remains available to the UI through the note's tooltip text.
 */
export function buildSubmissionWarningNotes(
  warnings: string[],
): SubmissionWarningNote[] {
  const entries: WarningEntry[] = [];
  const postWindowGroups = new Map<string, PostWindowSampleWarning[]>();

  warnings.forEach((warning, index) => {
    const postWindowSample = parsePostWindowSample(warning);
    if (!postWindowSample) {
      entries.push({ kind: "note", note: knownWarningNote(warning, index) });
      return;
    }

    const groupKey = [
      postWindowSample.batchCode,
      postWindowSample.windowStart,
      postWindowSample.windowEnd,
    ].join("-");
    const existingGroup = postWindowGroups.get(groupKey);
    if (existingGroup) {
      existingGroup.push(postWindowSample);
      return;
    }

    postWindowGroups.set(groupKey, [postWindowSample]);
    entries.push({ kind: "postWindow", groupKey });
  });

  return entries.map((entry) =>
    entry.kind === "note"
      ? entry.note
      : postWindowNote(
          entry.groupKey,
          postWindowGroups.get(entry.groupKey) ?? [],
        ),
  );
}
