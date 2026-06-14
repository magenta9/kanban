export const ipcInvokeRegistry = {
  "system.getStatus": "system:get-status",
  "ai.getSettings": "ai:get-settings",
  "ai.saveSettings": "ai:save-settings",
  "ai.testConnection": "ai:test-connection",
  "ai.openLogFile": "ai:open-log-file",
  "ai.suggestText": "ai:suggest-text",
  "ai.suggestLabels": "ai:suggest-labels",
  "agent.listAvailable": "agent:list-available",
  "agent.selectRepoPath": "agent:select-repo-path",
  "agent.validateRepoPath": "agent:validate-repo-path",
  "agent.startRun": "agent:start-run",
  "kanban.listBoards": "kanban:list-boards",
  "kanban.createBoard": "kanban:create-board",
  "kanban.renameBoard": "kanban:rename-board",
  "kanban.deleteBoard": "kanban:delete-board",
  "kanban.listColumns": "kanban:list-columns",
  "kanban.createColumn": "kanban:create-column",
  "kanban.updateColumn": "kanban:update-column",
  "kanban.setCompletionColumn": "kanban:set-completion-column",
  "kanban.reorderColumn": "kanban:reorder-column",
  "kanban.archiveColumn": "kanban:archive-column",
  "kanban.restoreColumn": "kanban:restore-column",
  "kanban.listCards": "kanban:list-cards",
  "kanban.createCard": "kanban:create-card",
  "kanban.updateCard": "kanban:update-card",
  "kanban.deleteCard": "kanban:delete-card",
  "kanban.archiveCard": "kanban:archive-card",
  "kanban.restoreCard": "kanban:restore-card",
  "kanban.reorderCard": "kanban:reorder-card",
  "kanban.listLabels": "kanban:list-labels",
  "kanban.createLabel": "kanban:create-label",
  "kanban.deleteLabel": "kanban:delete-label",
  "kanban.setCardLabels": "kanban:set-card-labels",
  "kanban.enableCardRecurrence": "kanban:enable-card-recurrence",
  "kanban.updateCardRecurrence": "kanban:update-card-recurrence",
  "kanban.disableCardRecurrence": "kanban:disable-card-recurrence",
  "kanban.generateDueRecurrences": "kanban:generate-due-recurrences",
  "kanban.exportBoard": "kanban:export-board",
  "kanban.importBoard": "kanban:import-board"
} as const;

export type IpcInvokeHandlerName = keyof typeof ipcInvokeRegistry;
export type IpcInvokeChannel = typeof ipcInvokeRegistry[IpcInvokeHandlerName];

export const ipcInvokeHandlerNames = Object.keys(ipcInvokeRegistry) as IpcInvokeHandlerName[];

export function ipcInvokeChannel(name: IpcInvokeHandlerName): IpcInvokeChannel {
  return ipcInvokeRegistry[name];
}

export function allIpcInvokeChannels(): IpcInvokeChannel[] {
  return Object.values(ipcInvokeRegistry);
}
