export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type KanbanPriority = "none" | "low" | "medium" | "high" | "urgent";
export type KanbanRecurrenceTrigger = "fixed" | "completion";
export type KanbanRecurrenceCycle = "daily" | "weekly" | "monthly";
export type KanbanRecurrenceStatus = "active" | "blocked" | "stopped";

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
    completionColumnId?: string;
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
    descriptionMarkdown?: string;
    descriptionJson?: KanbanRichTextDocument;
    descriptionText?: string;
    priority: KanbanPriority;
    dueDate?: number;
    startDate?: number;
    endDate?: number;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
    archivedAt?: number;
    labelIds: string[];
    subtasks: KanbanSubtask[];
    comments: KanbanComment[];
    recurrence?: KanbanCardRecurrenceSummary;
}

export interface KanbanCardRecurrenceSummary {
    seriesId: string;
    trigger: KanbanRecurrenceTrigger;
    cycle: KanbanRecurrenceCycle;
    status: KanbanRecurrenceStatus;
    blockedReason?: string;
}

export interface KanbanRecurrenceSeries {
    id: string;
    boardId: string;
    trigger: KanbanRecurrenceTrigger;
    cycle: KanbanRecurrenceCycle;
    activeBatonCardId?: string;
    templateJson: string;
    status: KanbanRecurrenceStatus;
    blockedReason?: string;
    lastOccurrenceDate: number;
    anchorDay: number;
    createdAt: number;
    updatedAt: number;
    stoppedAt?: number;
}

export interface KanbanRecurrenceOccurrence {
    seriesId: string;
    cardId: string;
    occurrenceDate: number;
    generatedNextAt?: number;
    createdAt: number;
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
    recurrenceSeries?: KanbanRecurrenceSeries[];
    recurrenceOccurrences?: KanbanRecurrenceOccurrence[];
}

export interface KanbanColumnPatch {
    name: string;
    color?: string;
}

export interface KanbanCardPatch {
    title: string;
    columnId: string;
    descriptionMarkdown?: string;
    descriptionJson?: KanbanRichTextDocument;
    descriptionText?: string;
    priority: KanbanPriority;
    dueDate?: number | null;
    startDate?: number | null;
    endDate?: number | null;
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

export interface EnableKanbanRecurrenceInput {
    cardId: string;
    trigger: KanbanRecurrenceTrigger;
    cycle: KanbanRecurrenceCycle;
}

export interface UpdateKanbanRecurrenceInput {
    cardId: string;
    trigger: KanbanRecurrenceTrigger;
    cycle: KanbanRecurrenceCycle;
}

export interface AiSettingsState {
    enabled: boolean;
    configured: boolean;
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    lastError?: AiLogEntry;
}

export interface SaveAiSettingsInput {
    enabled: boolean;
    baseUrl: string;
    model: string;
    apiKey?: string;
    clearApiKey?: boolean;
}

export interface AiLogEntry {
    timestamp: number;
    scope: string;
    message: string;
    statusCode?: number;
    durationMs?: number;
}

export interface AiTestConnectionResult {
    ok: boolean;
    message: string;
    statusCode?: number;
    durationMs?: number;
}

export type AiTextSuggestionField = "card-title" | "description" | "comment";

export interface AiSuggestionCardContext {
    currentCard?: KanbanCard;
    relatedCards: KanbanCard[];
    boardLabels: KanbanLabel[];
    columnName?: string;
}

export interface AiTextSuggestionInput {
    field: AiTextSuggestionField;
    textBeforeCursor: string;
    textAfterCursor: string;
    maxChars: number;
    context: AiSuggestionCardContext;
}

export interface AiTextSuggestionResult {
    suggestion?: string;
}

export interface AiLabelSuggestionInput {
    context: AiSuggestionCardContext & { currentCard: KanbanCard };
    maxSuggestions: number;
}

export interface AiLabelSuggestion {
    name: string;
    existingLabelId?: string;
}

export interface AiLabelSuggestionResult {
    suggestions: AiLabelSuggestion[];
}
