import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./schema";

export function openKanbanDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path);
  migrate(database);
  return database;
}
