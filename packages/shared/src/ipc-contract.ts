import type {
  CreateKanbanBoardInput,
  CreateKanbanCardInput,
  CreateKanbanColumnInput,
  CreateKanbanLabelInput,
  KanbanBoard,
  KanbanBoardExport,
  KanbanCard,
  KanbanCardPatch,
  KanbanColumn,
  KanbanColumnPatch,
  KanbanLabel
} from "./types/kanban";
import type { AppSettings, UpdateAppSettingsInput } from "./types/settings";

export interface SystemStatus {
  appName: "Kanban";
  platform: string;
  version: string;
  userDataPath: string;
}

export interface IpcContract {
  system: {
    getStatus(): Promise<SystemStatus>;
  };
  settings: {
    getSettings(): Promise<AppSettings>;
    updateSettings(input: UpdateAppSettingsInput): Promise<AppSettings>;
  };
  kanban: {
    listBoards(): Promise<KanbanBoard[]>;
    createBoard(input: CreateKanbanBoardInput): Promise<KanbanBoard>;
    renameBoard(input: { id: string; name: string }): Promise<KanbanBoard>;
    deleteBoard(input: { id: string }): Promise<void>;
    listColumns(input: { boardId: string; includeArchived?: boolean }): Promise<KanbanColumn[]>;
    createColumn(input: CreateKanbanColumnInput): Promise<KanbanColumn>;
    updateColumn(input: { id: string; patch: Partial<KanbanColumnPatch> }): Promise<KanbanColumn>;
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
    exportBoard(input: { boardId: string }): Promise<KanbanBoardExport>;
    importBoard(input: { payload: KanbanBoardExport }): Promise<KanbanBoard>;
  };
}

export const ipcContractHandlers = [
  "system.getStatus",
  "settings.getSettings",
  "settings.updateSettings",
  "kanban.listBoards",
  "kanban.createBoard",
  "kanban.renameBoard",
  "kanban.deleteBoard",
  "kanban.listColumns",
  "kanban.createColumn",
  "kanban.updateColumn",
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
  "kanban.exportBoard",
  "kanban.importBoard"
] as const;

export type IpcContractHandlerName = (typeof ipcContractHandlers)[number];
