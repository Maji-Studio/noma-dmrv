import { relations, sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { members, organizations, sessions, users } from "./auth";

export const OAUTH_REVOCATION_REASONS = [
  "disconnected", "member_changed", "member_removed", "refresh_reuse", "client_revoked", "inactive", "expired",
] as const;
export type OAuthRevocationReason = typeof OAUTH_REVOCATION_REASONS[number];

/** Better Auth 1.7.10 oauthClient model. */
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  clientDiscoveryId: text("client_discovery_id"),
  disabled: boolean("disabled").default(false),
  skipConsent: boolean("skip_consent"),
  enableEndSession: boolean("enable_end_session"),
  subjectType: text("subject_type"),
  scopes: text("scopes").array(),
  clientCredentialsScopes: text("client_credentials_scopes").array().default([]),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts").array(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: text("redirect_uris").array().notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
  backchannelLogoutUri: text("backchannel_logout_uri"),
  backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  applicationType: text("application_type"),
  jwks: text("jwks"),
  jwksUri: text("jwks_uri"),
  grantTypes: text("grant_types").array(),
  responseTypes: text("response_types").array(),
  requirePKCE: boolean("require_pkce"),
  dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
}, (table) => [
  index("oauth_clients_user_id_idx").on(table.userId),
]);

/** Better Auth 1.7.10 oauthResource model. */
export const oauthResources = pgTable("oauth_resources", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  policyVersion: integer("policy_version").default(1),
  metadata: jsonb("metadata"),
});

/** Better Auth 1.7.10 oauthClientResource model. */
export const oauthClientResources = pgTable("oauth_client_resources", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  resourceId: text("resource_id").notNull().references(() => oauthResources.identifier, { onDelete: "cascade" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at"),
}, (table) => [
  index("oauth_client_resources_client_id_idx").on(table.clientId),
  index("oauth_client_resources_resource_id_idx").on(table.resourceId),
  uniqueIndex("oauth_client_resources_client_resource_unique").on(table.clientId, table.resourceId),
]);

/** Better Auth 1.7.10 oauthRefreshToken model. */
export const oauthRefreshTokens = pgTable("oauth_refresh_tokens", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id").references(() => oauthGrants.id, { onDelete: "cascade" }),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  revoked: timestamp("revoked"),
  rotatedAt: timestamp("rotated_at"),
  rotationReplayResponse: text("rotation_replay_response"),
  rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
  authTime: timestamp("auth_time"),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
}, (table) => [
  index("oauth_refresh_tokens_client_id_idx").on(table.clientId),
  index("oauth_refresh_tokens_session_id_idx").on(table.sessionId),
  index("oauth_refresh_tokens_user_id_idx").on(table.userId),
  index("oauth_refresh_tokens_reference_id_idx").on(table.referenceId),
  index("oauth_refresh_tokens_authorization_code_id_idx").on(table.authorizationCodeId),
  index("oauth_refresh_tokens_expires_at_idx").on(table.expiresAt),
]);

/** Better Auth 1.7.10 oauthAccessToken model. */
export const oauthAccessTokens = pgTable("oauth_access_tokens", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id").references(() => oauthGrants.id, { onDelete: "cascade" }),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  revoked: timestamp("revoked"),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
}, (table) => [
  index("oauth_access_tokens_client_id_idx").on(table.clientId),
  index("oauth_access_tokens_session_id_idx").on(table.sessionId),
  index("oauth_access_tokens_user_id_idx").on(table.userId),
  index("oauth_access_tokens_reference_id_idx").on(table.referenceId),
  index("oauth_access_tokens_authorization_code_id_idx").on(table.authorizationCodeId),
  index("oauth_access_tokens_refresh_id_idx").on(table.refreshId),
  index("oauth_access_tokens_expires_at_idx").on(table.expiresAt),
]);

/** Better Auth 1.7.10 oauthConsent model. */
export const oauthConsents = pgTable("oauth_consents", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id").notNull().references(() => oauthGrants.id, { onDelete: "cascade" }),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (table) => [
  index("oauth_consents_client_id_idx").on(table.clientId),
  index("oauth_consents_user_id_idx").on(table.userId),
  uniqueIndex("oauth_consents_client_user_reference_unique").on(table.clientId, table.userId, table.referenceId),
  index("oauth_consents_reference_id_idx").on(table.referenceId),
]);

/** Better Auth 1.7.10 oauthClientAssertion model. */
export const oauthClientAssertions = pgTable("oauth_client_assertions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("oauth_client_assertions_expires_at_idx").on(table.expiresAt),
]);

/** One immutable organization, person, membership, client and audience binding. */
export const oauthGrants = pgTable("oauth_grants", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  memberId: text("member_id").references(() => members.id, { onDelete: "set null" }),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  resource: text("resource").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  revokedAt: timestamp("revoked_at"),
  revocationReason: text("revocation_reason").$type<OAuthRevocationReason>(),
}, (table) => [
  check("oauth_grants_revocation_reason_check", sql`${table.revocationReason} in (${sql.join(
    OAUTH_REVOCATION_REASONS.map(reason => sql.raw(`'${reason}'`)), sql`, `,
  )})`),
  uniqueIndex("oauth_grants_active_binding_unique")
    .on(table.organizationId, table.userId, table.clientId, table.resource)
    .where(sql`${table.revokedAt} is null`),
  index("oauth_grants_org_user_idx").on(table.organizationId, table.userId),
]);

export const oauthAuthorizationAttempts = pgTable("oauth_authorization_attempts", {
  attemptKey: text("attempt_key").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  // Keep the issuance identity even after removal, so an old attempt cannot rebind.
  memberId: text("member_id").notNull(),
  clientId: text("client_id"),
  resource: text("resource"),
  grantId: text("grant_id").references(() => oauthGrants.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [index("oauth_authorization_attempts_expires_at_idx").on(table.expiresAt)]);

export const oauthGrantsRelations = relations(oauthGrants, ({ one, many }) => ({
  organization: one(organizations, { fields: [oauthGrants.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [oauthGrants.userId], references: [users.id] }),
  member: one(members, { fields: [oauthGrants.memberId], references: [members.id] }),
  oauthClient: one(oauthClients, { fields: [oauthGrants.clientId], references: [oauthClients.clientId] }),
  consents: many(oauthConsents),
  accessTokens: many(oauthAccessTokens),
  refreshTokens: many(oauthRefreshTokens),
  attempts: many(oauthAuthorizationAttempts),
}));
export const oauthAuthorizationAttemptsRelations = relations(oauthAuthorizationAttempts, ({ one }) => ({
  session: one(sessions, { fields: [oauthAuthorizationAttempts.sessionId], references: [sessions.id] }),
  grant: one(oauthGrants, { fields: [oauthAuthorizationAttempts.grantId], references: [oauthGrants.id] }),
  organization: one(organizations, { fields: [oauthAuthorizationAttempts.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [oauthAuthorizationAttempts.userId], references: [users.id] }),
}));
export const oauthConsentsRelations = relations(oauthConsents, ({ one }) => ({
  grant: one(oauthGrants, { fields: [oauthConsents.referenceId], references: [oauthGrants.id] }),
  oauthClient: one(oauthClients, { fields: [oauthConsents.clientId], references: [oauthClients.clientId] }),
  user: one(users, { fields: [oauthConsents.userId], references: [users.id] }),
}));
export const oauthRefreshTokensRelations = relations(oauthRefreshTokens, ({ one, many }) => ({
  grant: one(oauthGrants, { fields: [oauthRefreshTokens.referenceId], references: [oauthGrants.id] }),
  oauthClient: one(oauthClients, { fields: [oauthRefreshTokens.clientId], references: [oauthClients.clientId] }),
  user: one(users, { fields: [oauthRefreshTokens.userId], references: [users.id] }),
  session: one(sessions, { fields: [oauthRefreshTokens.sessionId], references: [sessions.id] }),
  accessTokens: many(oauthAccessTokens),
}));
export const oauthAccessTokensRelations = relations(oauthAccessTokens, ({ one }) => ({
  grant: one(oauthGrants, { fields: [oauthAccessTokens.referenceId], references: [oauthGrants.id] }),
  oauthClient: one(oauthClients, { fields: [oauthAccessTokens.clientId], references: [oauthClients.clientId] }),
  user: one(users, { fields: [oauthAccessTokens.userId], references: [users.id] }),
  session: one(sessions, { fields: [oauthAccessTokens.sessionId], references: [sessions.id] }),
  oauthRefreshToken: one(oauthRefreshTokens, { fields: [oauthAccessTokens.refreshId], references: [oauthRefreshTokens.id] }),
}));
export const oauthClientsRelations = relations(oauthClients, ({ many }) => ({
  grants: many(oauthGrants), consents: many(oauthConsents),
  accessTokens: many(oauthAccessTokens), refreshTokens: many(oauthRefreshTokens),
  resources: many(oauthClientResources),
}));
export const oauthResourcesRelations = relations(oauthResources, ({ many }) => ({ clients: many(oauthClientResources) }));
export const oauthClientResourcesRelations = relations(oauthClientResources, ({ one }) => ({
  oauthClient: one(oauthClients, { fields: [oauthClientResources.clientId], references: [oauthClients.clientId] }),
  oauthResource: one(oauthResources, { fields: [oauthClientResources.resourceId], references: [oauthResources.identifier] }),
}));

export type OAuthGrant = typeof oauthGrants.$inferSelect;
export type OAuthAuthorizationAttempt = typeof oauthAuthorizationAttempts.$inferSelect;
