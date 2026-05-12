export const ipcChannels = {
  app: {
    openSettings: "app:open-settings"
  },
  system: {
    getStatus: "system:get-status"
  },
  settings: {
    getSettings: "settings:get-settings",
    updateSettings: "settings:update-settings"
  },
  kanban: {
    listBoards: "kanban:list-boards",
    createBoard: "kanban:create-board",
    renameBoard: "kanban:rename-board",
    deleteBoard: "kanban:delete-board",
    listColumns: "kanban:list-columns",
    createColumn: "kanban:create-column",
    updateColumn: "kanban:update-column",
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
    exportBoard: "kanban:export-board",
    importBoard: "kanban:import-board"
  }
} as const;

export type IpcChannel = typeof ipcChannels[keyof typeof ipcChannels][keyof typeof ipcChannels[keyof typeof ipcChannels]];
