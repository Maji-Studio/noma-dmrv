import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifyHealthFailure } from "./notify-health-failure.mjs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

const env = {
  GITHUB_EVENT_NAME: "schedule",
  GITHUB_REPOSITORY: "example/noma",
  GITHUB_WORKFLOW: "Storage health",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "2",
  HEALTH_WORKFLOW: "storage-health.yml",
  HEALTH_ENVIRONMENT: "staging",
  GH_TOKEN: "must-not-appear",
  OP_SERVICE_ACCOUNT_TOKEN: "must-not-appear-either",
};
const failureTime = new Date("2026-10-15T09:33:45Z");
const title = "CI health failure: storage-health.yml";
const body = "Workflow: Storage health (storage-health.yml)\nEnvironment: staging\n"
  + "Run URL: https://github.com/example/noma/actions/runs/123/attempts/2\n"
  + "Failure time (UTC): 2026-10-15T09:33:45.000Z";
const endpoint = "repos/example/noma/issues";
const issuesPerPage = 100;
const filteredEndpoint = `${endpoint}?state=all&labels=ci-health&creator=github-actions%5Bbot%5D&per_page=${issuesPerPage}`;
const execute = vi.mocked(execFileSync);

function issue(number: number, state = "open", closed_at: string | null = null) {
  return { number, title, state, closed_at, user: { login: "github-actions[bot]" }, labels: [{ name: "ci-health" }] };
}

function fullPage(issues: unknown[]) {
  return [...issues, ...Array.from({ length: issuesPerPage - issues.length }, (_, index) => ({
    ...issue(index + issuesPerPage), title: "CI health failure: another-workflow.yml",
  }))];
}

function mockPages(...pages: unknown[][]) {
  execute.mockReturnValueOnce(""); // Ensure the label exists.
  for (const page of pages) execute.mockReturnValueOnce(JSON.stringify(page));
}

beforeEach(() => {
  execute.mockReset();
  execute.mockReturnValue("");
});

describe("health failure notifications", () => {
  it.each(["schedule", "workflow_dispatch"])("creates a labeled issue for %s with only approved metadata", (event) => {
    mockPages([]);
    notifyHealthFailure({ ...env, GITHUB_EVENT_NAME: event }, failureTime);
    expect(execute).toHaveBeenNthCalledWith(1, "gh", ["label", "create", "ci-health", "--repo", "example/noma",
      "--color", "B60205", "--description", "Scheduled CI health failures", "--force"], expect.any(Object));
    expect(execute).toHaveBeenNthCalledWith(2, "gh", ["api",
      `${filteredEndpoint}&page=1`], expect.any(Object));
    expect(execute).toHaveBeenNthCalledWith(3, "gh", ["api", endpoint,
      "--method", "POST", "--input", "-", "--silent"], expect.objectContaining({
      input: JSON.stringify({ title, body, labels: ["ci-health"] }),
    }));
    expect(execute).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(execute.mock.calls)).not.toContain("must-not-appear");
  });

  it("comments on an open exact-title issue across pages, ahead of closed matches", () => {
    mockPages(
      fullPage([issue(1, "closed", "2026-10-14T00:00:00Z"), { ...issue(2), pull_request: {} }]),
      [{ ...issue(3), title: `${title} extra` }, issue(4)],
    );
    notifyHealthFailure(env, failureTime);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenNthCalledWith(3, "gh", ["api", `${filteredEndpoint}&page=2`], expect.any(Object));
    expect(execute).toHaveBeenLastCalledWith("gh", ["api", `${endpoint}/4/comments`,
      "--method", "POST", "--input", "-", "--silent"], expect.objectContaining({
      input: JSON.stringify({ body }),
    }));
  });

  it("stops fetching pages as soon as an open match is found", () => {
    mockPages(fullPage([issue(4)]));
    notifyHealthFailure(env, failureTime);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[2][1]).toContain(`${endpoint}/4/comments`);
  });

  it("reopens the most recently closed match and comments with the new failure", () => {
    mockPages(
      fullPage([issue(10, "closed", "2026-10-01T00:00:00Z")]),
      [issue(8, "closed", "2026-10-14T00:00:00Z"), issue(11, "closed", "2026-10-10T00:00:00Z")],
    );
    notifyHealthFailure(env, failureTime);
    expect(execute).toHaveBeenCalledTimes(5);
    expect(execute).toHaveBeenNthCalledWith(4, "gh", ["api", `${endpoint}/8`,
      "--method", "PATCH", "--input", "-", "--silent"], expect.objectContaining({
      input: JSON.stringify({ state: "open" }),
    }));
    expect(execute).toHaveBeenLastCalledWith("gh", ["api", `${endpoint}/8/comments`,
      "--method", "POST", "--input", "-", "--silent"], expect.objectContaining({
      input: JSON.stringify({ body }),
    }));
  });

  it("creates when only a pull request or another workflow matches", () => {
    mockPages([
      { ...issue(2), pull_request: {} },
      { ...issue(3), title: "CI health failure: isometric-health.yml" },
    ]);
    notifyHealthFailure(env, failureTime);
    expect(execute.mock.calls[2][1]).toEqual(["api", endpoint,
      "--method", "POST", "--input", "-", "--silent"]);
  });

  it.each(["open", "closed"])("never comments on or reopens a %s title spoof by another author", (state) => {
    mockPages([{ ...issue(2, state, failureTime.toISOString()), user: { login: "untrusted-user" } }]);
    notifyHealthFailure(env, failureTime);
    expect(execute).toHaveBeenNthCalledWith(2, "gh", ["api", `${filteredEndpoint}&page=1`], expect.any(Object));
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[2][1]).toEqual(["api", endpoint,
      "--method", "POST", "--input", "-", "--silent"]);
  });

  it("ignores a bot issue without the dedicated label", () => {
    mockPages([{ ...issue(2), labels: [] }]);
    notifyHealthFailure(env, failureTime);
    expect(execute.mock.calls[2][1]).toEqual(["api", endpoint,
      "--method", "POST", "--input", "-", "--silent"]);
  });

  it.each(["pull_request", "pull_request_target", "push", ""])("never calls GitHub on %s", (event) => {
    notifyHealthFailure({ ...env, GITHUB_EVENT_NAME: event }, failureTime);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses incomplete metadata before calling GitHub", () => {
    expect(() => notifyHealthFailure({ ...env, HEALTH_ENVIRONMENT: "" }, failureTime))
      .toThrow("Missing health notification metadata");
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed if ensuring the label fails", () => {
    execute.mockImplementationOnce(() => { throw new Error("GitHub unavailable"); });
    expect(() => notifyHealthFailure(env, failureTime)).toThrow("GitHub unavailable");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not create a duplicate when a later page fails", () => {
    mockPages(fullPage([issue(1, "closed", failureTime.toISOString())]));
    execute.mockImplementationOnce(() => { throw new Error("GitHub unavailable"); });
    expect(() => notifyHealthFailure(env, failureTime)).toThrow("GitHub unavailable");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("does not create a replacement when reopening fails", () => {
    mockPages([issue(1, "closed", failureTime.toISOString())]);
    execute.mockImplementationOnce(() => { throw new Error("GitHub unavailable"); });
    expect(() => notifyHealthFailure(env, failureTime)).toThrow("GitHub unavailable");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it.each([
    { code: "ENOBUFS", status: null, stderr: "gh: output buffer exceeded\nextra diagnostic" },
    { code: undefined, status: 1, stderr: Buffer.from("gh: permission denied\r\nextra diagnostic") },
  ])("prints the error code and only the first stderr line, then exits nonzero ($code, $status)", async (details) => {
    const error = Object.assign(new Error("Full error and response must not appear"), details);
    execute.mockImplementationOnce(() => { throw error; });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const previousArgv = process.argv[1];
    const previousExitCode = process.exitCode;
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    process.argv[1] = fileURLToPath(new URL("./notify-health-failure.mjs", import.meta.url));
    try {
      await import("./notify-health-failure.mjs");
      expect(process.exitCode).toBe(1);
      expect(log).toHaveBeenCalledExactlyOnceWith(
        `Health failure notification failed (${details.code ?? details.status}): ${details.stderr.toString().split(/\r?\n/)[0]}`,
      );
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/must-not-appear|extra diagnostic|Full error/);
    } finally {
      process.argv[1] = previousArgv;
      process.exitCode = previousExitCode;
      vi.unstubAllEnvs();
      log.mockRestore();
    }
  });
});
