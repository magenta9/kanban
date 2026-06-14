import { ipcRenderer } from "electron";
import { ipcChannels, ipcInvokeChannel, type IpcInvokeHandlerName, type PreloadApi } from "@kanban/shared";

function invoke<TResult>(handlerName: IpcInvokeHandlerName, input?: unknown): Promise<TResult> {
  const channel = ipcInvokeChannel(handlerName);
  return input === undefined
    ? ipcRenderer.invoke(channel)
    : ipcRenderer.invoke(channel, input);
}

export const api: PreloadApi = {
  system: {
    getStatus: () => invoke("system.getStatus"),
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
    getSettings: () => invoke("ai.getSettings"),
    saveSettings: (input) => invoke("ai.saveSettings", input),
    testConnection: () => invoke("ai.testConnection"),
    openLogFile: () => invoke("ai.openLogFile"),
    suggestText: (input) => invoke("ai.suggestText", input),
    suggestLabels: (input) => invoke("ai.suggestLabels", input)
  },
  agent: {
    listAvailable: () => invoke("agent.listAvailable"),
    selectRepoPath: () => invoke("agent.selectRepoPath"),
    validateRepoPath: (input) => invoke("agent.validateRepoPath", input),
    startRun: (input) => invoke("agent.startRun", input)
  },
  kanban: {
    listBoards: () => invoke("kanban.listBoards"),
    createBoard: (input) => invoke("kanban.createBoard", input),
    renameBoard: (input) => invoke("kanban.renameBoard", input),
    deleteBoard: (input) => invoke("kanban.deleteBoard", input),
    listColumns: (input) => invoke("kanban.listColumns", input),
    createColumn: (input) => invoke("kanban.createColumn", input),
    updateColumn: (input) => invoke("kanban.updateColumn", input),
    setCompletionColumn: (input) => invoke("kanban.setCompletionColumn", input),
    reorderColumn: (input) => invoke("kanban.reorderColumn", input),
    archiveColumn: (input) => invoke("kanban.archiveColumn", input),
    restoreColumn: (input) => invoke("kanban.restoreColumn", input),
    listCards: (input) => invoke("kanban.listCards", input),
    createCard: (input) => invoke("kanban.createCard", input),
    updateCard: (input) => invoke("kanban.updateCard", input),
    deleteCard: (input) => invoke("kanban.deleteCard", input),
    archiveCard: (input) => invoke("kanban.archiveCard", input),
    restoreCard: (input) => invoke("kanban.restoreCard", input),
    reorderCard: (input) => invoke("kanban.reorderCard", input),
    listLabels: (input) => invoke("kanban.listLabels", input),
    createLabel: (input) => invoke("kanban.createLabel", input),
    deleteLabel: (input) => invoke("kanban.deleteLabel", input),
    setCardLabels: (input) => invoke("kanban.setCardLabels", input),
    enableCardRecurrence: (input) => invoke("kanban.enableCardRecurrence", input),
    updateCardRecurrence: (input) => invoke("kanban.updateCardRecurrence", input),
    disableCardRecurrence: (input) => invoke("kanban.disableCardRecurrence", input),
    generateDueRecurrences: (input) => invoke("kanban.generateDueRecurrences", input),
    exportBoard: (input) => invoke("kanban.exportBoard", input),
    importBoard: (input) => invoke("kanban.importBoard", input),
    onCardCommentsChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload);
      ipcRenderer.on(ipcChannels.kanban.cardCommentsChanged, listener);
      return () => ipcRenderer.removeListener(ipcChannels.kanban.cardCommentsChanged, listener);
    }
  }
};
