import { app, dialog, ipcMain, shell } from "electron";
import { ipcChannels } from "@kanban/shared";
import type { KanbanRepository } from "../db/repositories/kanban-repository";
import type { AiSettingsService } from "../ai/settings-service";
import { AiSuggestionService } from "../ai/suggestion-service";
import type { AgentRunService } from "../agent/agent-run-service";
import { KanbanHandlers } from "./kanban";
import { bindInvoke } from "./contract-binder";

export interface IpcServiceContext {
  kanban: KanbanRepository;
  ai: AiSettingsService;
  agent: AgentRunService;
}

export function registerIpc(context: IpcServiceContext): void {
  const kanban = new KanbanHandlers(context.kanban);
  const suggestions = new AiSuggestionService(context.ai);

  bindInvoke(ipcMain, ipcChannels.system.getStatus, () => ({
    appName: "Kanban" as const,
    platform: process.platform,
    version: app.getVersion(),
    userDataPath: app.getPath("userData")
  }));

  bindInvoke(ipcMain, ipcChannels.ai.getSettings, () => context.ai.getSettings());
  bindInvoke(ipcMain, ipcChannels.ai.saveSettings, (input) => context.ai.saveSettings(input));
  bindInvoke(ipcMain, ipcChannels.ai.testConnection, () => context.ai.testConnection());
  bindInvoke(ipcMain, ipcChannels.ai.openLogFile, async () => {
    await shell.openPath(context.ai.ensureLogFile());
  });
  bindInvoke(ipcMain, ipcChannels.ai.suggestText, (input) => suggestions.suggestText(input));
  bindInvoke(ipcMain, ipcChannels.ai.suggestLabels, (input) => suggestions.suggestLabels(input));

  bindInvoke(ipcMain, ipcChannels.agent.listAvailable, () => context.agent.listAvailable());
  bindInvoke(ipcMain, ipcChannels.agent.selectRepoPath, async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a Git repository",
      properties: ["openDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  bindInvoke(ipcMain, ipcChannels.agent.validateRepoPath, (input) => context.agent.validateRepoPath(input));
  bindInvoke(ipcMain, ipcChannels.agent.startRun, (input) => context.agent.startRun(input));

  bindInvoke(ipcMain, ipcChannels.kanban.listBoards, () => kanban.listBoards());
  bindInvoke(ipcMain, ipcChannels.kanban.createBoard, (input) => kanban.createBoard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.renameBoard, (input) => kanban.renameBoard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.deleteBoard, (input) => kanban.deleteBoard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.listColumns, (input) => kanban.listColumns(input));
  bindInvoke(ipcMain, ipcChannels.kanban.createColumn, (input) => kanban.createColumn(input));
  bindInvoke(ipcMain, ipcChannels.kanban.updateColumn, (input) => kanban.updateColumn(input));
  bindInvoke(ipcMain, ipcChannels.kanban.setCompletionColumn, (input) => kanban.setCompletionColumn(input));
  bindInvoke(ipcMain, ipcChannels.kanban.reorderColumn, (input) => kanban.reorderColumn(input));
  bindInvoke(ipcMain, ipcChannels.kanban.archiveColumn, (input) => kanban.archiveColumn(input));
  bindInvoke(ipcMain, ipcChannels.kanban.restoreColumn, (input) => kanban.restoreColumn(input));
  bindInvoke(ipcMain, ipcChannels.kanban.listCards, (input) => kanban.listCards(input));
  bindInvoke(ipcMain, ipcChannels.kanban.createCard, (input) => kanban.createCard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.updateCard, (input) => kanban.updateCard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.deleteCard, (input) => kanban.deleteCard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.archiveCard, (input) => kanban.archiveCard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.restoreCard, (input) => kanban.restoreCard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.reorderCard, (input) => kanban.reorderCard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.listLabels, (input) => kanban.listLabels(input));
  bindInvoke(ipcMain, ipcChannels.kanban.createLabel, (input) => kanban.createLabel(input));
  bindInvoke(ipcMain, ipcChannels.kanban.deleteLabel, (input) => kanban.deleteLabel(input));
  bindInvoke(ipcMain, ipcChannels.kanban.setCardLabels, (input) => kanban.setCardLabels(input));
  bindInvoke(ipcMain, ipcChannels.kanban.enableCardRecurrence, (input) => kanban.enableCardRecurrence(input));
  bindInvoke(ipcMain, ipcChannels.kanban.updateCardRecurrence, (input) => kanban.updateCardRecurrence(input));
  bindInvoke(ipcMain, ipcChannels.kanban.disableCardRecurrence, (input) => kanban.disableCardRecurrence(input));
  bindInvoke(ipcMain, ipcChannels.kanban.generateDueRecurrences, (input) => kanban.generateDueRecurrences(input));
  bindInvoke(ipcMain, ipcChannels.kanban.exportBoard, (input) => kanban.exportBoard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.importBoard, (input) => kanban.importBoard(input));
}
