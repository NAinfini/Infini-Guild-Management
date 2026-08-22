import { defineConfig } from "drizzle-kit";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const schemaGlob = join(packageRoot, "src", "schema", "*.ts").replaceAll("\\", "/");

export default defineConfig({
  dialect: "sqlite",
  schema: schemaGlob,
  out: "packages/persistence-sqlite/src/migrations/generated",
});
