/**
 * Applies schema.sql. Every statement is idempotent (`if not exists`), so this is safe to
 * re-run; it is deliberately not a migration framework, which would be premature here.
 *
 *   npm run migrate
 */
import { readFile } from "node:fs/promises";
import { db } from "./client";

/**
 * Neon's HTTP driver allows one statement per request, so the file is split. Comments are
 * stripped first: the schema has no semicolons inside string literals, which is what would
 * otherwise make splitting on `;` unsafe.
 */
function statementsOf(schema: string): string[] {
  return schema
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

const schema = await readFile(new URL("schema.sql", import.meta.url), "utf8");
const statements = statementsOf(schema);
const sql = db();

console.log(`Applying ${statements.length} statements...`);
for (const statement of statements) {
  const summary = statement.replace(/\s+/g, " ").slice(0, 68);
  await sql.query(statement);
  console.log(`  ok  ${summary}`);
}

// The driver's generics describe result *shape* options, not row types, so cast instead.
const tables = (await sql.query(
  `select table_name from information_schema.tables
   where table_schema = 'public' order by table_name`,
)) as { table_name: string }[];
console.log(`\nTables: ${tables.map((row) => row.table_name).join(", ")}`);
