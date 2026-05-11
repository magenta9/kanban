import { app, ipcMain } from "electron";
import { ipcChannels } from "@kanban/shared";
import type { KanbanRepository } from "../db/repositories/kanban-repository";
import { KanbanHandlers } from "./kanban";
import { bindInvoke } from "./contract-binder";

export interface IpcServiceContext {
  kanban: KanbanRepository;
}

export function registerIpc(context: IpcServiceContext): void {
  const kanban = new KanbanHandlers(context.kanban);

  bindInvoke(ipcMain, ipcChannels.system.getStatus, () => ({
    appName: "Kanban" as const,
    platform: process.platform,
    version: app.getVersion(),
    userDataPath: app.getPath("userData")
  }));

  bindInvoke(ipcMain, ipcChannels.kanban.listBoards, () => kanban.listBoards());
  bindInvoke(ipcMain, ipcChannels.kanban.createBoard, (input) => kanban.createBoard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.renameBoard, (input) => kanban.renameBoard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.deleteBoard, (input) => kanban.deleteBoard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.listColumns, (input) => kanban.listColumns(input));
  bindInvoke(ipcMain, ipcChannels.kanban.createColumn, (input) => kanban.createColumn(input));
  bindInvoke(ipcMain, ipcChannels.kanban.updateColumn, (input) => kanban.updateColumn(input));
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
  bindInvoke(ipcMain, ipcChannels.kanban.exportBoard, (input) => kanban.exportBoard(input));
  bindInvoke(ipcMain, ipcChannels.kanban.importBoard, (input) => kanban.importBoard(input));
}
