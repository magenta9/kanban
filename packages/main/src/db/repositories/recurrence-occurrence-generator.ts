import type { KanbanCard, KanbanColumn, KanbanRecurrenceCycle, KanbanRecurrenceStatus, KanbanSubtask } from "@kanban/shared";
import { randomUUID } from "node:crypto";
import { calculateFixedRecurrenceDueDates } from "./recurrence-rule";
import { occurrenceDateRange, parseRecurrenceTemplate, templateFromCard } from "./recurrence-template";

export interface RecurrenceGenerationSeries {
    id: string;
    cycle: KanbanRecurrenceCycle;
    status: KanbanRecurrenceStatus;
    activeBatonCardId?: string;
    templateJson: string;
    lastOccurrenceDate: number;
    anchorDay: number;
}

export interface GeneratedOccurrenceRecord {
    seriesId: string;
    sourceCardId: string;
    card: KanbanCard;
    occurrenceDate: number;
    labelIds: string[];
    now: number;
}

export interface RecurrenceOccurrenceGeneratorAdapter {
    listActiveFixedSeries(): RecurrenceGenerationSeries[];
    updateSeriesLastOccurrenceDate(seriesId: string, lastOccurrenceDate: number, now: number): void;
    requireSeries(id: string): RecurrenceGenerationSeries;
    requireCard(id: string): KanbanCard;
    requireGeneratedCard(id: string): KanbanCard;
    stopSeriesForActiveBaton(cardId: string, now: number): void;
    ensureTargetColumn(boardId: string, now: number): KanbanColumn;
    nextCardOrder(columnId: string): number;
    labelBelongsToBoard(labelId: string, boardId: string): boolean;
    saveGeneratedOccurrence(record: GeneratedOccurrenceRecord): void;
}

export class RecurrenceOccurrenceGenerator {
    constructor(private readonly adapter: RecurrenceOccurrenceGeneratorAdapter) { }

    generateDueFixed(now: number): void {
        for (const series of this.adapter.listActiveFixedSeries()) {
            const due = calculateFixedRecurrenceDueDates({
                lastOccurrenceDate: series.lastOccurrenceDate,
                cycle: series.cycle,
                anchorDay: series.anchorDay,
                now
            });
            for (const occurrenceDate of due.occurrenceDates) {
                this.generateNext(series.id, occurrenceDate, now);
            }
            if (due.skippedThroughDate !== undefined) {
                this.adapter.updateSeriesLastOccurrenceDate(series.id, due.skippedThroughDate, now);
            }
        }
    }

    generateNext(seriesId: string, occurrenceDate: number, now: number): KanbanCard | undefined {
        const series = this.adapter.requireSeries(seriesId);
        if (series.status !== "active" || !series.activeBatonCardId) return undefined;

        const source = this.adapter.requireCard(series.activeBatonCardId);
        if (source.archivedAt) {
            this.adapter.stopSeriesForActiveBaton(source.id, now);
            return undefined;
        }

        const targetColumn = this.adapter.ensureTargetColumn(source.boardId, now);
        const template = parseRecurrenceTemplate(series.templateJson) ?? templateFromCard(source);
        const dateRange = occurrenceDateRange(source, occurrenceDate);
        const card: KanbanCard = {
            id: randomUUID(),
            boardId: source.boardId,
            columnId: targetColumn.id,
            title: template.title,
            descriptionMarkdown: template.descriptionMarkdown,
            descriptionJson: template.descriptionJson,
            descriptionText: template.descriptionText,
            priority: template.priority,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            sortOrder: this.adapter.nextCardOrder(targetColumn.id),
            createdAt: now,
            updatedAt: now,
            labelIds: [],
            subtasks: resetTemplateSubtasks(template.subtasks, now),
            comments: []
        };
        const labelIds = template.labelIds.filter((labelId) => this.adapter.labelBelongsToBoard(labelId, source.boardId));
        this.adapter.saveGeneratedOccurrence({ seriesId, sourceCardId: source.id, card, occurrenceDate, labelIds, now });
        return this.adapter.requireGeneratedCard(card.id);
    }
}

function resetTemplateSubtasks(subtasks: KanbanSubtask[], now: number): KanbanSubtask[] {
    return subtasks.map((subtask) => ({
        id: randomUUID(),
        title: subtask.title,
        completed: false,
        createdAt: now,
        updatedAt: now
    }));
}
