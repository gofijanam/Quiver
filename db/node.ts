import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

let binding: D1Database | undefined;

export function getRawDb(): D1Database {
  if (binding) return binding;
  const path = process.env.QUIVER_WEB_DB_PATH;
  if (!path) throw new Error("QUIVER_WEB_DB_PATH is required for persistent preview accounting.");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    db.exec("BEGIN IMMEDIATE");
    db.exec("CREATE TABLE IF NOT EXISTS quiver_web_migrations (name TEXT PRIMARY KEY)");
    const applied = db.prepare("SELECT 1 FROM quiver_web_migrations WHERE name = ?");
    const record = db.prepare("INSERT INTO quiver_web_migrations (name) VALUES (?)");
    const directory = join(process.cwd(), "drizzle");
    for (const name of readdirSync(directory).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()) {
      if (applied.get(name)) continue;
      db.exec(readFileSync(join(directory, name), "utf8"));
      record.run(name);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.close();
    throw error;
  }

  // The preview routes use this subset of the D1 statement interface.
  binding = {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      function bound(args: SQLInputValue[]) {
        return {
          bind: (...values: SQLInputValue[]) => bound(values),
          async run() {
            return { success: true, meta: { changes: Number(statement.run(...args).changes) } };
          },
          async all() {
            return { results: statement.all(...args) };
          },
          async first() {
            return statement.get(...args) ?? null;
          },
        };
      }
      return bound([]);
    },
  } as unknown as D1Database;
  return binding;
}
