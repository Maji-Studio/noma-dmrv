import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { readCaCert } from "./src/lib/pg-pool-config";

// Load .env.local for development
config({ path: ".env.local" });

// Managed Postgres with a private CA (DigitalOcean) needs the CA pinned here
// too: drizzle-kit opens its own connection, not the app's pg pool.
const caCert = readCaCert();

export default defineConfig({
  schema: "./src/db/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: caCert
      ? { ca: caCert, rejectUnauthorized: true }
      : process.env.NODE_ENV === "production"
        ? true
        : "allow",
  },
});
