import { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runClaude, subscriptionEnvironment } from "./claude";
import { APPLICATION_CASES, CASES, CLAUDE_FLAGS, DELIVERY_CASES, DOCUMENT_CASES, LAB_CASES, STOCK_CASES } from "./config";
import { startProcess } from "./process";

vi.mock("./process", () => ({ startProcess: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(startProcess).mockReset();
});

it("passes only runtime and subscription authentication variables to evaluated sessions", () => {
  const allowed = {
    PATH: "/usr/bin:/bin", HOME: "/tmp/eval-home", USER: "eval-user", LOGNAME: "eval-user",
    TMPDIR: "/tmp", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", LC_CTYPE: "UTF-8",
    TERM: "xterm", CLAUDE_CONFIG_DIR: "/tmp/eval-claude", CLAUDE_CODE_OAUTH_TOKEN: "test-subscription-token",
  };
  const parent = { ...allowed, DATABASE_URL: "test-database", TEST_DATABASE_URL: "other-test-database",
    BETTER_AUTH_SECRET: "test-app-secret", STORAGE_SIGNING_SECRET: "test-storage-secret",
    SPACES_SECRET_ACCESS_KEY: "test-bucket-secret", ANTHROPIC_API_KEY: "test-api-key",
    ANTHROPIC_AUTH_TOKEN: "test-auth-token", NODE_OPTIONS: "--require=/tmp/injected.js",
    BASH_ENV: "/tmp/injected.sh", ENV: "/tmp/injected.sh", NEW_APP_SECRET: "test-future-secret" };
  expect(subscriptionEnvironment(parent)).toEqual(allowed);
  expect(parent.DATABASE_URL).toBe("test-database");
});

it("does not supply missing runtime variables or inherit the parent implicitly", () => {
  expect(subscriptionEnvironment({ PATH: "/bin", HOME: undefined })).toEqual({ PATH: "/bin" });
  expect(subscriptionEnvironment({})).toEqual({});
});

it.each([...CASES, ...LAB_CASES, ...STOCK_CASES, ...DELIVERY_CASES, ...DOCUMENT_CASES, ...APPLICATION_CASES].map(({ id }) => id))(
  "starts %s with a file-based MCP config, filtered environment and the case's working directory",
  async (caseId) => {
    const runDirectory = await mkdtemp(join(tmpdir(), "noma-mcp-launch-test-"));
    const fileDirectory = join(runDirectory, "fixture");
    const upload = caseId === "delivery-bol-upload";
    let configFile = "";
    const stop = vi.fn(async () => {});
    vi.stubEnv("DATABASE_URL", "test-database");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-app-secret");
    vi.mocked(startProcess).mockImplementation((command, args, cwd, env) => {
      expect(command).toBe("claude");
      configFile = args[args.indexOf("--mcp-config") + 1];
      expect(isAbsolute(configFile)).toBe(true);
      expect(JSON.parse(readFileSync(configFile, "utf8"))).toEqual({ mcpServers: { noma: {
        type: "http", url: "http://localhost:3199/api/mcp", headers: { Authorization: "Bearer test-case-key" },
      } } });
      expect(cwd).toBe(upload ? fileDirectory : dirname(configFile));
      expect(dirname(configFile)).not.toBe(fileDirectory);
      expect(cwd).not.toBe(process.cwd());
      expect(env).toEqual(subscriptionEnvironment(process.env));
      expect(env).not.toHaveProperty("DATABASE_URL");
      expect(env).not.toHaveProperty("BETTER_AUTH_SECRET");
      expect(args[args.indexOf("--tools") + 1]).toBe(upload ? "Bash" : "");
      expect(args[args.indexOf("--allowedTools") + 1]).toBe(upload ? "mcp__noma,Bash" : "mcp__noma");
      expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
      if (upload) expect(args[args.indexOf("--add-dir") + 1]).toBe(fileDirectory);
      else {
        expect(args).not.toContain("--add-dir");
        expect(args.slice(4, CLAUDE_FLAGS.length + 2)).toEqual(CLAUDE_FLAGS.slice(2));
      }
      return { child: new ChildProcess(), done: Promise.resolve({ exitCode: 0, spawnFailed: false }), stop };
    });
    try {
      await mkdir(fileDirectory);
      const register = vi.fn();
      const unregister = vi.fn();
      await runClaude(caseId, "Test prompt", "test-case-key", "http://localhost:3199", runDirectory,
        new AbortController().signal, register, unregister, fileDirectory);
      expect(startProcess).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledOnce();
      expect(register).toHaveBeenCalledOnce();
      expect(unregister).toHaveBeenCalledWith(register.mock.calls[0][0]);
      await expect(access(configFile)).rejects.toThrow();
      await expect(access(fileDirectory)).resolves.toBeUndefined();
    } finally {
      await rm(runDirectory, { recursive: true, force: true });
    }
  },
);
