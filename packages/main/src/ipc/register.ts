import { app, dialog, ipcMain, shell } from "electron";
import { ipcChannels } from "@kanban/shared";
import type { KanbanRepository } from "../db/repositories/kanban-repository";
import type { AiSettingsService } from "../ai/settings-service";
import { AiSuggestionService } from "../ai/suggestion-service";
import type { AgentRunService } from "../agent/agent-run-service";
import { KanbanHandlers } from "./kanban";
import { bindContractInvoke } from "./contract-binder";

export interface IpcServiceContext {
  kanban: KanbanRepository;
  ai: AiSettingsService;
  agent: AgentRunService;
}

export function registerIpc(context: IpcServiceContext): void {
  const kanban = new KanbanHandlers(context.kanban);
  const suggestions = new AiSuggestionService(context.ai);

  bindContractInvoke(ipcMain, "system.getStatus", () => ({
    appName: "Kanban" as const,
    platform: process.platform,
    version: app.getVersion(),
    userDataPath: app.getPath("userData")
  }));

  bindContractInvoke(ipcMain, "ai.getSettings", () => context.ai.getSettings());
  bindContractInvoke(ipcMain, "ai.saveSettings", (input) => context.ai.saveSettings(input));
  bindContractInvoke(ipcMain, "ai.testConnection", () => context.ai.testConnection());
  bindContractInvoke(ipcMain, "ai.openLogFile", async () => {
    await shell.openPath(context.ai.ensureLogFile());
  });
  bindContractInvoke(ipcMain, "ai.suggestText", (input) => suggestions.suggestText(input));
  bindContractInvoke(ipcMain, "ai.suggestLabels", (input) => suggestions.suggestLabels(input));

  bindContractInvoke(ipcMain, "agent.listAvailable", () => context.agent.listAvailable());
  bindContractInvoke(ipcMain, "agent.selectRepoPath", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a Git repository",
      properties: ["openDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  bindContractInvoke(ipcMain, "agent.validateRepoPath", (input) => context.agent.validateRepoPath(input));
  bindContractInvoke(ipcMain, "agent.startRun", (input) => context.agent.startRun(input));

  bindContractInvoke(ipcMain, "kanban.listBoards", () => kanban.listBoards());
  bindContractInvoke(ipcMain, "kanban.createBoard", (input) => kanban.createBoard(input));
  bindContractInvoke(ipcMain, "kanban.renameBoard", (input) => kanban.renameBoard(input));
  bindContractInvoke(ipcMain, "kanban.deleteBoard", (input) => kanban.deleteBoard(input));
  bindContractInvoke(ipcMain, "kanban.listColumns", (input) => kanban.listColumns(input));
  bindContractInvoke(ipcMain, "kanban.createColumn", (input) => kanban.createColumn(input));
  bindContractInvoke(ipcMain, "kanban.updateColumn", (input) => kanban.updateColumn(input));
  bindContractInvoke(ipcMain, "kanban.setCompletionColumn", (input) => kanban.setCompletionColumn(input));
  bindContractInvoke(ipcMain, "kanban.reorderColumn", (input) => kanban.reorderColumn(input));
  bindContractInvoke(ipcMain, "kanban.archiveColumn", (input) => kanban.archiveColumn(input));
  bindContractInvoke(ipcMain, "kanban.restoreColumn", (input) => kanban.restoreColumn(input));
  bindContractInvoke(ipcMain, "kanban.listCards", (input) => kanban.listCards(input));
  bindContractInvoke(ipcMain, "kanban.createCard", (input) => kanban.createCard(input));
  bindContractInvoke(ipcMain, "kanban.updateCard", (input) => kanban.updateCard(input));
  bindContractInvoke(ipcMain, "kanban.deleteCard", (input) => kanban.deleteCard(input));
  bindContractInvoke(ipcMain, "kanban.archiveCard", (input) => kanban.archiveCard(input));
  bindContractInvoke(ipcMain, "kanban.restoreCard", (input) => kanban.restoreCard(input));
  bindContractInvoke(ipcMain, "kanban.reorderCard", (input) => kanban.reorderCard(input));
  bindContractInvoke(ipcMain, "kanban.listLabels", (input) => kanban.listLabels(input));
  bindContractInvoke(ipcMain, "kanban.createLabel", (input) => kanban.createLabel(input));
  bindContractInvoke(ipcMain, "kanban.deleteLabel", (input) => kanban.deleteLabel(input));
  bindContractInvoke(ipcMain, "kanban.setCardLabels", (input) => kanban.setCardLabels(input));
  bindContractInvoke(ipcMain, "kanban.enableCardRecurrence", (input) => kanban.enableCardRecurrence(input));
  bindContractInvoke(ipcMain, "kanban.updateCardRecurrence", (input) => kanban.updateCardRecurrence(input));
  bindContractInvoke(ipcMain, "kanban.disableCardRecurrence", (input) => kanban.disableCardRecurrence(input));
  bindContractInvoke(ipcMain, "kanban.generateDueRecurrences", (input) => kanban.generateDueRecurrences(input));
  bindContractInvoke(ipcMain, "kanban.exportBoard", (input) => kanban.exportBoard(input));
  bindContractInvoke(ipcMain, "kanban.importBoard", (input) => kanban.importBoard(input));
}
