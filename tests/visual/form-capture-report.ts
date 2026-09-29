/**
 * Turns raw in-page geometry into violations and writes `geometry.json` and
 * `summary.md` for the form capture harness. Rules come from the plan
 * ("Browser rescan", Instrument A) and docs/design-system.md "Form type,
 * lines and spacing".
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { BodyMode, GapItem, Geometry } from "./form-geometry";

/** Most text styles a form body may use (design-system.md). */
const MAX_FORM_TEXT_STYLES = 4;
/** The spacing scale gaps must sit on (plan Instrument A, Rhythm). */
const SPACING_SCALE = [6, 8, 12, 16, 20, 24];
const SCALE_TOLERANCE_PX = 1;
/** Levels judged against the scale; read label-to-value gaps are reported only. */
const SCALED_LEVELS: GapItem["level"][] = ["section", "field", "label"];
/** A Simple/Detailed difference that is an explanation affordance, not content. */
const EXPLANATION_PATTERN = /^(show|hide) calculation|^more about|^about |^more info/i;
const TOP_ISSUES_PER_FAMILY = 8;
const SUMMARY_COLUMNS = 11;
/** Distinct off-scale gaps listed per surface row. */
const OFF_SCALE_SHOWN = 6;

export interface StateViolations {
  textStyles: number;
  uppercaseOrTracked: number;
  lines: number;
  offScaleGaps: GapItem[];
  inconsistentLevels: { level: string; values: number[] }[];
  alignment: number;
  overflow: number;
  prose: number;
}

export interface CapturedState {
  state: string;
  viewport: string;
  png: string;
  geometry?: Geometry;
  violations?: StateViolations;
  failures: string[];
}

export interface R1Diff {
  simpleOnly: { labels: string[]; sectionTitles: string[]; actions: string[] };
  detailedOnly: { labels: string[]; sectionTitles: string[]; actions: string[] };
  explanationOnly: string[];
  failures: string[];
}

export interface SurfaceRecord {
  id: string;
  family: string;
  title: string;
  kind: string;
  mode: BodyMode;
  status: "captured" | "skipped" | "failed";
  reason?: string;
  skippedStates: { state: string; reason: string }[];
  states: CapturedState[];
  r1?: R1Diff;
}

export interface CaptureRun {
  label: string;
  baseURL: string;
  startedAt: string;
  finishedAt?: string;
  viewports: string[];
  family: string | null;
  surfaces: SurfaceRecord[];
}

const onScale = (value: number) =>
  SPACING_SCALE.some((step) => Math.abs(step - value) <= SCALE_TOLERANCE_PX);

export function evaluateGeometry(geometry: Geometry, mode: BodyMode): { violations: StateViolations; failures: string[] } {
  const failures: string[] = [];
  const judged = mode !== "page";
  const offScaleGaps = judged
    ? geometry.rhythm.gaps.filter((gap) => SCALED_LEVELS.includes(gap.level) && !onScale(gap.value))
    : [];
  const inconsistentLevels: { level: string; values: number[] }[] = [];
  if (judged) {
    for (const level of SCALED_LEVELS) {
      const values = Array.from(new Set(geometry.rhythm.gaps.filter((gap) => gap.level === level).map((gap) => Math.round(gap.value)))).sort((a, b) => a - b);
      if (values.length > 1) inconsistentLevels.push({ level, values });
    }
  }
  const alignment = judged
    ? geometry.alignment.nearMisaligned.length +
      geometry.alignment.loneHalfWidth.length +
      geometry.alignment.orphanedGridItems.length +
      geometry.alignment.wrappedLabels.length
    : 0;
  const overflow =
    Number(geometry.overflow.bodyHorizontalScroll) +
    Number(geometry.overflow.pageHorizontalScroll) +
    geometry.overflow.clipped.length +
    geometry.overflow.tooWide.length;
  const violations: StateViolations = {
    textStyles: mode === "form" && geometry.textStyles.count > MAX_FORM_TEXT_STYLES ? geometry.textStyles.count : 0,
    uppercaseOrTracked: judged ? geometry.textStyles.uppercaseOrTracked.length : 0,
    lines: judged ? geometry.lines.violations : 0,
    offScaleGaps,
    inconsistentLevels,
    alignment,
    overflow,
    prose: geometry.prose.helperCaptions + geometry.prose.paragraphs,
  };
  if (violations.textStyles) failures.push(`${violations.textStyles} text styles (max ${MAX_FORM_TEXT_STYLES})`);
  if (violations.uppercaseOrTracked) failures.push(`${violations.uppercaseOrTracked} uppercase/tracked text runs`);
  if (violations.lines) failures.push(`${violations.lines} unallowed lines`);
  if (offScaleGaps.length) failures.push(`${offScaleGaps.length} off-scale gaps`);
  if (inconsistentLevels.length) failures.push(`inconsistent ${inconsistentLevels.map((level) => level.level).join("/")} rhythm`);
  if (alignment) failures.push(`${alignment} alignment issues`);
  if (overflow) failures.push(`${overflow} overflow issues`);
  return { violations, failures };
}

const minus = (a: string[], b: string[]) => a.filter((item) => !b.includes(item));

export function diffR1(simple: Geometry["r1"], detailed: Geometry["r1"]): R1Diff {
  const simpleOnly = {
    labels: minus(simple.labels, detailed.labels),
    sectionTitles: minus(simple.sectionTitles, detailed.sectionTitles),
    actions: minus(simple.actions, detailed.actions),
  };
  const detailedOnly = {
    labels: minus(detailed.labels, simple.labels),
    sectionTitles: minus(detailed.sectionTitles, simple.sectionTitles),
    actions: minus(detailed.actions, simple.actions),
  };
  const everything = [
    ...simpleOnly.labels, ...simpleOnly.sectionTitles, ...simpleOnly.actions,
    ...detailedOnly.labels, ...detailedOnly.sectionTitles, ...detailedOnly.actions,
  ];
  const explanationOnly = everything.filter((item) => EXPLANATION_PATTERN.test(item));
  const failures = everything.filter((item) => !EXPLANATION_PATTERN.test(item));
  return { simpleOnly, detailedOnly, explanationOnly, failures };
}

export function writeGeometry(outDir: string, run: CaptureRun) {
  writeFileSync(path.join(outDir, "geometry.json"), JSON.stringify(run, null, 1));
}

interface Tally {
  surfaces: number;
  captured: number;
  skipped: number;
  failed: number;
  issues: Map<string, number>;
}

function tallyIssue(tally: Tally, issue: string) {
  tally.issues.set(issue, (tally.issues.get(issue) ?? 0) + 1);
}

function surfaceRow(surface: SurfaceRecord): string {
  if (surface.status !== "captured") {
    const reason = (surface.reason ?? "").replace(/\|/g, "/");
    return `| ${surface.id} | ${surface.status}: ${reason} |${" |".repeat(SUMMARY_COLUMNS - 2)}`;
  }
  const measured = surface.states.filter((state) => state.violations);
  const max = (pick: (v: StateViolations) => number) => Math.max(0, ...measured.map((state) => pick(state.violations!)));
  const styleCounts = measured.map((state) => state.geometry!.textStyles.count);
  const offScale = new Set(measured.flatMap((state) => state.violations!.offScaleGaps.map((gap) => `${gap.level}:${Math.round(gap.value)}`)));
  const inconsistent = new Set(measured.flatMap((state) => state.violations!.inconsistentLevels.map((level) => level.level)));
  const r1 = surface.r1 ? surface.r1.failures.length : "n/a";
  return [
    "",
    surface.id,
    `${surface.states.length} png`,
    styleCounts.length ? `${Math.max(...styleCounts)}` : "",
    `${max((v) => v.uppercaseOrTracked)}`,
    `${max((v) => v.lines)}`,
    offScale.size ? Array.from(offScale).slice(0, OFF_SCALE_SHOWN).join(" ") : "0",
    inconsistent.size ? Array.from(inconsistent).join("/") : "",
    `${max((v) => v.alignment)}`,
    `${max((v) => v.overflow)}`,
    `${max((v) => v.prose)}`,
    `${r1}`,
    "",
  ].join(" | ").trim();
}

export function writeSummary(outDir: string, run: CaptureRun) {
  const families = Array.from(new Set(run.surfaces.map((surface) => surface.family)));
  const lines: string[] = [
    `# Form capture: ${run.label}`,
    "",
    `Run ${run.startedAt} to ${run.finishedAt ?? "(unfinished)"} against ${run.baseURL}. Viewports: ${run.viewports.join(", ")}.${run.family ? ` Family filter: ${run.family}.` : ""}`,
    "",
    "Columns are the worst value across a surface's states and viewports. Styles = distinct text styles (forms fail above 4). Caps = uppercase or tracked runs. Lines = rules outside the allowed chrome. Off-scale = gaps off 6/8/12/16/20/24 (level:px). Mixed = levels with more than one gap value. Align = near-misaligned control edges, lone half-width fields, orphaned grid items, wrapped labels. Overflow = horizontal scroll, clipped text, elements wider than the body. Prose = visible helper captions plus paragraphs. R1 = Simple/Detailed differences that are not explanation.",
    "",
  ];
  for (const family of families) {
    const surfaces = run.surfaces.filter((surface) => surface.family === family);
    const tally: Tally = { surfaces: surfaces.length, captured: 0, skipped: 0, failed: 0, issues: new Map() };
    for (const surface of surfaces) {
      tally[surface.status] += 1;
      for (const state of surface.states) for (const failure of state.failures) tallyIssue(tally, `${surface.id}: ${failure.replace(/^\d+ /, "")}`);
      for (const failure of surface.r1?.failures ?? []) tallyIssue(tally, `${surface.id}: R1 "${failure}"`);
    }
    lines.push(`## ${family}`, "");
    lines.push(`${tally.captured} captured, ${tally.skipped} skipped, ${tally.failed} failed, of ${tally.surfaces} surfaces.`, "");
    lines.push("| Surface | Captured | Styles | Caps | Lines | Off-scale | Mixed | Align | Overflow | Prose | R1 |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const surface of surfaces) lines.push(surfaceRow(surface));
    const top = Array.from(tally.issues.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP_ISSUES_PER_FAMILY);
    if (top.length) {
      lines.push("", "Most frequent violations (count = states and viewports affected):", "");
      for (const [issue, count] of top) lines.push(`- ${issue} (${count})`);
    }
    const r1 = surfaces.filter((surface) => surface.r1 && surface.r1.failures.length);
    if (r1.length) {
      lines.push("", `R1 differences (Simple vs Detailed, ${run.viewports[0]}):`, "");
      for (const surface of r1) {
        const d = surface.r1!;
        const fmt = (side: typeof d.simpleOnly) => [...side.labels, ...side.sectionTitles, ...side.actions].filter((item) => !EXPLANATION_PATTERN.test(item)).join("; ") || "none";
        lines.push(`- ${surface.id}: Detailed only: ${fmt(d.detailedOnly)}. Simple only: ${fmt(d.simpleOnly)}.`);
      }
    }
    lines.push("");
  }
  const skipped = run.surfaces.flatMap((surface) => [
    ...(surface.status !== "captured" ? [`- ${surface.id} (${surface.status}): ${surface.reason}`] : []),
    ...surface.skippedStates.map((state) => `- ${surface.id} state ${state.state}: ${state.reason}`),
  ]);
  if (skipped.length) lines.push("## Skipped or failed", "", ...skipped, "");
  writeFileSync(path.join(outDir, "summary.md"), lines.join("\n"));
}
