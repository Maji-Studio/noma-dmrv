import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { readCaCert } from "./src/lib/pg-pool-config";

// Load .env.local for development
config({ path: ".env.local" });

// Managed Postgres with a private CA (DigitalOcean) needs the CA pinned here
// too: drizzle-kit opens its own connection, not the app's pg pool.
const DEFAULT_POSTGRES_PORT = 5432;
const caCert = readCaCert();

// drizzle-kit hands a URL straight to pg, whose sslmode parsing overrides the
// ssl option and, without sslmode, connects unencrypted. Splitting the URL
// into explicit credentials is the only form where the pinned CA applies.
function dbCredentials() {
  const raw = process.env.DATABASE_URL!;
  if (!caCert) {
    return {
      url: raw,
      ssl: process.env.NODE_ENV === "production" ? true : ("allow" as const),
    };
  }
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || DEFAULT_POSTGRES_PORT),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: { ca: caCert, rejectUnauthorized: true },
  };
}

export default defineConfig({
  schema: "./src/db/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: dbCredentials(),
});
