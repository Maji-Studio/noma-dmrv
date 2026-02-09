import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env.local for development
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: process.env.NODE_ENV === "production" ? true : "allow",
  },
});
