export const ipcChannels = {
  system: {
    getStatus: "system:get-status",
    showKeyboardShortcuts: "system:show-keyboard-shortcuts",
    showAiSettings: "system:show-ai-settings"
  },
  ai: {
    getSettings: "ai:get-settings",
    saveSettings: "ai:save-settings",
    testConnection: "ai:test-connection",
    openLogFile: "ai:open-log-file",
    suggestText: "ai:suggest-text",
    suggestLabels: "ai:suggest-labels"
  },
  agent: {
    listAvailable: "agent:list-available",
    selectRepoPath: "agent:select-repo-path",
    validateRepoPath: "agent:validate-repo-path",
    startRun: "agent:start-run"
  },
  kanban: {
    listBoards: "kanban:list-boards",
    createBoard: "kanban:create-board",
    renameBoard: "kanban:rename-board",
    deleteBoard: "kanban:delete-board",
    listColumns: "kanban:list-columns",
    createColumn: "kanban:create-column",
    updateColumn: "kanban:update-column",
    setCompletionColumn: "kanban:set-completion-column",
    reorderColumn: "kanban:reorder-column",
    archiveColumn: "kanban:archive-column",
    restoreColumn: "kanban:restore-column",
    listCards: "kanban:list-cards",
    createCard: "kanban:create-card",
    updateCard: "kanban:update-card",
    deleteCard: "kanban:delete-card",
    archiveCard: "kanban:archive-card",
    restoreCard: "kanban:restore-card",
    reorderCard: "kanban:reorder-card",
    listLabels: "kanban:list-labels",
    createLabel: "kanban:create-label",
    deleteLabel: "kanban:delete-label",
    setCardLabels: "kanban:set-card-labels",
    enableCardRecurrence: "kanban:enable-card-recurrence",
    updateCardRecurrence: "kanban:update-card-recurrence",
    disableCardRecurrence: "kanban:disable-card-recurrence",
    generateDueRecurrences: "kanban:generate-due-recurrences",
    exportBoard: "kanban:export-board",
    importBoard: "kanban:import-board",
    cardCommentsChanged: "kanban:card-comments-changed"
  }
} as const;

export type IpcChannel = typeof ipcChannels[keyof typeof ipcChannels][keyof typeof ipcChannels[keyof typeof ipcChannels]];
