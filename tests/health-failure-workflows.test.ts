import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

type Job = {
  if?: string;
  needs?: string[];
  uses?: string;
  with?: Record<string, string>;
  permissions?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress": boolean };
  steps?: { run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> }[];
};
type Workflow = {
  on: {
    schedule?: unknown;
    workflow_dispatch?: { inputs: Record<string, { type: string; default: boolean }> };
    workflow_call?: { inputs: Record<string, { type: string; required: boolean }> };
  };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};
const workflows = [
  { file: "storage-health.yml", check: "smoke", environment: "staging" },
  { file: "isometric-health.yml", check: "ping", environment: "staging / Isometric sandbox" },
  { file: "e2e-live.yml", check: "playwright-live", environment: "ephemeral CI / Isometric sandbox" },
];
const notifier = load(readFileSync(new URL("../.github/workflows/health-failure-notify.yml", import.meta.url), "utf8")) as Workflow;

function enabled(job: Job, event: string, results = ["success", "skipped"], force = false, repairCors = false) {
  const expression = job.if!.replace(/^\$\{\{\s*|\s*\}\}$/g, "").replaceAll("needs.*.result", "results");
  return runInNewContext(expression, {
    github: { event_name: event }, inputs: { force_failure: force, repair_cors: repairCors }, results,
    always: () => true, contains: (values: string[], value: string) => values.includes(value),
  });
}

describe("reusable health failure notifier", () => {
  const notification = notifier.jobs["notify-failure"];

  it("accepts workflow metadata and runs the shared notifier", () => {
    expect(Object.keys(notifier.on)).toEqual(["workflow_call"]);
    expect(notifier.on.workflow_call?.inputs).toEqual({
      "workflow-file": { description: "Health workflow file name", type: "string", required: true },
      environment: { description: "Environment checked by the health workflow", type: "string", required: true },
    });
    expect(Object.keys(notifier.jobs)).toEqual(["notify-failure"]);
    expect(notification.if).toBe("${{ always() }}");
    expect(notification.steps).toHaveLength(2);
    expect(notification.steps?.at(-1)).toEqual({
      name: "Open or reopen the workflow failure issue",
      run: "node scripts/notify-health-failure.mjs",
      env: {
        GH_TOKEN: "${{ github.token }}",
        HEALTH_WORKFLOW: "${{ inputs.workflow-file }}",
        HEALTH_ENVIRONMENT: "${{ inputs.environment }}",
      },
    });
  });

  it("inherits caller permissions and serializes updates for each workflow", () => {
    expect(notifier.permissions).toBeUndefined();
    expect(notification.permissions).toBeUndefined();
    expect(notification.concurrency).toEqual({ group: "health-failure-${{ github.workflow }}", "cancel-in-progress": false });
    const checkout = notification.steps?.[0];
    expect(checkout?.uses).toMatch(/^actions\/checkout@[a-f0-9]{40}$/);
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });
});

describe.each(workflows)("$file health notifications", ({ file, check, environment }) => {
  const workflow = load(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8")) as Workflow;
  const notification = workflow.jobs["notify-failure"];
  const probe = workflow.jobs["notification-probe"];

  it("notifies scheduled failures and cancellations, and only forced manual failures", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(notification.needs).toEqual([check, "notification-probe"]);
    expect(notification.if).toContain("always()");
    for (const event of ["schedule", "workflow_dispatch", "pull_request", "push"]) {
      for (const force of [false, true]) {
        for (const results of [
          ["success", "skipped"], ["skipped", "success"], ["skipped", "skipped"],
          ["failure", "skipped"], ["skipped", "failure"],
          ["cancelled", "skipped"], ["skipped", "cancelled"],
        ]) {
          const shouldNotify = (event === "schedule" && results.some((result) => ["failure", "cancelled"].includes(result)))
            || (event === "workflow_dispatch" && force && results.includes("failure"));
          expect(enabled(notification, event, results, force)).toBe(shouldNotify);
        }
      }
    }
    expect(notification.uses).toBe("./.github/workflows/health-failure-notify.yml");
    expect(notification.with).toEqual({ "workflow-file": file, environment });
    expect(notification.steps).toBeUndefined();
    expect(notification.concurrency).toBeUndefined();
  });

  if (file === "storage-health.yml") {
    it("keeps failed CORS repair dispatches quiet", () => {
      expect(enabled(notification, "workflow_dispatch", ["failure", "skipped"], false, true)).toBe(false);
    });
  }

  it("grants issue-write permission only to the calling job", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(notification.permissions).toEqual({ contents: "read", issues: "write" });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== "notify-failure") expect(job.permissions?.issues).toBeUndefined();
      for (const step of (job.steps ?? []).filter((step) => step.uses)) {
        expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
        if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false);
      }
    }
  });

  it("provides a dispatch-only failing probe that skips all real health work", () => {
    expect(workflow.on.workflow_dispatch?.inputs.force_failure).toMatchObject({ type: "boolean", default: false });
    expect(enabled(probe, "workflow_dispatch", undefined, true)).toBe(true);
    expect(enabled(probe, "schedule", undefined, true)).toBe(false);
    expect(enabled(probe, "workflow_dispatch")).toBe(false);
    expect(enabled(workflow.jobs[check], "workflow_dispatch", undefined, true)).toBe(false);
    expect(enabled(workflow.jobs[check], "schedule")).toBe(true);
    expect(probe.permissions).toEqual({});
    expect(probe.steps).toHaveLength(1);
    const result = spawnSync("bash", ["-e", "-c", probe.steps![0].run!], { encoding: "utf8" });
    expect(result.status).toBe(1);
  });
});
