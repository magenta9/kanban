import type { KanbanCard, KanbanPriority, KanbanRichTextDocument, KanbanSubtask } from "@kanban/shared";
import { dateOnlyTimestampFromTimestamp } from "./recurrence-rule";

export interface RecurrenceTemplate {
    title: string;
    descriptionMarkdown?: string;
    descriptionJson?: KanbanRichTextDocument;
    descriptionText?: string;
    priority: KanbanPriority;
    labelIds: string[];
    subtasks: KanbanSubtask[];
}

const validPriorities = new Set<KanbanPriority>(["none", "low", "medium", "high", "urgent"]);

export function templateFromCard(card: KanbanCard): RecurrenceTemplate {
    return {
        title: card.title,
        descriptionMarkdown: card.descriptionMarkdown,
        descriptionJson: card.descriptionJson,
        descriptionText: card.descriptionText,
        priority: card.priority,
        labelIds: card.labelIds,
        subtasks: card.subtasks.map((subtask) => ({ ...subtask, completed: false }))
    };
}

export function serializeRecurrenceTemplate(value: RecurrenceTemplate): string {
    return JSON.stringify(value);
}

export function parseRecurrenceTemplate(value: string): RecurrenceTemplate | undefined {
    try {
        const parsed = JSON.parse(value) as Partial<RecurrenceTemplate>;
        if (!parsed.title || !parsed.priority || !validPriorities.has(parsed.priority)) return undefined;
        return {
            title: parsed.title,
            descriptionMarkdown: parsed.descriptionMarkdown,
            descriptionJson: parsed.descriptionJson,
            descriptionText: parsed.descriptionText,
            priority: parsed.priority,
            labelIds: Array.isArray(parsed.labelIds) ? parsed.labelIds.filter((labelId): labelId is string => typeof labelId === "string") : [],
            subtasks: Array.isArray(parsed.subtasks) ? parsed.subtasks.filter(isSubtask).map((subtask) => ({ ...subtask, completed: false })) : []
        };
    } catch {
        return undefined;
    }
}

export function remapTemplateLabels(value: string, labelIds: Map<string, string>): string {
    const template = parseRecurrenceTemplate(value);
    if (!template) return value;
    return serializeRecurrenceTemplate({
        ...template,
        labelIds: template.labelIds.map((labelId) => labelIds.get(labelId)).filter((labelId): labelId is string => Boolean(labelId))
    });
}

export function occurrenceDateRange(source: KanbanCard, occurrenceDate: number): { startDate: number; endDate: number } {
    const sourceStart = source.startDate ?? source.dueDate;
    const sourceEnd = source.endDate ?? sourceStart;
    if (sourceStart === undefined || sourceEnd === undefined) {
        return { startDate: occurrenceDate, endDate: occurrenceDate };
    }
    const span = Math.max(0, dateOnlyTimestampFromTimestamp(sourceEnd) - dateOnlyTimestampFromTimestamp(sourceStart));
    return { startDate: occurrenceDate, endDate: occurrenceDate + span };
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
