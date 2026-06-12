import { ipcRenderer } from "electron";
import { ipcChannels, type PreloadApi } from "@kanban/shared";

export const api: PreloadApi = {
  system: {
    getStatus: () => ipcRenderer.invoke(ipcChannels.system.getStatus),
    onShowKeyboardShortcuts: (callback) => {
      const listener = () => callback();
      ipcRenderer.on(ipcChannels.system.showKeyboardShortcuts, listener);
      return () => ipcRenderer.removeListener(ipcChannels.system.showKeyboardShortcuts, listener);
    },
    onShowAiSettings: (callback) => {
      const listener = () => callback();
      ipcRenderer.on(ipcChannels.system.showAiSettings, listener);
      return () => ipcRenderer.removeListener(ipcChannels.system.showAiSettings, listener);
    }
  },
  ai: {
    getSettings: () => ipcRenderer.invoke(ipcChannels.ai.getSettings),
    saveSettings: (input) => ipcRenderer.invoke(ipcChannels.ai.saveSettings, input),
    testConnection: () => ipcRenderer.invoke(ipcChannels.ai.testConnection),
    openLogFile: () => ipcRenderer.invoke(ipcChannels.ai.openLogFile),
    suggestText: (input) => ipcRenderer.invoke(ipcChannels.ai.suggestText, input),
    suggestLabels: (input) => ipcRenderer.invoke(ipcChannels.ai.suggestLabels, input)
  },
  agent: {
    listAvailable: () => ipcRenderer.invoke(ipcChannels.agent.listAvailable),
    selectRepoPath: () => ipcRenderer.invoke(ipcChannels.agent.selectRepoPath),
    validateRepoPath: (input) => ipcRenderer.invoke(ipcChannels.agent.validateRepoPath, input),
    startRun: (input) => ipcRenderer.invoke(ipcChannels.agent.startRun, input)
  },
  kanban: {
    listBoards: () => ipcRenderer.invoke(ipcChannels.kanban.listBoards),
    createBoard: (input) => ipcRenderer.invoke(ipcChannels.kanban.createBoard, input),
    renameBoard: (input) => ipcRenderer.invoke(ipcChannels.kanban.renameBoard, input),
    deleteBoard: (input) => ipcRenderer.invoke(ipcChannels.kanban.deleteBoard, input),
    listColumns: (input) => ipcRenderer.invoke(ipcChannels.kanban.listColumns, input),
    createColumn: (input) => ipcRenderer.invoke(ipcChannels.kanban.createColumn, input),
    updateColumn: (input) => ipcRenderer.invoke(ipcChannels.kanban.updateColumn, input),
    setCompletionColumn: (input) => ipcRenderer.invoke(ipcChannels.kanban.setCompletionColumn, input),
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
    enableCardRecurrence: (input) => ipcRenderer.invoke(ipcChannels.kanban.enableCardRecurrence, input),
    updateCardRecurrence: (input) => ipcRenderer.invoke(ipcChannels.kanban.updateCardRecurrence, input),
    disableCardRecurrence: (input) => ipcRenderer.invoke(ipcChannels.kanban.disableCardRecurrence, input),
    generateDueRecurrences: (input) => ipcRenderer.invoke(ipcChannels.kanban.generateDueRecurrences, input),
    exportBoard: (input) => ipcRenderer.invoke(ipcChannels.kanban.exportBoard, input),
    importBoard: (input) => ipcRenderer.invoke(ipcChannels.kanban.importBoard, input),
    onCardCommentsChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload);
      ipcRenderer.on(ipcChannels.kanban.cardCommentsChanged, listener);
      return () => ipcRenderer.removeListener(ipcChannels.kanban.cardCommentsChanged, listener);
    }
  }
};
