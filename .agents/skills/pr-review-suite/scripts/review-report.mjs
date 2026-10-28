import { displayModel, profileModels } from "./review-models.mjs";
import { earlierRounds, REPORT_VERSION } from "./review-prior.mjs";
import { DEFAULT_PRACTICES } from "./review-runtime.mjs";

export const COMMENT_MARKER = "<!-- noma-pr-review-suite:v1 -->";
const SEVERITY_ORDER = new Map([
  ["P0", 0],
  ["P1", 1],
  ["P2", 2],
  ["P3", 3],
]);

export function formatFinding(finding) {
  const lines =
    finding.start_line === finding.end_line
      ? `${finding.start_line}`
      : `${finding.start_line}-${finding.end_line}`;
  return `- **${finding.severity} ${finding.title}** — \`${finding.path}:${lines}\`
  - ${finding.problem}
  - Basis: ${finding.basis}
  - Evidence: ${finding.evidence}
  - Smallest safe fix: ${finding.smallest_safe_fix}`;
}

export function worstSeverity(reports) {
  return reports
    .flatMap((report) => report.output?.findings || [])
    .map((finding) => finding.severity)
    .sort(
      (left, right) =>
        (SEVERITY_ORDER.get(left) ?? 99) - (SEVERITY_ORDER.get(right) ?? 99),
    )[0];
}

export function aggregateReport({ pr, baseSha, headSha, reports, skippedPractices, omittedFiles = [], round = 1, priors = [], profile = "full" }) {
  const sections = [
    COMMENT_MARKER,
    pr.mode === "local" ? "# Codex + Opus local review suite" : "# Codex + Opus PR review suite",
    "",
    pr.mode === "local" ? `Branch: ${pr.headRefName}` : `PR: [#${pr.number}](${pr.url})`,
    `Round: ${round}`,
    `Models: ${displayModel("codex", profile)} + ${displayModel("opus", profile)} (profile ${profile})`,
    ...(priors.length ? [`Earlier rounds: ${earlierRounds(priors)}`] : []),
    `Reviewed head: \`${headSha}\``,
    `Base: \`${pr.baseRefName}\` at \`${baseSha}\``,
    "",
    "> Advisory model output. Verify every finding against the code before changing it.",
  ];
  if (omittedFiles.length > 0) {
    sections.push(
      "",
      `Generated files left out of the reviewed diff (${omittedFiles.length}): ${omittedFiles
        .map((path) => `\`${path}\``)
        .join(", ")}`,
    );
  }

  for (const practice of DEFAULT_PRACTICES) {
    if (skippedPractices.has(practice)) {
      sections.push("", `## ${displayPractice(practice)}`, "", `_${skippedPractices.get(practice)}; practice skipped._`);
      continue;
    }
    const practiceReports = reports.filter((report) => report.practice === practice);
    if (practiceReports.length === 0) continue;
    sections.push("", `## ${displayPractice(practice)}`);
    for (const report of practiceReports) {
      sections.push("", `### ${displayModel(report.model, profile)}`, "");
      if (report.error) {
        sections.push(`_Reviewer failed: ${report.error}_`);
        continue;
      }
      const findings = report.output.findings || [];
      if (findings.length === 0) {
        sections.push("_No material findings._");
      } else {
        sections.push(findings.map(formatFinding).join("\n"));
      }
      sections.push("", report.output.summary || "_No summary returned._");
      const residualRisks = report.output.residual_risks || [];
      if (residualRisks.length > 0) {
        sections.push("", `Residual risks: ${residualRisks.join("; ")}`);
      }
      const droppedFindings = report.output.droppedFindings || [];
      if (droppedFindings.length > 0) {
        sections.push(
          "",
          `Dropped ${droppedFindings.length} finding(s) whose location could not be resolved: ${droppedFindings.join("; ")}`,
        );
      }
    }
  }

  sections.push("", "## Per-practice summary", "");
  for (const practice of DEFAULT_PRACTICES) {
    if (skippedPractices.has(practice)) {
      const reason = skippedPractices.get(practice);
      sections.push(`- **${displayPractice(practice)}:** skipped; ${reason[0].toLowerCase()}${reason.slice(1)}.`);
      continue;
    }
    const practiceReports = reports.filter((report) => report.practice === practice);
    if (practiceReports.length === 0) continue;
    const count = practiceReports.reduce(
      (total, report) => total + (report.output?.findings?.length || 0),
      0,
    );
    const worst = worstSeverity(practiceReports);
    sections.push(
      `- **${displayPractice(practice)}:** ${count} finding(s) across ${
        practiceReports.length
      } model(s); worst ${worst || "none"}.`,
    );
  }
  return `${sections.join("\n")}\n`;
}

export function displayPractice(practice) {
  if (practice === "deep-correctness") return "Deep Correctness";
  return practice[0].toUpperCase() + practice.slice(1);
}

export { displayModel } from "./review-models.mjs";

export function buildReportJson({ pr, baseSha, headSha, reports, skippedPractices, round = 1, profile = "full", generatedAt = new Date().toISOString() }) {
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  // v1: {version, mode, round, profile, models, base: {name, sha}, headSha, pr,
  // branch, generatedAt, counts: {P0,P1,P2,P3}, reports: [{practice, model,
  // status, error?, findings}], skippedPractices: [[practice, reason]]}.
  // Findings have stable IDs and editable disposition/reason for the next round.
  const normalized = reports.map((report) => ({
    practice: report.practice,
    model: report.model,
    status: report.error ? "failed" : "ok",
    ...(report.error ? { error: report.error } : {}),
    findings: (report.output?.findings || []).map((finding, index) => {
      counts[finding.severity] += 1;
      return {
        id: `r${round}-${report.practice}-${report.model}-${index + 1}`,
        severity: finding.severity,
        kind: finding.kind,
        title: finding.title,
        path: finding.path,
        start_line: finding.start_line,
        end_line: finding.end_line,
        problem: finding.problem,
        smallest_safe_fix: finding.smallest_safe_fix,
        disposition: null,
        reason: null,
      };
    }),
  }));
  return {
    version: REPORT_VERSION,
    mode: pr.mode === "local" ? "local" : "pr",
    round,
    profile,
    models: profileModels(profile),
    base: { name: pr.baseRefName, sha: baseSha },
    headSha,
    pr: pr.number ?? null,
    branch: pr.headRefName,
    generatedAt,
    counts,
    reports: normalized,
    skippedPractices: [...skippedPractices],
  };
}
