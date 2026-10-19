import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { hashOAuthAccessToken } from "./oauth-token-hash";

it("matches the installed provider's own token storage hasher with the prefix stripped", async () => {
  const require = createRequire(import.meta.url);
  const directory = dirname(require.resolve("@better-auth/oauth-provider"));
  const file = (await readdir(directory)).find(name => name.startsWith("utils-") && name.endsWith(".mjs"))!;
  // The pinned provider exports its internal storeToken under D in this chunk.
  const { D: storeToken } = await import(/* @vite-ignore */ pathToFileURL(join(directory, file)).href);
  const body = "synthetic-access-token-for-hash-compatibility";
  expect(await hashOAuthAccessToken(`noma_oat_${body}`)).toBe(await storeToken("hashed", body, "access_token"));
  expect(await hashOAuthAccessToken(`noma_oat_${body}`)).not.toBe(await storeToken("hashed", `noma_oat_${body}`, "access_token"));
});
