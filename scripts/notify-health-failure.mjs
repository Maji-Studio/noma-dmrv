import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ISSUES_PER_PAGE = 100;
const ISSUE_LABEL = "ci-health";
const ISSUE_CREATOR = "github-actions[bot]";
const ISSUE_LABEL_COLOR = "B60205";
const GH_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const GH_TIMEOUT_MS = 60_000;

/** @param {string[]} args @param {object | undefined} payload */
function gh(args, payload = undefined) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input: payload === undefined ? undefined : JSON.stringify(payload),
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: GH_MAX_BUFFER_BYTES,
    timeout: GH_TIMEOUT_MS,
  });
}

/** @param {Record<string, string | undefined>} env @param {Date} failureTime */
export function notifyHealthFailure(env = process.env, failureTime = new Date()) {
  if (!["schedule", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME ?? "")) return;

  const required = ["GITHUB_REPOSITORY", "GITHUB_WORKFLOW", "GITHUB_SERVER_URL",
    "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "HEALTH_WORKFLOW", "HEALTH_ENVIRONMENT"];
  if (required.some((key) => !env[key])) throw new Error("Missing health notification metadata.");

  const title = `CI health failure: ${env.HEALTH_WORKFLOW}`;
  const endpoint = `repos/${env.GITHUB_REPOSITORY}/issues`;
  const body = [
    `Workflow: ${env.GITHUB_WORKFLOW} (${env.HEALTH_WORKFLOW})`,
    `Environment: ${env.HEALTH_ENVIRONMENT}`,
    `Run URL: ${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`,
    `Failure time (UTC): ${failureTime.toISOString()}`,
  ].join("\n");

  gh(["label", "create", ISSUE_LABEL, "--repo", env.GITHUB_REPOSITORY,
    "--color", ISSUE_LABEL_COLOR, "--description", "Scheduled CI health failures", "--force"]);

  // Filter on the server and retain only one page plus the best match.
  let existing;
  for (let page = 1; ; page++) {
    /** @type {{ number: number, title: string, state: string, closed_at: string | null, user: { login: string }, labels: { name: string }[], pull_request?: object }[]} */
    const issues = JSON.parse(gh(["api",
      `${endpoint}?state=all&labels=${ISSUE_LABEL}&creator=${encodeURIComponent(ISSUE_CREATOR)}&per_page=${ISSUES_PER_PAGE}&page=${page}`,
    ]));
    for (const issue of issues) {
      if (issue.pull_request || issue.title !== title || issue.user?.login !== ISSUE_CREATOR
        || !issue.labels?.some((label) => label.name === ISSUE_LABEL)) continue;
      if (issue.state === "open") {
        existing = issue;
        break;
      }
      if (!existing || (issue.closed_at ?? "") > (existing.closed_at ?? "")) existing = issue;
    }
    if (existing?.state === "open" || issues.length < ISSUES_PER_PAGE) break;
  }

  if (!existing) {
    gh(["api", endpoint, "--method", "POST", "--input", "-", "--silent"], {
      title, body, labels: [ISSUE_LABEL],
    });
    return;
  }
  if (existing.state === "closed") {
    gh(["api", `${endpoint}/${existing.number}`, "--method", "PATCH", "--input", "-", "--silent"], {
      state: "open",
    });
  }
  gh(["api", `${endpoint}/${existing.number}/comments`, "--method", "POST", "--input", "-", "--silent"], { body });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    notifyHealthFailure();
  } catch (error) {
    const code = error.code ?? error.status ?? "unknown";
    const firstLine = error.stderr?.toString().split(/\r?\n/, 1)[0];
    console.error(`Health failure notification failed (${code}): ${firstLine || "Check the notification job permissions and GitHub API availability."}`);
    process.exitCode = 1;
  }
}
