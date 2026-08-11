import { DatabaseSync } from "node:sqlite";
import { assertCurrentVpsSchema } from "./vps-migration.js";

export function applyPrivateVpsMigration(database: DatabaseSync, migrationSql: string): "applied" {
  if (!migrationSql.trim()) throw new TypeError("Private migration SQL is empty");
  if (database.isTransaction) throw new Error("Private migration requires an idle database connection");
  if (containsTransactionControl(migrationSql)) {
    throw new TypeError("Private migration must not contain transaction control statements");
  }

  database.exec("PRAGMA foreign_keys = ON");
  assertCurrentVpsSchema(database);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(migrationSql.replaceAll("--> statement-breakpoint", ""));
    assertCurrentVpsSchema(database);
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("Private migration produced foreign-key violations");
    }
    database.exec("COMMIT");
    return "applied";
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function containsTransactionControl(sql: string): boolean {
  let executable = "";
  for (let index = 0; index < sql.length;) {
    const character = sql[index]!;
    const next = sql[index + 1];
    if (character === "-" && next === "-") {
      index = sql.indexOf("\n", index + 2);
      if (index < 0) break;
      executable += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end < 0) throw new TypeError("Private migration contains an unterminated comment");
      executable += " ".repeat(end + 2 - index);
      index = end + 2;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      executable += " ";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            executable += "  ";
            index += 2;
            continue;
          }
          executable += " ";
          index += 1;
          break;
        }
        executable += sql[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    executable += character;
    index += 1;
  }
  return /\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b|\bEND\s+(?:TRANSACTION|WORK)\b/i.test(executable);
}
