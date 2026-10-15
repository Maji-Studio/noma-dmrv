import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

type Job = {
  if?: string;
  needs?: string[];
  permissions?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress": boolean };
  steps: { run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> }[];
};
type Workflow = {
  on: { schedule: unknown; workflow_dispatch: { inputs: Record<string, { type: string; default: boolean }> } };
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};
const workflows = [
  { file: "storage-health.yml", check: "smoke", environment: "staging" },
  { file: "isometric-health.yml", check: "ping", environment: "staging / Isometric sandbox" },
  { file: "e2e-live.yml", check: "playwright-live", environment: "ephemeral CI / Isometric sandbox" },
];

function enabled(job: Job, event: string, results = ["success", "skipped"], force = false) {
  const expression = job.if!.replace(/^\$\{\{\s*|\s*\}\}$/g, "").replaceAll("needs.*.result", "results");
  return runInNewContext(expression, {
    github: { event_name: event }, inputs: { force_failure: force }, results,
    always: () => true, contains: (values: string[], value: string) => values.includes(value),
  });
}

describe.each(workflows)("$file health notifications", ({ file, check, environment }) => {
  const workflow = load(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8")) as Workflow;
  const notification = workflow.jobs["notify-failure"];
  const probe = workflow.jobs["notification-probe"];

  it("notifies failed or cancelled scheduled or dispatched runs, including timeouts and manual cancellation", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(notification.needs).toEqual([check, "notification-probe"]);
    expect(notification.if).toContain("always()");
    for (const event of ["schedule", "workflow_dispatch", "pull_request", "push"]) {
      for (const results of [
        ["success", "skipped"], ["skipped", "success"], ["skipped", "skipped"],
        ["failure", "skipped"], ["skipped", "failure"],
        ["cancelled", "skipped"], ["skipped", "cancelled"],
      ]) {
        const shouldNotify = ["schedule", "workflow_dispatch"].includes(event)
          && results.some((result) => ["failure", "cancelled"].includes(result));
        expect(enabled(notification, event, results)).toBe(shouldNotify);
      }
    }
    expect(notification.steps.at(-1)).toEqual({
      name: "Open or reopen the workflow failure issue",
      run: "node scripts/notify-health-failure.mjs",
      env: { GH_TOKEN: "${{ github.token }}", HEALTH_WORKFLOW: file, HEALTH_ENVIRONMENT: environment },
    });
  });

  it("isolates issue-write permission and serializes updates for each workflow", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(notification.permissions).toEqual({ contents: "read", issues: "write" });
    expect(notification.concurrency).toEqual({ group: "health-failure-${{ github.workflow }}", "cancel-in-progress": false });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== "notify-failure") expect(job.permissions?.issues).toBeUndefined();
      for (const step of job.steps.filter((step) => step.uses)) {
        expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
        if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false);
      }
    }
  });

  it("provides a dispatch-only failing probe that skips all real health work", () => {
    expect(workflow.on.workflow_dispatch.inputs.force_failure).toMatchObject({ type: "boolean", default: false });
    expect(enabled(probe, "workflow_dispatch", undefined, true)).toBe(true);
    expect(enabled(probe, "schedule", undefined, true)).toBe(false);
    expect(enabled(probe, "workflow_dispatch")).toBe(false);
    expect(enabled(workflow.jobs[check], "workflow_dispatch", undefined, true)).toBe(false);
    expect(enabled(workflow.jobs[check], "schedule")).toBe(true);
    expect(probe.permissions).toEqual({});
    expect(probe.steps).toHaveLength(1);
    const result = spawnSync("bash", ["-e", "-c", probe.steps[0].run!], { encoding: "utf8" });
    expect(result.status).toBe(1);
  });
});
