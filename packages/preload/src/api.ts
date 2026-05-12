import { ipcRenderer } from "electron";
import { ipcChannels, type IpcContract } from "@kanban/shared";

export const api: IpcContract = {
  app: {
    onOpenSettings: (callback) => {
      const listener = () => callback();
      ipcRenderer.on(ipcChannels.app.openSettings, listener);
      return () => ipcRenderer.removeListener(ipcChannels.app.openSettings, listener);
    }
  },
  system: {
    getStatus: () => ipcRenderer.invoke(ipcChannels.system.getStatus)
  },
  settings: {
    getSettings: () => ipcRenderer.invoke(ipcChannels.settings.getSettings),
    updateSettings: (input) => ipcRenderer.invoke(ipcChannels.settings.updateSettings, input)
  },
  kanban: {
    listBoards: () => ipcRenderer.invoke(ipcChannels.kanban.listBoards),
    createBoard: (input) => ipcRenderer.invoke(ipcChannels.kanban.createBoard, input),
    renameBoard: (input) => ipcRenderer.invoke(ipcChannels.kanban.renameBoard, input),
    deleteBoard: (input) => ipcRenderer.invoke(ipcChannels.kanban.deleteBoard, input),
    listColumns: (input) => ipcRenderer.invoke(ipcChannels.kanban.listColumns, input),
    createColumn: (input) => ipcRenderer.invoke(ipcChannels.kanban.createColumn, input),
    updateColumn: (input) => ipcRenderer.invoke(ipcChannels.kanban.updateColumn, input),
    reorderColumn: (input) => ipcRenderer.invoke(ipcChannels.kanban.reorderColumn, input),
    archiveColumn: (input) => ipcRenderer.invoke(ipcChannels.kanban.archiveColumn, input),
    restoreColumn: (input) => ipcRenderer.invoke(ipcChannels.kanban.restoreColumn, input),
    listCards: (input) => ipcRenderer.invoke(ipcChannels.kanban.listCards, input),
    createCard: (input) => ipcRenderer.invoke(ipcChannels.kanban.createCard, input),
    updateCard: (input) => ipcRenderer.invoke(ipcChannels.kanban.updateCard, input),
    deleteCard: (input) => ipcRenderer.invoke(ipcChannels.kanban.deleteCard, input),
    archiveCard: (input) => ipcRenderer.invoke(ipcChannels.kanban.archiveCard, input),
    restoreCard: (input) => ipcRenderer.invoke(ipcChannels.kanban.restoreCard, input),
    reorderCard: (input) => ipcRenderer.invoke(ipcChannels.kanban.reorderCard, input),
    listLabels: (input) => ipcRenderer.invoke(ipcChannels.kanban.listLabels, input),
    createLabel: (input) => ipcRenderer.invoke(ipcChannels.kanban.createLabel, input),
    deleteLabel: (input) => ipcRenderer.invoke(ipcChannels.kanban.deleteLabel, input),
    setCardLabels: (input) => ipcRenderer.invoke(ipcChannels.kanban.setCardLabels, input),
    exportBoard: (input) => ipcRenderer.invoke(ipcChannels.kanban.exportBoard, input),
    importBoard: (input) => ipcRenderer.invoke(ipcChannels.kanban.importBoard, input)
  }
};
