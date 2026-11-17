import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { run } from "./review-runtime.mjs";

const MIN_ROUND = 1;
const MIN_PR_NUMBER = 1;
const SEVERITIES = ["P0", "P1", "P2", "P3"];
const UNKNOWN_SEVERITY_RANK = SEVERITIES.length;

export function projectSlug(mainCheckout) {
  return mainCheckout.replace(/[^A-Za-z0-9]/g, "-");
}

export function reportArchivePath(root, report) {
  const branch = report.branch;
  if (typeof branch !== "string" || !branch || /[\\\x00-\x1f\x7f]/.test(branch) ||
      branch.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Report has an unsafe branch name");
  }
  if (!Number.isSafeInteger(report.round) || report.round < MIN_ROUND) {
    throw new Error("Report must have a positive round");
  }
  if (!["local", "pr"].includes(report.mode)) throw new Error("Report has an unknown mode");
  if (report.mode === "pr" && (!Number.isSafeInteger(report.pr) || report.pr < MIN_PR_NUMBER)) {
    throw new Error("PR report must have a positive PR number");
  }
  const prefix = report.mode === "pr" ? `pr-${report.pr}-` : "";
  return join(root, branch, `${prefix}round-${report.round}.json`);
}

export function findingsSummaryLines(report, reportPath, archivePath) {
  const findings = (report.reports || []).flatMap((review) =>
    (review.findings || []).map((finding) => ({ ...finding, practice: review.practice, model: review.model })),
  );
  const rank = (severity) => {
    const index = SEVERITIES.indexOf(severity);
    return index < 0 ? UNKNOWN_SEVERITY_RANK : index;
  };
  findings.sort((left, right) => rank(left.severity) - rank(right.severity));
  return [
    `Findings: ${reportPath} (.reports[].findings[])`,
    ...(findings.length ? findings.map((finding) =>
      `${finding.severity} ${finding.practice}/${finding.model} ${finding.path}:${finding.start_line} ${finding.title}`,
    ) : ["No findings."]),
    `Archive: ${archivePath ?? "skipped or unavailable"}`,
  ];
}

export async function resolveArchiveRoot({ cwd = process.cwd(), env = process.env, gitCommand = run } = {}) {
  if (env.PR_REVIEW_SUITE_ARCHIVE_DIR !== undefined) {
    return env.PR_REVIEW_SUITE_ARCHIVE_DIR === "" ? undefined : resolve(cwd, env.PR_REVIEW_SUITE_ARCHIVE_DIR);
  }
  const common = await gitCommand("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  const mainCheckout = dirname(common.stdout.trim());
  return join(homedir(), ".claude", "projects", projectSlug(mainCheckout), "reviews");
}

// Archive failures are advisory, including root discovery and edited JSON errors.
export async function archiveReport(reportPath, options = {}) {
  const warn = options.warn || ((message) => process.stderr.write(`${message}\n`));
  try {
    const root = await resolveArchiveRoot(options);
    if (root === undefined) return undefined;
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const destination = reportArchivePath(root, report);
    mkdirSync(dirname(destination), { recursive: true });
    if (resolve(reportPath) !== resolve(destination)) copyFileSync(reportPath, destination);
    return destination;
  } catch (error) {
    warn(`Warning: could not archive review report ${reportPath}: ${error.message}`.replace(/[\r\n]+/g, " "));
    return undefined;
  }
}
