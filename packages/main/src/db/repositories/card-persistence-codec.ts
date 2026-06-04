import type { KanbanCard, KanbanComment, KanbanRichTextDocument, KanbanSubtask } from "@kanban/shared";
import { markdownToPlainText } from "@kanban/shared";

export interface CardRow {
    id: string;
    board_id: string;
    column_id: string;
    title: string;
    description_markdown: string | null;
    description_json: string | null;
    description_text: string | null;
    subtasks_json: string;
    comments_json: string;
    priority: KanbanCard["priority"];
    due_date: number | null;
    start_date: number | null;
    end_date: number | null;
    sort_order: number;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
}

export interface CardInsertParams {
    id: string;
    boardId: string;
    columnId: string;
    title: string;
    descriptionMarkdown: string | null;
    descriptionJson: string | null;
    descriptionText: string | null;
    subtasksJson: string;
    commentsJson: string;
    priority: KanbanCard["priority"];
    dueDate: number | null;
    startDate: number | null;
    endDate: number | null;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
    archivedAt: number | null;
}

export function rowToCard(row: CardRow): KanbanCard {
    return {
        id: row.id,
        boardId: row.board_id,
        columnId: row.column_id,
        title: row.title,
        descriptionMarkdown: row.description_markdown ?? undefined,
        descriptionJson: parseRichText(row.description_json),
        descriptionText: row.description_text ?? undefined,
        subtasks: parseSubtasks(row.subtasks_json),
        comments: parseComments(row.comments_json),
        priority: row.priority,
        dueDate: row.due_date ?? undefined,
        startDate: row.start_date ?? undefined,
        endDate: row.end_date ?? undefined,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: row.archived_at ?? undefined,
        labelIds: []
    };
}

export function cardToInsertParams(card: KanbanCard): CardInsertParams {
    return {
        ...card,
        descriptionMarkdown: card.descriptionMarkdown ?? null,
        descriptionJson: serializeRichText(card.descriptionJson),
        descriptionText: card.descriptionText ?? markdownToPlainText(card.descriptionMarkdown) ?? null,
        subtasksJson: serializeSubtasks(card.subtasks),
        commentsJson: serializeComments(card.comments),
        dueDate: normalizeTimestamp(card.dueDate, "dueDate"),
        startDate: normalizeTimestamp(card.startDate ?? card.dueDate, "startDate"),
        endDate: normalizeTimestamp(card.endDate ?? (card.startDate === undefined ? card.dueDate : undefined), "endDate"),
        archivedAt: card.archivedAt ?? null
    };
}

export function normalizeTimestamp(value: number | null | undefined, field: string): number | null {
    if (value === undefined || value === null) return null;
    if (!Number.isFinite(value)) throw new Error(`Invalid Kanban ${field}.`);
    return Math.trunc(value);
}

export function serializeRichText(value: KanbanRichTextDocument | undefined): string | null {
    return value === undefined ? null : JSON.stringify(value);
}

export function serializeSubtasks(value: KanbanSubtask[] | undefined): string {
    return JSON.stringify(value ?? []);
}

export function serializeComments(value: KanbanComment[] | undefined): string {
    return JSON.stringify(value ?? []);
}

function parseRichText(value: string | null): KanbanRichTextDocument | undefined {
    if (!value) return undefined;
    try {
        return JSON.parse(value) as KanbanRichTextDocument;
    } catch {
        return undefined;
    }
}

function parseSubtasks(value: string | null): KanbanSubtask[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.filter(isSubtask) : [];
    } catch {
        return [];
    }
}

function isSubtask(value: unknown): value is KanbanSubtask {
    return Boolean(
        value &&
        typeof value === "object" &&
        typeof (value as KanbanSubtask).id === "string" &&
        typeof (value as KanbanSubtask).title === "string" &&
        typeof (value as KanbanSubtask).completed === "boolean" &&
        typeof (value as KanbanSubtask).createdAt === "number" &&
        typeof (value as KanbanSubtask).updatedAt === "number"
    );
}

function parseComments(value: string | null): KanbanComment[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.filter(isComment) : [];
    } catch {
        return [];
    }
}

function isComment(value: unknown): value is KanbanComment {
    return Boolean(
        value &&
        typeof value === "object" &&
        typeof (value as KanbanComment).id === "string" &&
        typeof (value as KanbanComment).body === "string" &&
        typeof (value as KanbanComment).createdAt === "number" &&
        typeof (value as KanbanComment).updatedAt === "number"
    );
}
