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

export function aggregateReport({ pr, baseSha, headSha, reports, skippedPractices }) {
  const sections = [
    COMMENT_MARKER,
    "# Codex + Opus PR review suite",
    "",
    `PR: [#${pr.number}](${pr.url})`,
    `Reviewed head: \`${headSha}\``,
    `Base: \`${pr.baseRefName}\` at \`${baseSha}\``,
    "",
    "> Advisory model output. Verify every finding against the code before changing it.",
  ];

  for (const practice of DEFAULT_PRACTICES) {
    if (skippedPractices.has(practice)) {
      sections.push("", `## ${displayPractice(practice)}`, "", "_No spec available; practice skipped._");
      continue;
    }
    const practiceReports = reports.filter((report) => report.practice === practice);
    if (practiceReports.length === 0) continue;
    sections.push("", `## ${displayPractice(practice)}`);
    for (const report of practiceReports) {
      sections.push("", `### ${displayModel(report.model)}`, "");
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
      sections.push(`- **${displayPractice(practice)}:** skipped; no spec available.`);
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

export function displayModel(model) {
  return model === "codex" ? "Codex (gpt-5.6-sol, high)" : "Claude Opus (high)";
}

