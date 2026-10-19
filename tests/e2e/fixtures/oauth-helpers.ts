/**
 * OAuth E2E fixtures: a preregistered client with its resource link, a person
 * in several organizations, and ready-made connections. Everything uses the
 * `E2E` / `e2e-` naming contract (docs/testing.md) and removes itself.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import { createDbConnection } from "./db";

export const E2E_OAUTH_PASSWORD = "TestPassword123!";
export const E2E_OAUTH_CALLBACK_PATH = "/e2e-oauth-callback";
const ID_LENGTH = 8;

function appOrigin(): string {
  return new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100").origin;
}

export const oauthResources = () => ({ mcp: `${appOrigin()}/api/mcp`, rest: `${appOrigin()}/api/v1` });

export interface E2EOAuthClient {
  clientId: string;
  redirectUri: string;
  resource: string;
  /** True when the helper inserted the shared resource row, so cleanup may remove it. */
  ownsResource: boolean;
}

/** Registers `E2E OAuth client` straight in the database, linked to the MCP resource. */
export async function createE2EOAuthClient(scopes: string[]): Promise<E2EOAuthClient> {
  const { db, pool } = createDbConnection();
  try {
    const suffix = randomUUID().slice(0, ID_LENGTH);
    const resource = oauthResources().mcp;
    const clientId = `https://e2e-oauth.example.test/client/${suffix}`;
    const redirectUri = `${appOrigin()}${E2E_OAUTH_CALLBACK_PATH}`;
    const now = new Date();
    const [inserted] = await db.insert(schema.oauthResources)
      .values({ id: `e2e-oauth-resource-${suffix}`, identifier: resource, name: "E2E OAuth MCP resource", createdAt: now, updatedAt: now })
      .onConflictDoNothing().returning({ id: schema.oauthResources.id });
    await db.insert(schema.oauthClients).values({
      id: `e2e-oauth-client-${suffix}`, clientId, name: "E2E OAuth client", redirectUris: [redirectUri], scopes,
      tokenEndpointAuthMethod: "none", grantTypes: ["authorization_code", "refresh_token"], responseTypes: ["code"],
      requirePKCE: true, disabled: false, createdAt: now, updatedAt: now,
    });
    await db.insert(schema.oauthClientResources).values({ id: `e2e-oauth-link-${suffix}`, clientId, resourceId: resource, createdAt: now });
    return { clientId, redirectUri, resource, ownsResource: !!inserted };
  } finally { await pool.end(); }
}

export async function removeE2EOAuthClient(client: E2EOAuthClient): Promise<void> {
  const { db, pool } = createDbConnection();
  try {
    // Deleting the client cascades its grants, consents, tokens and resource link.
    await db.delete(schema.oauthClients).where(eq(schema.oauthClients.clientId, client.clientId));
    if (client.ownsResource) await db.delete(schema.oauthResources).where(eq(schema.oauthResources.identifier, client.resource));
  } finally { await pool.end(); }
}

export interface E2EOAuthPerson {
  userId: string;
  email: string;
  password: string;
  organizations: { id: string; name: string; memberId: string }[];
}

/** A verified person who belongs to `count` organizations (Member in each), and an optional disabled one. */
export async function createE2EOAuthPerson(count: number, options: { apiDisabledIndex?: number } = {}): Promise<E2EOAuthPerson> {
  const { db, pool } = createDbConnection();
  try {
    const suffix = randomUUID().slice(0, ID_LENGTH);
    const userId = `e2e-oauth-user-${suffix}`;
    const email = `e2e-oauth-${suffix}@e2e.local`;
    await db.insert(schema.users).values({ id: userId, email, name: "E2E OAuth Person", role: "user", emailVerified: true });
    await db.insert(schema.accounts).values({
      id: `e2e-oauth-account-${suffix}`, userId, accountId: userId, providerId: "credential", password: await hashPassword(E2E_OAUTH_PASSWORD),
    });
    const organizations = [];
    for (let index = 0; index < count; index += 1) {
      const id = `e2e-oauth-org-${suffix}-${index}`;
      const name = `E2E OAuth Organization ${String.fromCharCode(65 + index)}`;
      const memberId = `e2e-oauth-member-${suffix}-${index}`;
      await db.insert(schema.organizations).values({ id, slug: id, name });
      await db.insert(schema.members).values({ id: memberId, organizationId: id, userId, role: "member" });
      if (options.apiDisabledIndex === index) {
        await db.insert(schema.organizationApiAccess).values({ organizationId: id, enabled: false, changedByUserId: userId });
      }
      organizations.push({ id, name, memberId });
    }
    return { userId, email, password: E2E_OAUTH_PASSWORD, organizations };
  } finally { await pool.end(); }
}

export async function removeE2EOAuthPerson(person: E2EOAuthPerson): Promise<void> {
  const { db, pool } = createDbConnection();
  try {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, person.userId));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, person.organizations.map(org => org.id)));
    await db.delete(schema.accounts).where(eq(schema.accounts.userId, person.userId));
    await db.delete(schema.users).where(eq(schema.users.id, person.userId));
  } finally { await pool.end(); }
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** The provider's authorize URL for the client, with PKCE and a state to echo. */
export function authorizeUrl(client: E2EOAuthClient, scope: string, state: string): string {
  const query = new URLSearchParams({
    client_id: client.clientId, redirect_uri: client.redirectUri, response_type: "code", scope, state,
    resource: client.resource, code_challenge: pkcePair().challenge, code_challenge_method: "S256",
  });
  return `/api/auth/oauth2/authorize?${query}`;
}

/** A live connection for an existing member, as consent would have left it. */
export async function seedE2EOAuthConnection(input: {
  client: E2EOAuthClient; organizationId: string; userId: string; scopes: string[]; lastUsedAt?: Date;
}): Promise<string> {
  const { db, pool } = createDbConnection();
  try {
    const [member] = await db.select({ id: schema.members.id }).from(schema.members)
      .where(and(eq(schema.members.organizationId, input.organizationId), eq(schema.members.userId, input.userId)));
    const grantId = `e2e-oauth-grant-${randomUUID().slice(0, ID_LENGTH)}`;
    const now = new Date();
    await db.insert(schema.oauthGrants).values({
      id: grantId, organizationId: input.organizationId, userId: input.userId, memberId: member.id, clientId: input.client.clientId,
      resource: input.client.resource, createdAt: now, lastUsedAt: input.lastUsedAt ?? now,
    });
    await db.insert(schema.oauthConsents).values({
      id: `e2e-oauth-consent-${randomUUID().slice(0, ID_LENGTH)}`, clientId: input.client.clientId, userId: input.userId, referenceId: grantId,
      resources: [input.client.resource], scopes: input.scopes, createdAt: now, updatedAt: now,
    });
    return grantId;
  } finally { await pool.end(); }
}

export async function readE2EOAuthGrant(grantId: string) {
  const { db, pool } = createDbConnection();
  try {
    const [grant] = await db.select().from(schema.oauthGrants).where(eq(schema.oauthGrants.id, grantId));
    return grant;
  } finally { await pool.end(); }
}

/** The scopes the stored consent holds for one person and client. */
export async function readE2EOAuthConsentScopes(clientId: string, userId: string): Promise<string[]> {
  const { db, pool } = createDbConnection();
  try {
    const rows = await db.select({ scopes: schema.oauthConsents.scopes }).from(schema.oauthConsents)
      .where(and(eq(schema.oauthConsents.clientId, clientId), eq(schema.oauthConsents.userId, userId)));
    return rows.flatMap(row => row.scopes);
  } finally { await pool.end(); }
}
