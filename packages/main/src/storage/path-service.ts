import { app } from "electron";
import { join } from "node:path";

export interface KanbanPaths {
  root: string;
  databasePath: string;
  aiSettingsPath: string;
  aiLogPath: string;
}

export function resolveKanbanPaths(): KanbanPaths {
  const root = join(app.getPath("userData"), "electron");
  return {
    root,
    databasePath: join(root, "kanban.sqlite"),
    aiSettingsPath: join(root, "ai-settings.json"),
    aiLogPath: join(root, "ai.log")
  };
}
