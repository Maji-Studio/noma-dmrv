import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ missingEnv: "" }));
const EXIT_FAILURE = new Error("drift check exited");

vi.mock("child_process", () => ({ spawnSync: () => ({ status: 0 }) }));
vi.mock("./env-tpl-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./env-tpl-utils")>()),
  parseTemplate: () => [{ name: "ISOMETRIC_ENVIRONMENT", opField: "ISOMETRIC_ENVIRONMENT" }],
  templateOpFieldNames: () => new Set(["ISOMETRIC_ENVIRONMENT"]),
  readWorkflowOpReferences: () => new Map(),
  fetchItemFieldNames: (env: string) => new Set(env === mocks.missingEnv ? [] : ["ISOMETRIC_ENVIRONMENT"]),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.missingEnv = "";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => { throw EXIT_FAILURE; });
});

it.each(["staging", "production"])("fails drift checking when %s lacks ISOMETRIC_ENVIRONMENT", async (env) => {
  mocks.missingEnv = env;

  await expect(import("./check-env-drift")).rejects.toThrow(EXIT_FAILURE);

  expect(process.exit).toHaveBeenCalledWith(1);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("(REQUIRED"));
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("ISOMETRIC_ENVIRONMENT"));
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Drift check failed"));
});

it("passes drift checking when deployed items include ISOMETRIC_ENVIRONMENT", async () => {
  await import("./check-env-drift");

  expect(process.exit).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith("No broken required or workflow references.");
});
