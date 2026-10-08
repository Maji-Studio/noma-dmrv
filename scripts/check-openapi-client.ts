import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

async function checkClient() {
  const directory = await mkdtemp(join(tmpdir(), "noma-openapi-client-"));
  const client = join(directory, "client.ts");
  try {
    execFileSync("openapi-typescript", ["openapi/v1.json", "--output", client], { stdio: "inherit" });
    execFileSync(process.execPath, [
      require.resolve("typescript/bin/tsc"), client,
      "--noEmit", "--strict", "--target", "ES2017",
      "--lib", "dom,dom.iterable,esnext", "--module", "esnext", "--moduleResolution", "bundler",
    ], { stdio: "inherit" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void checkClient().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
