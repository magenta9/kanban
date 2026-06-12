import type {
  CreateKanbanBoardInput,
  CreateKanbanCardInput,
  CreateKanbanColumnInput,
  CreateKanbanLabelInput,
  AiSettingsState,
  AiLabelSuggestionInput,
  AiLabelSuggestionResult,
  AiTestConnectionResult,
  AiTextSuggestionInput,
  AiTextSuggestionResult,
  KanbanAgentInfo,
  EnableKanbanRecurrenceInput,
  KanbanBoard,
  KanbanBoardExport,
  KanbanCard,
  KanbanCardCommentsChangedEvent,
  KanbanCardPatch,
  KanbanColumn,
  KanbanColumnPatch,
  KanbanLabel,
  SaveAiSettingsInput,
  StartKanbanAgentRunInput,
  StartKanbanAgentRunResult,
  ValidateKanbanAgentRepoResult,
  UpdateKanbanRecurrenceInput
} from "./types/kanban";

export interface SystemStatus {
  appName: "Kanban";
  platform: string;
  version: string;
  userDataPath: string;
}

export type Unsubscribe = () => void;

export interface IpcContract {
  system: {
    getStatus(): Promise<SystemStatus>;
  };
  ai: {
    getSettings(): Promise<AiSettingsState>;
    saveSettings(input: SaveAiSettingsInput): Promise<AiSettingsState>;
    testConnection(): Promise<AiTestConnectionResult>;
    openLogFile(): Promise<void>;
    suggestText(input: AiTextSuggestionInput): Promise<AiTextSuggestionResult>;
    suggestLabels(input: AiLabelSuggestionInput): Promise<AiLabelSuggestionResult>;
  };
  agent: {
    listAvailable(): Promise<KanbanAgentInfo[]>;
    selectRepoPath(): Promise<string | null>;
    validateRepoPath(input: { path: string }): Promise<ValidateKanbanAgentRepoResult>;
    startRun(input: StartKanbanAgentRunInput): Promise<StartKanbanAgentRunResult>;
  };
  kanban: {
    listBoards(): Promise<KanbanBoard[]>;
    createBoard(input: CreateKanbanBoardInput): Promise<KanbanBoard>;
    renameBoard(input: { id: string; name: string }): Promise<KanbanBoard>;
    deleteBoard(input: { id: string }): Promise<void>;
    listColumns(input: { boardId: string; includeArchived?: boolean }): Promise<KanbanColumn[]>;
    createColumn(input: CreateKanbanColumnInput): Promise<KanbanColumn>;
    updateColumn(input: { id: string; patch: Partial<KanbanColumnPatch> }): Promise<KanbanColumn>;
    setCompletionColumn(input: { boardId: string; columnId: string }): Promise<KanbanBoard>;
    reorderColumn(input: { id: string; beforeId?: string; afterId?: string }): Promise<KanbanColumn>;
    archiveColumn(input: { id: string }): Promise<KanbanColumn>;
    restoreColumn(input: { id: string }): Promise<KanbanColumn>;
    listCards(input: { boardId: string; includeArchived?: boolean }): Promise<KanbanCard[]>;
    createCard(input: CreateKanbanCardInput): Promise<KanbanCard>;
    updateCard(input: { id: string; patch: Partial<KanbanCardPatch> }): Promise<KanbanCard>;
    deleteCard(input: { id: string }): Promise<void>;
    archiveCard(input: { id: string }): Promise<KanbanCard>;
    restoreCard(input: { id: string }): Promise<KanbanCard>;
    reorderCard(input: { id: string; toColumnId: string; beforeId?: string; afterId?: string }): Promise<KanbanCard>;
    listLabels(input: { boardId: string }): Promise<KanbanLabel[]>;
    createLabel(input: CreateKanbanLabelInput): Promise<KanbanLabel>;
    deleteLabel(input: { id: string }): Promise<void>;
    setCardLabels(input: { cardId: string; labelIds: string[] }): Promise<void>;
    enableCardRecurrence(input: EnableKanbanRecurrenceInput): Promise<KanbanCard>;
    updateCardRecurrence(input: UpdateKanbanRecurrenceInput): Promise<KanbanCard>;
    disableCardRecurrence(input: { cardId: string }): Promise<KanbanCard>;
    generateDueRecurrences(input?: { now?: number }): Promise<void>;
    exportBoard(input: { boardId: string }): Promise<KanbanBoardExport>;
    importBoard(input: { payload: KanbanBoardExport }): Promise<KanbanBoard>;
  };
}

export interface IpcEvents {
  system: {
    onShowKeyboardShortcuts(callback: () => void): Unsubscribe;
    onShowAiSettings(callback: () => void): Unsubscribe;
  };
  kanban: {
    onCardCommentsChanged(callback: (event: KanbanCardCommentsChangedEvent) => void): Unsubscribe;
  };
}

export type PreloadApi = IpcContract & IpcEvents;

export const ipcContractHandlers = [
  "system.getStatus",
  "ai.getSettings",
  "ai.saveSettings",
  "ai.testConnection",
  "ai.openLogFile",
  "ai.suggestText",
  "ai.suggestLabels",
  "agent.listAvailable",
  "agent.selectRepoPath",
  "agent.validateRepoPath",
  "agent.startRun",
  "kanban.listBoards",
  "kanban.createBoard",
  "kanban.renameBoard",
  "kanban.deleteBoard",
  "kanban.listColumns",
  "kanban.createColumn",
  "kanban.updateColumn",
  "kanban.setCompletionColumn",
  "kanban.reorderColumn",
  "kanban.archiveColumn",
  "kanban.restoreColumn",
  "kanban.listCards",
  "kanban.createCard",
  "kanban.updateCard",
  "kanban.deleteCard",
  "kanban.archiveCard",
  "kanban.restoreCard",
  "kanban.reorderCard",
  "kanban.listLabels",
  "kanban.createLabel",
  "kanban.deleteLabel",
  "kanban.setCardLabels",
  "kanban.enableCardRecurrence",
  "kanban.updateCardRecurrence",
  "kanban.disableCardRecurrence",
  "kanban.generateDueRecurrences",
  "kanban.exportBoard",
  "kanban.importBoard"
] as const;

export type IpcContractHandlerName = (typeof ipcContractHandlers)[number];
