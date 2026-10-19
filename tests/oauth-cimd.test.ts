import dns from "node:dns/promises";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { LookupAddress } from "node:dns";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";

const memory = vi.hoisted(() => ({ data: {} as Record<string, unknown[]> }));

vi.mock("@/data-access/oauth-provider", () => ({
  findOAuthClientScopes: async (clientId: string) => {
    const client = (memory.data.oauthClient as { clientId: string; scopes?: string[] }[]).find(client => client.clientId === clientId);
    return client ? client.scopes ?? [] : undefined;
  },
  findOAuthClientResources: async (clientId: string) => (memory.data.oauthClientResource as { clientId: string; resourceId: string }[])
    .filter(link => link.clientId === clientId).map(link => ({ resource: link.resourceId })),
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter(memory.data) };
});

const CLIENT_ID = "https://claude.ai/client.json";
const REDIRECT_URI = "https://claude.ai/callback";
const PUBLIC_IP = "93.184.216.34";
const TIMEOUT_MS = 5_000;
const UNLISTED_CLIENT_COUNT = 35;
const OVER_LIMIT_BYTES = 5 * 1024 + 1;
let status: number;
let headers: Record<string, string>;
let body: string;
let stalled: boolean;
let addresses: LookupAddress[];
let lookup: MockInstance<typeof dns.lookup>;
let request: MockInstance<typeof https.request>;

beforeEach(() => {
  vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true");
  vi.stubEnv("OAUTH_CIMD_CLIENT_IDS", CLIENT_ID);
  memory.data = { oauthClient: [], oauthResource: [], oauthClientResource: [], session: [], user: [], verification: [] };
  vi.resetModules();
  status = 200;
  headers = { "content-type": "application/json", "cache-control": "max-age=300" };
  body = JSON.stringify({ client_id: CLIENT_ID, client_name: "E2E connector", redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"], scope: "feedstocks:read offline_access" });
  stalled = false;
  addresses = [{ address: PUBLIC_IP, family: 4 }];
  // This boundary uses lookup's all:true overload, rather than its final
  // single-address overload which spyOn's TypeScript inference selects.
  lookup = vi.spyOn(dns, "lookup").mockImplementation((async () => addresses) as unknown as typeof dns.lookup);
  // The real Node transport still constructs its HTTPS request, including the
  // pinned lookup, Host and SNI. Only the socket boundary is replaced.
  request = vi.spyOn(https, "request").mockImplementation((...args: unknown[]) => {
    const options = args[1] as https.RequestOptions;
    const callback = args[2] as (response: PassThrough) => void;
    const outgoing = Object.assign(new EventEmitter(), { end() {
      if (stalled) {
        options.signal?.addEventListener("abort", () => outgoing.emit("error", new Error("aborted")), { once: true });
        return;
      }
      const incoming = Object.assign(new PassThrough(), { statusCode: status, headers, statusMessage: "Test" });
      callback(incoming);
      incoming.end(headers["content-length"] ? undefined : body);
    } });
    return outgoing as ReturnType<typeof https.request>;
  });
  syncBuiltinESMExports();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.unstubAllEnvs();
});

async function authorize(clientId = CLIENT_ID, redirectUri = REDIRECT_URI, includeResource = true, includeScope = true) {
  const { auth } = await import("@/lib/auth/better-auth");
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    scope: "feedstocks:read offline_access", resource: "http://localhost:3100/api/mcp",
    code_challenge: "a".repeat(43), code_challenge_method: "S256" });
  if (!includeScope) query.delete("scope");
  if (!includeResource) query.delete("resource");
  return auth.handler(new Request(`http://localhost:3100/api/auth/oauth2/authorize?${query}`));
}

async function expectRefused(clientId = CLIENT_ID, redirectUri = REDIRECT_URI, description?: string, code = "invalid_client") {
  const response = await authorize(clientId, redirectUri);
  const location = response.headers.get("location");
  // A safe refusal is a protocol error or the provider's own error page,
  // never a login continuation or an unvalidated client redirect.
  if (location) {
    const errorUrl = new URL(location, "http://localhost:3100");
    expect(errorUrl.pathname).toBe("/api/auth/error");
    expect(errorUrl.searchParams.get("error")).toBe(code);
    if (description) expect(errorUrl.searchParams.get("error_description")).toContain(description);
  } else {
    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error).toBe(code);
    if (description) expect(error.error_description).toContain(description);
  }
}

it("discovers an allowed public client and links only the MCP resource", async () => {
  const response = await authorize();
  expect(response.status).toBe(302);
  expect(new URL(response.headers.get("location")!, "http://localhost:3100").pathname).toBe("/login");
  expect(lookup).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
  const { auth } = await import("@/lib/auth/better-auth");
  const context = await auth.$context;
  const links = await context.adapter.findMany<{ resourceId: string }>({ model: "oauthClientResource",
    where: [{ field: "clientId", value: CLIENT_ID }] });
  expect(links.map(link => link.resourceId)).toEqual(["http://localhost:3100/api/mcp"]);
});

it.each(["https://claude.ai/other.json", "https://claude.ai/client.json/", "http://claude.ai/client.json"])("refuses unlisted or HTTP identity %s before DNS/fetch", async clientId => {
  await expectRefused(clientId);
  expect(lookup).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

const forbiddenAddresses = [
  "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
  "::1", "fc00::1", "::ffff:127.0.0.1", "0.0.0.0", "100.64.0.1", "192.0.2.1", "fe80::1", "::", "2001:db8::1", "ff02::1", "::ffff:10.0.0.1",
];
it.each(forbiddenAddresses)("refuses literal %s before DNS/fetch", async address => {
  const host = address.includes(":") ? `[${address}]` : address;
  await expectRefused(`https://${host}/client.json`);
  expect(lookup).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
it.each(forbiddenAddresses)("refuses DNS answer %s before HTTPS", async address => {
  addresses = [{ address, family: address.includes(":") ? 6 : 4 }];
  await expectRefused();
  expect(lookup).toHaveBeenCalledOnce();
  expect(request).not.toHaveBeenCalled();
});
it("refuses mixed public/private DNS answers", async () => {
  addresses = [{ address: PUBLIC_IP, family: 4 }, { address: "169.254.169.254", family: 4 }];
  await expectRefused();
  expect(request).not.toHaveBeenCalled();
});
it("pins the public answer and rejects a later private resolution", async () => {
  headers["cache-control"] = "no-store";
  expect(new URL((await authorize()).headers.get("location")!, "http://localhost:3100").pathname).toBe("/login");
  const options = request.mock.calls[0][1] as https.RequestOptions;
  expect(options).toMatchObject({ agent: false, servername: "claude.ai", headers: { host: "claude.ai" } });
  const pin = options.lookup!;
  const legacy = vi.fn();
  const all = vi.fn();
  pin("claude.ai", {}, legacy);
  pin("claude.ai", { all: true }, all);
  expect(legacy).toHaveBeenCalledWith(null, PUBLIC_IP, 4);
  expect(all).toHaveBeenCalledWith(null, [{ address: PUBLIC_IP, family: 4 }]);
  expect(lookup).toHaveBeenCalledOnce();
  addresses = [{ address: "127.0.0.1", family: 4 }];
  await expectRefused();
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledOnce();
});

it.each([301, 302, 307])("does not follow HTTP %i redirects", async redirectStatus => {
  status = redirectStatus;
  headers.location = "https://169.254.169.254/client.json";
  await expectRefused();
  expect(request).toHaveBeenCalledOnce();
});
it.each(["declared", "streamed"])("refuses over 5 KB %s bodies", async kind => {
  if (kind === "declared") headers["content-length"] = String(OVER_LIMIT_BYTES);
  else body = JSON.stringify({ ...JSON.parse(body), client_name: "A".repeat(OVER_LIMIT_BYTES) });
  await expectRefused(CLIENT_ID, REDIRECT_URI, "exceeds 5KB size limit");
});
it("aborts a metadata request after five seconds", async () => {
  stalled = true;
  // Initialize auth before controlling timers, then wait for the transport.
  await import("@/lib/auth/better-auth").then(({ auth }) => auth.$context);
  vi.useFakeTimers();
  const pending = expectRefused(CLIENT_ID, REDIRECT_URI, "timed out after 5000ms");
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
  await pending;
  expect((request.mock.calls[0][1] as https.RequestOptions).signal?.aborted).toBe(true);
});
it.each([
  { client_id: "https://claude.ai/other.json" }, { client_secret: "forbidden-fixture-value" },
  { client_name: undefined }, { redirect_uris: undefined },
])("refuses an invalid MCP metadata document %#", async changes => {
  body = JSON.stringify({ ...JSON.parse(body), ...changes });
  await expectRefused();
});
it("refuses a redirect URI absent from the document", async () => {
  await expectRefused(CLIENT_ID, "https://claude.ai/other-callback", "invalid redirect uri", "invalid_redirect");
});
it("refuses a disabled persisted client even with fresh cached metadata", async () => {
  expect(new URL((await authorize()).headers.get("location")!, "http://localhost:3100").pathname).toBe("/login");
  const { auth } = await import("@/lib/auth/better-auth");
  await (await auth.$context).adapter.update({ model: "oauthClient",
    where: [{ field: "clientId", value: CLIENT_ID }], update: { disabled: true } });
  await expectRefused(CLIENT_ID, REDIRECT_URI, "client is disabled", "client_disabled");
  expect(lookup).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
});

it("unlisted identities cannot spend the listed client's cold-cache fetch quota", async () => {
  for (let i = 0; i < UNLISTED_CLIENT_COUNT; i++) await authorize(`https://claude.ai/unlisted-${i}.json`);
  const response = await authorize();
  expect(new URL(response.headers.get("location")!, "http://localhost:3100").pathname).toBe("/login");
  expect(lookup).toHaveBeenCalledOnce();
});

it("refuses a persisted client removed from the allowlist", async () => {
  expect(new URL((await authorize()).headers.get("location")!, "http://localhost:3100").pathname).toBe("/login");
  vi.stubEnv("OAUTH_CIMD_CLIENT_IDS", "https://claude.ai/another.json");
  vi.resetModules();
  await expectRefused(CLIENT_ID, REDIRECT_URI, "client not found");
  expect(request).toHaveBeenCalledOnce();
});

it("bounds stalled DNS by the metadata deadline and never dispatches late HTTPS", async () => {
  let finishDns!: (answers: LookupAddress[]) => void;
  lookup.mockImplementation((() => new Promise<LookupAddress[]>(resolve => { finishDns = resolve; })) as unknown as typeof dns.lookup);
  await import("@/lib/auth/better-auth").then(({ auth }) => auth.$context);
  vi.useFakeTimers();
  let settled = false;
  const pending = expectRefused(CLIENT_ID, REDIRECT_URI, "timed out after 5000ms").then(() => { settled = true; });
  await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
  expect(settled).toBe(true);
  await pending;
  finishDns([{ address: PUBLIC_IP, family: 4 }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(request).not.toHaveBeenCalled();
});

it("binds a listed CIMD client's first authorization without resource to MCP", async () => {
  const response = await authorize(CLIENT_ID, REDIRECT_URI, false);
  expect(response.status).toBe(302);
  const login = new URL(response.headers.get("location")!, "http://localhost:3100");
  expect(login.pathname).toBe("/login");
  expect(decodeURIComponent(login.search)).toContain("http://localhost:3100/api/mcp");
  const { auth } = await import("@/lib/auth/better-auth");
  const links = await (await auth.$context).adapter.findMany<{ resourceId: string }>({ model: "oauthClientResource",
    where: [{ field: "clientId", value: CLIENT_ID }] });
  expect(links.map(link => link.resourceId)).toEqual(["http://localhost:3100/api/mcp"]);
});
it("refuses an unlisted CIMD client without resource before fetching metadata", async () => {
  const response = await authorize("https://claude.ai/unlisted.json", REDIRECT_URI, false);
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("invalid_target");
  expect(request).not.toHaveBeenCalled();
});

it("defaults the first scope-less listed CIMD authorization to reads and offline access", async () => {
  const { OAUTH_READ_SCOPES, OAUTH_GRANTABLE_SCOPES } = await import("@/lib/auth/oauth-scopes");
  body = JSON.stringify({ ...JSON.parse(body), scope: [...OAUTH_GRANTABLE_SCOPES, "offline_access"].join(" ") });
  const response = await authorize(CLIENT_ID, REDIRECT_URI, false, false);
  expect(response.status).toBe(302);
  const login = new URL(response.headers.get("location")!, "http://localhost:3100");
  expect(login.pathname).toBe("/login");
  expect(login.searchParams.get("scope")?.split(" ").sort()).toEqual([...OAUTH_READ_SCOPES, "offline_access"].sort());
});
