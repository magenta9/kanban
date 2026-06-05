import type { KanbanCard, KanbanColumn } from "@kanban/shared";
import { describe, expect, it, vi } from "vitest";
import {
    RecurrenceOccurrenceGenerator,
    type GeneratedOccurrenceRecord,
    type RecurrenceGenerationSeries,
    type RecurrenceOccurrenceGeneratorAdapter
} from "./recurrence-occurrence-generator";
import { dateOnlyTimestampFromTimestamp } from "./recurrence-rule";
import { serializeRecurrenceTemplate, templateFromCard } from "./recurrence-template";

function date(year: number, month: number, day: number): number {
    return new Date(year, month, day).getTime();
}

function testColumn(input: Partial<KanbanColumn> = {}): KanbanColumn {
    return {
        id: "todo",
        boardId: "board-1",
        name: "Todo",
        sortOrder: 1000,
        createdAt: 1,
        updatedAt: 1,
        ...input
    };
}

function testCard(input: Partial<KanbanCard> = {}): KanbanCard {
    return {
        id: "card-1",
        boardId: "board-1",
        columnId: "done",
        title: "Review notes",
        priority: "medium",
        sortOrder: 1000,
        createdAt: 1,
        updatedAt: 1,
        labelIds: ["label-1", "missing-label"],
        subtasks: [{ id: "subtask-1", title: "Read", completed: true, createdAt: 1, updatedAt: 1 }],
        comments: [{ id: "comment-1", body: "Keep private state out of future occurrences", createdAt: 1, updatedAt: 1 }],
        ...input
    };
}

function testSeries(input: Partial<RecurrenceGenerationSeries> = {}): RecurrenceGenerationSeries {
    const card = testCard();
    return {
        id: "series-1",
        cycle: "daily",
        status: "active",
        activeBatonCardId: card.id,
        templateJson: serializeRecurrenceTemplate(templateFromCard(card)),
        lastOccurrenceDate: date(2026, 0, 1),
        anchorDay: 1,
        ...input
    };
}

function createAdapter(input: {
    series?: RecurrenceGenerationSeries;
    card?: KanbanCard;
    generatedCard?: KanbanCard;
    fixedSeries?: RecurrenceGenerationSeries[];
    targetColumn?: KanbanColumn;
} = {}) {
    const series = input.series ?? testSeries();
    const card = input.card ?? testCard({ id: series.activeBatonCardId ?? "card-1" });
    const generatedCard = input.generatedCard ?? testCard({ id: "generated-card", columnId: "todo", labelIds: ["label-1"] });
    const adapter = {
        listActiveFixedSeries: vi.fn(() => input.fixedSeries ?? [series]),
        updateSeriesLastOccurrenceDate: vi.fn(),
        requireSeries: vi.fn(() => series),
        requireCard: vi.fn(() => card),
        requireGeneratedCard: vi.fn(() => generatedCard),
        stopSeriesForActiveBaton: vi.fn(),
        ensureTargetColumn: vi.fn(() => input.targetColumn ?? testColumn()),
        nextCardOrder: vi.fn(() => 2000),
        labelBelongsToBoard: vi.fn((labelId: string) => labelId === "label-1"),
        saveGeneratedOccurrence: vi.fn()
    } satisfies RecurrenceOccurrenceGeneratorAdapter;
    return { adapter, generator: new RecurrenceOccurrenceGenerator(adapter), series, card };
}

describe("RecurrenceOccurrenceGenerator", () => {
    it("generates only the latest missed fixed-time Occurrences and records skipped history", () => {
        const now = new Date(2026, 0, 12, 9).getTime();
        const series = testSeries({ lastOccurrenceDate: date(2026, 0, 1), anchorDay: 1 });
        const { adapter, generator } = createAdapter({ series, fixedSeries: [series] });

        generator.generateDueFixed(now);

        const savedRecords = adapter.saveGeneratedOccurrence.mock.calls.map((call) => call[0] as GeneratedOccurrenceRecord);
        expect(savedRecords).toHaveLength(7);
        expect(savedRecords.map((record) => record.occurrenceDate)).toEqual([
            date(2026, 0, 6),
            date(2026, 0, 7),
            date(2026, 0, 8),
            date(2026, 0, 9),
            date(2026, 0, 10),
            date(2026, 0, 11),
            date(2026, 0, 12)
        ]);
        expect(adapter.updateSeriesLastOccurrenceDate).toHaveBeenCalledWith("series-1", date(2026, 0, 12), now);
    });

    it("stops the Recurrence Series when the active Baton Card is archived", () => {
        const now = 123;
        const { adapter, generator } = createAdapter({ card: testCard({ archivedAt: 100 }) });

        const result = generator.generateNext("series-1", date(2026, 0, 2), now);

        expect(result).toBeUndefined();
        expect(adapter.stopSeriesForActiveBaton).toHaveBeenCalledWith("card-1", now);
        expect(adapter.saveGeneratedOccurrence).not.toHaveBeenCalled();
    });

    it("creates the next Occurrence from the Series Template without carrying execution state forward", () => {
        const now = 123;
        const occurrenceDate = dateOnlyTimestampFromTimestamp(date(2026, 0, 2));
        const { adapter, generator } = createAdapter();

        generator.generateNext("series-1", occurrenceDate, now);

        const record = adapter.saveGeneratedOccurrence.mock.calls[0]?.[0] as GeneratedOccurrenceRecord | undefined;
        expect(record).toBeDefined();
        expect(record?.seriesId).toBe("series-1");
        expect(record?.sourceCardId).toBe("card-1");
        expect(record?.occurrenceDate).toBe(occurrenceDate);
        expect(record?.labelIds).toEqual(["label-1"]);
        expect(record?.card).toMatchObject({
            boardId: "board-1",
            columnId: "todo",
            title: "Review notes",
            priority: "medium",
            startDate: occurrenceDate,
            endDate: occurrenceDate,
            comments: []
        });
        expect(record?.card.subtasks).toHaveLength(1);
        expect(record?.card.subtasks[0]).toMatchObject({ title: "Read", completed: false, createdAt: now, updatedAt: now });
    });
});
