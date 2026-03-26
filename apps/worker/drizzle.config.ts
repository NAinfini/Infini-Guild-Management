import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "file:./.wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite",
  },
});
