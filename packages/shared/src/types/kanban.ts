export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type KanbanPriority = "none" | "low" | "medium" | "high" | "urgent";

export type KanbanRichTextDocument = JsonValue;

export interface KanbanSubtask {
    id: string;
    title: string;
    completed: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface KanbanComment {
    id: string;
    body: string;
    createdAt: number;
    updatedAt: number;
}

export interface KanbanBoard {
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
    archivedAt?: number;
}

export interface KanbanColumn {
    id: string;
    boardId: string;
    name: string;
    color?: string;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
    archivedAt?: number;
}

export interface KanbanCard {
    id: string;
    boardId: string;
    columnId: string;
    title: string;
    descriptionJson?: KanbanRichTextDocument;
    descriptionText?: string;
    priority: KanbanPriority;
    dueDate?: number;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
    archivedAt?: number;
    labelIds: string[];
    subtasks: KanbanSubtask[];
    comments: KanbanComment[];
}

export interface KanbanLabel {
    id: string;
    boardId: string;
    name: string;
    color: string;
}

export interface KanbanCardLabel {
    cardId: string;
    labelId: string;
}

export interface KanbanBoardExport {
    version: 1;
    exportedAt: number;
    board: KanbanBoard;
    columns: KanbanColumn[];
    cards: KanbanCard[];
    labels: KanbanLabel[];
    cardLabels: KanbanCardLabel[];
}

export interface KanbanColumnPatch {
    name: string;
    color?: string;
}

export interface KanbanCardPatch {
    title: string;
    columnId: string;
    descriptionJson?: KanbanRichTextDocument;
    descriptionText?: string;
    priority: KanbanPriority;
    dueDate?: number | null;
    subtasks?: KanbanSubtask[];
    comments?: KanbanComment[];
}

export interface CreateKanbanBoardInput {
    name: string;
    description?: string;
}

export interface CreateKanbanColumnInput {
    boardId: string;
    name: string;
    color?: string;
}

export interface CreateKanbanCardInput {
    boardId: string;
    columnId: string;
    title: string;
}

export interface CreateKanbanLabelInput {
    boardId: string;
    name: string;
    color: string;
}
