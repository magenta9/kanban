import { ipcInvokeChannel } from "./ipc-invoke-registry";

export const ipcChannels = {
  system: {
    getStatus: ipcInvokeChannel("system.getStatus"),
    showKeyboardShortcuts: "system:show-keyboard-shortcuts",
    showAiSettings: "system:show-ai-settings"
  },
  ai: {
    getSettings: ipcInvokeChannel("ai.getSettings"),
    saveSettings: ipcInvokeChannel("ai.saveSettings"),
    testConnection: ipcInvokeChannel("ai.testConnection"),
    openLogFile: ipcInvokeChannel("ai.openLogFile"),
    suggestText: ipcInvokeChannel("ai.suggestText"),
    suggestLabels: ipcInvokeChannel("ai.suggestLabels")
  },
  agent: {
    listAvailable: ipcInvokeChannel("agent.listAvailable"),
    selectRepoPath: ipcInvokeChannel("agent.selectRepoPath"),
    validateRepoPath: ipcInvokeChannel("agent.validateRepoPath"),
    startRun: ipcInvokeChannel("agent.startRun")
  },
  kanban: {
    listBoards: ipcInvokeChannel("kanban.listBoards"),
    createBoard: ipcInvokeChannel("kanban.createBoard"),
    renameBoard: ipcInvokeChannel("kanban.renameBoard"),
    deleteBoard: ipcInvokeChannel("kanban.deleteBoard"),
    listColumns: ipcInvokeChannel("kanban.listColumns"),
    createColumn: ipcInvokeChannel("kanban.createColumn"),
    updateColumn: ipcInvokeChannel("kanban.updateColumn"),
    setCompletionColumn: ipcInvokeChannel("kanban.setCompletionColumn"),
    reorderColumn: ipcInvokeChannel("kanban.reorderColumn"),
    archiveColumn: ipcInvokeChannel("kanban.archiveColumn"),
    restoreColumn: ipcInvokeChannel("kanban.restoreColumn"),
    listCards: ipcInvokeChannel("kanban.listCards"),
    createCard: ipcInvokeChannel("kanban.createCard"),
    updateCard: ipcInvokeChannel("kanban.updateCard"),
    deleteCard: ipcInvokeChannel("kanban.deleteCard"),
    archiveCard: ipcInvokeChannel("kanban.archiveCard"),
    restoreCard: ipcInvokeChannel("kanban.restoreCard"),
    reorderCard: ipcInvokeChannel("kanban.reorderCard"),
    listLabels: ipcInvokeChannel("kanban.listLabels"),
    createLabel: ipcInvokeChannel("kanban.createLabel"),
    deleteLabel: ipcInvokeChannel("kanban.deleteLabel"),
    setCardLabels: ipcInvokeChannel("kanban.setCardLabels"),
    enableCardRecurrence: ipcInvokeChannel("kanban.enableCardRecurrence"),
    updateCardRecurrence: ipcInvokeChannel("kanban.updateCardRecurrence"),
    disableCardRecurrence: ipcInvokeChannel("kanban.disableCardRecurrence"),
    generateDueRecurrences: ipcInvokeChannel("kanban.generateDueRecurrences"),
    exportBoard: ipcInvokeChannel("kanban.exportBoard"),
    importBoard: ipcInvokeChannel("kanban.importBoard"),
    cardCommentsChanged: "kanban:card-comments-changed"
  }
} as const;

export type IpcChannel = typeof ipcChannels[keyof typeof ipcChannels][keyof typeof ipcChannels[keyof typeof ipcChannels]];
