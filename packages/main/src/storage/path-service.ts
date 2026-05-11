import { app } from "electron";
import { join } from "node:path";

export interface KanbanPaths {
  root: string;
  databasePath: string;
}

export function resolveKanbanPaths(): KanbanPaths {
  const root = join(app.getPath("userData"), "electron");
  return {
    root,
    databasePath: join(root, "kanban.sqlite")
  };
}
