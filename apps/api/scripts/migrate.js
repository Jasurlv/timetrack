import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const migrationDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);
const client = await pool.connect();

try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const applied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [file],
    );
    if (applied.rowCount) continue;
    await client.query("BEGIN");
    try {
      await client.query(
        await readFile(join(migrationDirectory, file), "utf8"),
      );
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [
        file,
      ]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
