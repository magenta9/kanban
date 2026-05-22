import type {
    CreateKanbanBoardInput,
    CreateKanbanCardInput,
    CreateKanbanColumnInput,
    CreateKanbanLabelInput,
    EnableKanbanRecurrenceInput,
    KanbanBoard,
    KanbanBoardExport,
    KanbanCard,
    KanbanCardLabel,
    KanbanCardPatch,
    KanbanCardRecurrenceSummary,
    KanbanColumn,
    KanbanColumnPatch,
    KanbanComment,
    KanbanLabel,
    KanbanPriority,
    KanbanRecurrenceCycle,
    KanbanRecurrenceOccurrence,
    KanbanRecurrenceSeries,
    KanbanRecurrenceStatus,
    KanbanRecurrenceTrigger,
    KanbanRichTextDocument,
    KanbanSubtask,
    UpdateKanbanRecurrenceInput
} from "@kanban/shared";
import { markdownToPlainText } from "@kanban/shared";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const defaultColumns = ["Backlog", "Todo", "In Progress", "Done"];
const validPriorities = new Set<KanbanPriority>(["none", "low", "medium", "high", "urgent"]);
const validRecurrenceTriggers = new Set<KanbanRecurrenceTrigger>(["fixed", "completion"]);
const validRecurrenceCycles = new Set<KanbanRecurrenceCycle>(["daily", "weekly", "monthly"]);
const orderStep = 1000;
const oneDayMs = 24 * 60 * 60 * 1000;
const fixedRecurrenceHour = 8;
const fixedCatchUpLimit = 7;

interface BoardRow {
    id: string;
    name: string;
    description: string | null;
    completion_column_id: string | null;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
}

interface ColumnRow {
    id: string;
    board_id: string;
    name: string;
    color: string | null;
    sort_order: number;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
}

interface CardRow {
    id: string;
    board_id: string;
    column_id: string;
    title: string;
    description_markdown: string | null;
    description_json: string | null;
    description_text: string | null;
    subtasks_json: string;
    comments_json: string;
    priority: KanbanPriority;
    due_date: number | null;
    start_date: number | null;
    end_date: number | null;
    sort_order: number;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
}

interface LabelRow {
    id: string;
    board_id: string;
    name: string;
    color: string;
}

interface CardLabelRow {
    card_id: string;
    label_id: string;
}

interface RecurrenceSeriesRow {
    id: string;
    board_id: string;
    trigger_mode: KanbanRecurrenceTrigger;
    cycle: KanbanRecurrenceCycle;
    active_baton_card_id: string | null;
    template_json: string;
    status: KanbanRecurrenceStatus;
    blocked_reason: string | null;
    last_occurrence_date: number;
    anchor_day: number;
    created_at: number;
    updated_at: number;
    stopped_at: number | null;
}

interface RecurrenceOccurrenceRow {
    series_id: string;
    card_id: string;
    occurrence_date: number;
    generated_next_at: number | null;
    created_at: number;
}

interface RecurrenceTemplate {
    title: string;
    descriptionMarkdown?: string;
    descriptionJson?: KanbanRichTextDocument;
    descriptionText?: string;
    priority: KanbanPriority;
    labelIds: string[];
    subtasks: KanbanSubtask[];
}

export class KanbanRepository {
    constructor(private readonly database: Database.Database) { }

    listBoards(): KanbanBoard[] {
        const rows = this.database
            .prepare("SELECT * FROM kanban_boards WHERE archived_at IS NULL ORDER BY updated_at DESC")
            .all() as BoardRow[];
        return rows.map(rowToBoard);
    }

    createBoard(input: CreateKanbanBoardInput): KanbanBoard {
        const name = normalizeName(input.name, "Board name is required.");
        const now = Date.now();
        const board: KanbanBoard = {
            id: randomUUID(),
            name,
            description: normalizeOptionalText(input.description),
            createdAt: now,
            updatedAt: now
        };

        this.database.transaction(() => {
            this.database
                .prepare(
                    `INSERT INTO kanban_boards (id, name, description, created_at, updated_at, archived_at)
           VALUES (@id, @name, @description, @createdAt, @updatedAt, NULL)`
                )
                .run({ ...board, description: board.description ?? null });
            for (const [index, columnName] of defaultColumns.entries()) {
                const columnId = randomUUID();
                this.insertColumn({
                    id: columnId,
                    boardId: board.id,
                    name: columnName,
                    color: defaultColumnColor(index),
                    sortOrder: (index + 1) * orderStep,
                    createdAt: now,
                    updatedAt: now
                });
                if (columnName === "Done") {
                    this.database.prepare("UPDATE kanban_boards SET completion_column_id = ? WHERE id = ?").run(columnId, board.id);
                }
            }
        })();

        return this.requireBoard(board.id);
    }

    renameBoard(input: { id: string; name: string }): KanbanBoard {
        const name = normalizeName(input.name, "Board name is required.");
        const updatedAt = Date.now();
        this.database.prepare("UPDATE kanban_boards SET name = ?, updated_at = ? WHERE id = ?").run(name, updatedAt, input.id);
        return this.requireBoard(input.id);
    }

    deleteBoard(input: { id: string }): void {
        this.database.transaction(() => {
            this.database
                .prepare(
                    `DELETE FROM kanban_card_labels
           WHERE card_id IN (SELECT id FROM kanban_cards WHERE board_id = ?)`
                )
                .run(input.id);
            this.database.prepare("DELETE FROM kanban_cards WHERE board_id = ?").run(input.id);
            this.database.prepare("DELETE FROM kanban_columns WHERE board_id = ?").run(input.id);
            this.database.prepare("DELETE FROM kanban_labels WHERE board_id = ?").run(input.id);
            this.database.prepare("DELETE FROM kanban_boards WHERE id = ?").run(input.id);
        })();
    }

    listColumns(input: { boardId: string; includeArchived?: boolean }): KanbanColumn[] {
        const rows = input.includeArchived
            ? this.database
                .prepare("SELECT * FROM kanban_columns WHERE board_id = ? ORDER BY sort_order ASC")
                .all(input.boardId)
            : this.database
                .prepare("SELECT * FROM kanban_columns WHERE board_id = ? AND archived_at IS NULL ORDER BY sort_order ASC")
                .all(input.boardId);
        return (rows as ColumnRow[]).map(rowToColumn);
    }

    createColumn(input: CreateKanbanColumnInput): KanbanColumn {
        this.requireBoard(input.boardId);
        const now = Date.now();
        const column: KanbanColumn = {
            id: randomUUID(),
            boardId: input.boardId,
            name: normalizeName(input.name, "Column name is required."),
            color: normalizeOptionalText(input.color),
            sortOrder: this.nextColumnOrder(input.boardId),
            createdAt: now,
            updatedAt: now
        };
        this.insertColumn(column);
        this.touchBoard(input.boardId, now);
        return column;
    }

    updateColumn(input: { id: string; patch: Partial<KanbanColumnPatch> }): KanbanColumn {
        const current = this.requireColumn(input.id);
        const nextName = input.patch.name === undefined ? current.name : normalizeName(input.patch.name, "Column name is required.");
        const nextColor = input.patch.color === undefined ? current.color : normalizeOptionalText(input.patch.color);
        const updatedAt = Date.now();
        this.database
            .prepare("UPDATE kanban_columns SET name = ?, color = ?, updated_at = ? WHERE id = ?")
            .run(nextName, nextColor ?? null, updatedAt, input.id);
        this.touchBoard(current.boardId, updatedAt);
        return this.requireColumn(input.id);
    }

    setCompletionColumn(input: { boardId: string; columnId: string }): KanbanBoard {
        this.requireBoard(input.boardId);
        const column = this.requireColumn(input.columnId);
        if (column.boardId !== input.boardId) {
            throw new Error("Completion column must belong to the target board.");
        }
        if (column.archivedAt) {
            throw new Error("Completion column must be active.");
        }
        const updatedAt = Date.now();
        this.database.prepare("UPDATE kanban_boards SET completion_column_id = ?, updated_at = ? WHERE id = ?").run(input.columnId, updatedAt, input.boardId);
        return this.requireBoard(input.boardId);
    }

    reorderColumn(input: { id: string; beforeId?: string; afterId?: string }): KanbanColumn {
        const column = this.requireColumn(input.id);
        const before = input.beforeId ? this.requireColumn(input.beforeId) : undefined;
        const after = input.afterId ? this.requireColumn(input.afterId) : undefined;
        ensureSameBoard(column.boardId, before, after);
        const sortOrder = orderBetween(before?.sortOrder, after?.sortOrder);
        const updatedAt = Date.now();
        this.database.prepare("UPDATE kanban_columns SET sort_order = ?, updated_at = ? WHERE id = ?").run(sortOrder, updatedAt, input.id);
        this.touchBoard(column.boardId, updatedAt);
        return this.requireColumn(input.id);
    }

    archiveColumn(input: { id: string }): KanbanColumn {
        const column = this.requireColumn(input.id);
        const activeCardCount = this.database
            .prepare("SELECT COUNT(*) AS count FROM kanban_cards WHERE column_id = ? AND archived_at IS NULL")
            .get(input.id) as { count: number };
        if (activeCardCount.count > 0) {
            throw new Error("Move or archive active cards before archiving this column.");
        }
        const now = Date.now();
        this.database.prepare("UPDATE kanban_columns SET archived_at = ?, updated_at = ? WHERE id = ?").run(now, now, input.id);
        this.touchBoard(column.boardId, now);
        return this.requireColumn(input.id);
    }

    restoreColumn(input: { id: string }): KanbanColumn {
        const column = this.requireColumn(input.id);
        const now = Date.now();
        this.database.prepare("UPDATE kanban_columns SET archived_at = NULL, updated_at = ? WHERE id = ?").run(now, input.id);
        this.touchBoard(column.boardId, now);
        return this.requireColumn(input.id);
    }

    listCards(input: { boardId: string; includeArchived?: boolean }): KanbanCard[] {
        const rows = input.includeArchived
            ? this.database.prepare("SELECT * FROM kanban_cards WHERE board_id = ? ORDER BY sort_order ASC").all(input.boardId)
            : this.database
                .prepare("SELECT * FROM kanban_cards WHERE board_id = ? AND archived_at IS NULL ORDER BY sort_order ASC")
                .all(input.boardId);
        return this.attachRecurrenceSummaries(this.attachCardLabels((rows as CardRow[]).map(rowToCard)));
    }

    createCard(input: CreateKanbanCardInput): KanbanCard {
        const column = this.requireColumn(input.columnId);
        if (column.boardId !== input.boardId) {
            throw new Error("Column does not belong to the target board.");
        }
        const now = Date.now();
        const card: KanbanCard = {
            id: randomUUID(),
            boardId: input.boardId,
            columnId: input.columnId,
            title: normalizeName(input.title, "Card title is required."),
            priority: "none",
            sortOrder: this.nextCardOrder(input.columnId),
            createdAt: now,
            updatedAt: now,
            labelIds: [],
            subtasks: [],
            comments: []
        };
        this.insertCard(card);
        this.touchBoard(input.boardId, now);
        return card;
    }

    updateCard(input: { id: string; patch: Partial<KanbanCardPatch> }): KanbanCard {
        const current = this.requireCard(input.id);
        const nextColumnId = input.patch.columnId ?? current.columnId;
        const targetColumn = this.requireColumn(nextColumnId);
        if (targetColumn.boardId !== current.boardId) {
            throw new Error("Column does not belong to the card board.");
        }
        const nextPriority = input.patch.priority ?? current.priority;
        if (!validPriorities.has(nextPriority)) {
            throw new Error(`Invalid Kanban priority: ${nextPriority}`);
        }
        const hasDueDatePatch = Object.prototype.hasOwnProperty.call(input.patch, "dueDate");
        const hasStartDatePatch = Object.prototype.hasOwnProperty.call(input.patch, "startDate");
        const hasEndDatePatch = Object.prototype.hasOwnProperty.call(input.patch, "endDate");
        const hasDateRangePatch = hasStartDatePatch || hasEndDatePatch;
        let nextDueDate = hasDueDatePatch ? input.patch.dueDate ?? null : current.dueDate ?? null;
        let nextStartDate = hasStartDatePatch ? input.patch.startDate ?? null : current.startDate ?? null;
        let nextEndDate = hasEndDatePatch ? input.patch.endDate ?? null : current.endDate ?? null;
        if (hasDueDatePatch && !hasDateRangePatch) {
            nextStartDate = nextDueDate;
            nextEndDate = nextDueDate;
        }
        if (hasDateRangePatch && !hasDueDatePatch) {
            nextDueDate = null;
        }
        const updatedAt = Date.now();
        const nextDescriptionMarkdown = input.patch.descriptionMarkdown === undefined
            ? current.descriptionMarkdown ?? null
            : normalizeOptionalText(input.patch.descriptionMarkdown) ?? null;
        const nextDescriptionText = input.patch.descriptionText === undefined
            ? (input.patch.descriptionMarkdown === undefined ? current.descriptionText ?? null : markdownToPlainText(input.patch.descriptionMarkdown) ?? null)
            : normalizeOptionalText(input.patch.descriptionText) ?? null;
        this.database
            .prepare(
                `UPDATE kanban_cards
         SET title = ?, column_id = ?, description_markdown = ?, description_json = ?, description_text = ?, subtasks_json = ?, comments_json = ?, priority = ?, due_date = ?, start_date = ?, end_date = ?, updated_at = ?
         WHERE id = ?`
            )
            .run(
                input.patch.title === undefined ? current.title : normalizeName(input.patch.title, "Card title is required."),
                nextColumnId,
                nextDescriptionMarkdown,
                input.patch.descriptionJson === undefined ? serializeRichText(current.descriptionJson) : serializeRichText(input.patch.descriptionJson),
                nextDescriptionText,
                input.patch.subtasks === undefined ? serializeSubtasks(current.subtasks) : serializeSubtasks(input.patch.subtasks),
                input.patch.comments === undefined ? serializeComments(current.comments) : serializeComments(input.patch.comments),
                nextPriority,
                normalizeTimestamp(nextDueDate, "dueDate"),
                normalizeTimestamp(nextStartDate, "startDate"),
                normalizeTimestamp(nextEndDate, "endDate"),
                updatedAt,
                input.id
            );
        this.touchBoard(current.boardId, updatedAt);
        this.updateTemplateForActiveBaton(input.id);
        this.generateNextForCompletedCard(input.id, updatedAt);
        return this.requireCard(input.id);
    }

    deleteCard(input: { id: string }): void {
        const card = this.requireCard(input.id);
        this.stopSeriesForActiveBaton(input.id);
        this.database.prepare("DELETE FROM kanban_cards WHERE id = ?").run(input.id);
        this.touchBoard(card.boardId, Date.now());
    }

    archiveCard(input: { id: string }): KanbanCard {
        const card = this.requireCard(input.id);
        const now = Date.now();
        this.stopSeriesForActiveBaton(input.id, now);
        this.database.prepare("UPDATE kanban_cards SET archived_at = ?, updated_at = ? WHERE id = ?").run(now, now, input.id);
        this.touchBoard(card.boardId, now);
        return this.requireCard(input.id);
    }

    restoreCard(input: { id: string }): KanbanCard {
        const card = this.requireCard(input.id);
        const now = Date.now();
        this.database.prepare("UPDATE kanban_cards SET archived_at = NULL, updated_at = ? WHERE id = ?").run(now, input.id);
        this.touchBoard(card.boardId, now);
        return this.requireCard(input.id);
    }

    reorderCard(input: { id: string; toColumnId: string; beforeId?: string; afterId?: string }): KanbanCard {
        const card = this.requireCard(input.id);
        const targetColumn = this.requireColumn(input.toColumnId);
        if (targetColumn.boardId !== card.boardId) {
            throw new Error("Column does not belong to the card board.");
        }
        const before = input.beforeId ? this.requireCard(input.beforeId) : undefined;
        const after = input.afterId ? this.requireCard(input.afterId) : undefined;
        ensureSameColumn(input.toColumnId, before, after);
        const sortOrder = orderBetween(before?.sortOrder, after?.sortOrder);
        const updatedAt = Date.now();
        this.database
            .prepare("UPDATE kanban_cards SET column_id = ?, sort_order = ?, updated_at = ? WHERE id = ?")
            .run(input.toColumnId, sortOrder, updatedAt, input.id);
        this.touchBoard(card.boardId, updatedAt);
        this.generateNextForCompletedCard(input.id, updatedAt);
        return this.requireCard(input.id);
    }

    listLabels(input: { boardId: string }): KanbanLabel[] {
        const rows = this.database.prepare("SELECT * FROM kanban_labels WHERE board_id = ? ORDER BY name ASC").all(input.boardId);
        return (rows as LabelRow[]).map(rowToLabel);
    }

    createLabel(input: CreateKanbanLabelInput): KanbanLabel {
        this.requireBoard(input.boardId);
        const label: KanbanLabel = {
            id: randomUUID(),
            boardId: input.boardId,
            name: normalizeName(input.name, "Label name is required."),
            color: normalizeName(input.color, "Label color is required.")
        };
        this.database.prepare("INSERT INTO kanban_labels (id, board_id, name, color) VALUES (@id, @boardId, @name, @color)").run(label);
        this.touchBoard(input.boardId, Date.now());
        return label;
    }

    deleteLabel(input: { id: string }): void {
        const label = this.requireLabel(input.id);
        this.database.prepare("DELETE FROM kanban_labels WHERE id = ?").run(input.id);
        this.touchBoard(label.boardId, Date.now());
    }

    setCardLabels(input: { cardId: string; labelIds: string[] }): void {
        const card = this.requireCard(input.cardId);
        const labels = input.labelIds.map((labelId) => this.requireLabel(labelId));
        if (labels.some((label) => label.boardId !== card.boardId)) {
            throw new Error("Labels must belong to the card board.");
        }
        this.database.transaction(() => {
            this.database.prepare("DELETE FROM kanban_card_labels WHERE card_id = ?").run(input.cardId);
            const insert = this.database.prepare("INSERT INTO kanban_card_labels (card_id, label_id) VALUES (?, ?)");
            for (const labelId of new Set(input.labelIds)) {
                insert.run(input.cardId, labelId);
            }
        })();
        this.touchBoard(card.boardId, Date.now());
        this.updateTemplateForActiveBaton(input.cardId);
    }

    enableCardRecurrence(input: EnableKanbanRecurrenceInput): KanbanCard {
        const card = this.requireCard(input.cardId);
        if (card.archivedAt) {
            throw new Error("已归档卡片不能开启周期。");
        }
        const trigger = normalizeRecurrenceTrigger(input.trigger);
        const cycle = normalizeRecurrenceCycle(input.cycle);
        const existing = this.activeSeriesForCard(input.cardId);
        if (existing) {
            return this.updateCardRecurrence({ cardId: input.cardId, trigger, cycle });
        }
        const now = Date.now();
        const occurrenceDate = dateOnlyTimestampFromTimestamp(card.startDate ?? now);
        this.database.transaction(() => {
            this.database
                .prepare(
                    `INSERT INTO kanban_recurrence_series
             (id, board_id, trigger_mode, cycle, active_baton_card_id, template_json, status, blocked_reason, last_occurrence_date, anchor_day, created_at, updated_at, stopped_at)
             VALUES (@id, @boardId, @trigger, @cycle, @activeBatonCardId, @templateJson, 'active', NULL, @lastOccurrenceDate, @anchorDay, @createdAt, @updatedAt, NULL)`
                )
                .run({
                    id: randomUUID(),
                    boardId: card.boardId,
                    trigger,
                    cycle,
                    activeBatonCardId: card.id,
                    templateJson: serializeRecurrenceTemplate(templateFromCard(card)),
                    lastOccurrenceDate: occurrenceDate,
                    anchorDay: new Date(occurrenceDate).getDate(),
                    createdAt: now,
                    updatedAt: now
                });
            this.database
                .prepare(
                    `INSERT INTO kanban_recurrence_occurrences (series_id, card_id, occurrence_date, generated_next_at, created_at)
           SELECT id, ?, ?, NULL, ? FROM kanban_recurrence_series WHERE active_baton_card_id = ? AND status = 'active'`
                )
                .run(card.id, occurrenceDate, now, card.id);
        })();
        return this.requireCard(card.id);
    }

    updateCardRecurrence(input: UpdateKanbanRecurrenceInput): KanbanCard {
        const card = this.requireCard(input.cardId);
        const series = this.requireActiveSeriesForCard(card.id);
        const trigger = normalizeRecurrenceTrigger(input.trigger);
        const cycle = normalizeRecurrenceCycle(input.cycle);
        const now = Date.now();
        this.database
            .prepare(
                `UPDATE kanban_recurrence_series
         SET trigger_mode = ?, cycle = ?, status = 'active', blocked_reason = NULL, updated_at = ?
         WHERE id = ?`
            )
            .run(trigger, cycle, now, series.id);
        return this.requireCard(card.id);
    }

    disableCardRecurrence(input: { cardId: string }): KanbanCard {
        const card = this.requireCard(input.cardId);
        this.stopSeriesForActiveBaton(card.id);
        return this.requireCard(card.id);
    }

    generateDueRecurrences(input: { now?: number } = {}): void {
        const now = input.now ?? Date.now();
        const dueDate = fixedDueDate(now);
        const rows = this.database
            .prepare("SELECT * FROM kanban_recurrence_series WHERE trigger_mode = 'fixed' AND status = 'active'")
            .all() as RecurrenceSeriesRow[];
        for (const row of rows) {
            let nextDate = addCycle(row.last_occurrence_date, row.cycle, row.anchor_day);
            const dueDates: number[] = [];
            while (nextDate <= dueDate) {
                dueDates.push(nextDate);
                nextDate = addCycle(nextDate, row.cycle, row.anchor_day);
            }
            const recentDueDates = dueDates.slice(-fixedCatchUpLimit);
            for (const occurrenceDate of recentDueDates) {
                this.generateOccurrence(row.id, occurrenceDate, now);
            }
            if (dueDates.length > fixedCatchUpLimit) {
                this.database
                    .prepare("UPDATE kanban_recurrence_series SET last_occurrence_date = ?, updated_at = ? WHERE id = ?")
                    .run(dueDates[dueDates.length - 1], now, row.id);
            }
        }
    }

    exportBoard(input: { boardId: string }): KanbanBoardExport {
        const board = this.requireBoard(input.boardId);
        const columns = this.listColumns({ boardId: input.boardId, includeArchived: true });
        const cards = this.listCards({ boardId: input.boardId, includeArchived: true });
        const labels = this.listLabels({ boardId: input.boardId });
        const cardLabels = this.listCardLabels(input.boardId);
        const recurrenceSeries = this.listRecurrenceSeries(input.boardId);
        const recurrenceOccurrences = this.listRecurrenceOccurrences(input.boardId);
        return { version: 1, exportedAt: Date.now(), board, columns, cards, labels, cardLabels, recurrenceSeries, recurrenceOccurrences };
    }

    importBoard(input: { payload: KanbanBoardExport }): KanbanBoard {
        if (input.payload.version !== 1) {
            throw new Error("Unsupported Kanban export version.");
        }
        const now = Date.now();
        const boardId = randomUUID();
        const columnIds = new Map(input.payload.columns.map((column) => [column.id, randomUUID()]));
        const cardIds = new Map(input.payload.cards.map((card) => [card.id, randomUUID()]));
        const labelIds = new Map(input.payload.labels.map((label) => [label.id, randomUUID()]));
        const board: KanbanBoard = {
            id: boardId,
            name: `${input.payload.board.name} Copy`,
            description: input.payload.board.description,
            completionColumnId: input.payload.board.completionColumnId ? columnIds.get(input.payload.board.completionColumnId) : undefined,
            createdAt: now,
            updatedAt: now,
            archivedAt: input.payload.board.archivedAt
        };

        this.database.transaction(() => {
            this.database
                .prepare(
                    `INSERT INTO kanban_boards (id, name, description, completion_column_id, created_at, updated_at, archived_at)
             VALUES (@id, @name, @description, @completionColumnId, @createdAt, @updatedAt, @archivedAt)`
                )
                .run({ ...board, description: board.description ?? null, completionColumnId: board.completionColumnId ?? null, archivedAt: board.archivedAt ?? null });
            for (const column of input.payload.columns) {
                this.insertColumn({ ...column, id: columnIds.get(column.id) ?? randomUUID(), boardId });
            }
            for (const label of input.payload.labels) {
                this.database
                    .prepare("INSERT INTO kanban_labels (id, board_id, name, color) VALUES (@id, @boardId, @name, @color)")
                    .run({ ...label, id: labelIds.get(label.id), boardId });
            }
            for (const card of input.payload.cards) {
                const nextColumnId = columnIds.get(card.columnId);
                if (!nextColumnId) continue;
                this.insertCard({ ...card, id: cardIds.get(card.id) ?? randomUUID(), boardId, columnId: nextColumnId, labelIds: [] });
            }
            const insertCardLabel = this.database.prepare("INSERT OR IGNORE INTO kanban_card_labels (card_id, label_id) VALUES (?, ?)");
            for (const relation of input.payload.cardLabels) {
                const cardId = cardIds.get(relation.cardId);
                const labelId = labelIds.get(relation.labelId);
                if (cardId && labelId) insertCardLabel.run(cardId, labelId);
            }
            const seriesIds = new Map((input.payload.recurrenceSeries ?? []).map((series) => [series.id, randomUUID()]));
            for (const series of input.payload.recurrenceSeries ?? []) {
                const nextSeriesId = seriesIds.get(series.id);
                if (!nextSeriesId) continue;
                const activeBatonCardId = series.activeBatonCardId ? cardIds.get(series.activeBatonCardId) : undefined;
                this.database
                    .prepare(
                        `INSERT INTO kanban_recurrence_series
               (id, board_id, trigger_mode, cycle, active_baton_card_id, template_json, status, blocked_reason, last_occurrence_date, anchor_day, created_at, updated_at, stopped_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    )
                    .run(
                        nextSeriesId,
                        boardId,
                        series.trigger,
                        series.cycle,
                        activeBatonCardId ?? null,
                        remapTemplateLabels(series.templateJson, labelIds),
                        series.status,
                        series.blockedReason ?? null,
                        series.lastOccurrenceDate,
                        series.anchorDay,
                        now,
                        now,
                        series.stoppedAt ?? null
                    );
            }
            const insertOccurrence = this.database.prepare(
                "INSERT INTO kanban_recurrence_occurrences (series_id, card_id, occurrence_date, generated_next_at, created_at) VALUES (?, ?, ?, ?, ?)"
            );
            for (const occurrence of input.payload.recurrenceOccurrences ?? []) {
                const nextSeriesId = seriesIds.get(occurrence.seriesId);
                const nextCardId = cardIds.get(occurrence.cardId);
                if (nextSeriesId && nextCardId) {
                    insertOccurrence.run(nextSeriesId, nextCardId, occurrence.occurrenceDate, occurrence.generatedNextAt ?? null, now);
                }
            }
        })();

        return board;
    }

    private requireBoard(id: string): KanbanBoard {
        const row = this.database.prepare("SELECT * FROM kanban_boards WHERE id = ?").get(id) as BoardRow | undefined;
        if (!row) throw new Error(`Kanban board not found: ${id}`);
        return rowToBoard(row);
    }

    private requireColumn(id: string): KanbanColumn {
        const row = this.database.prepare("SELECT * FROM kanban_columns WHERE id = ?").get(id) as ColumnRow | undefined;
        if (!row) throw new Error(`Kanban column not found: ${id}`);
        return rowToColumn(row);
    }

    private requireCard(id: string): KanbanCard {
        const row = this.database.prepare("SELECT * FROM kanban_cards WHERE id = ?").get(id) as CardRow | undefined;
        if (!row) throw new Error(`Kanban card not found: ${id}`);
        return this.attachRecurrenceSummaries(this.attachCardLabels([rowToCard(row)]))[0]!;
    }

    private requireLabel(id: string): KanbanLabel {
        const row = this.database.prepare("SELECT * FROM kanban_labels WHERE id = ?").get(id) as LabelRow | undefined;
        if (!row) throw new Error(`Kanban label not found: ${id}`);
        return rowToLabel(row);
    }

    private insertColumn(column: KanbanColumn): void {
        this.database
            .prepare(
                `INSERT INTO kanban_columns (id, board_id, name, color, sort_order, created_at, updated_at, archived_at)
         VALUES (@id, @boardId, @name, @color, @sortOrder, @createdAt, @updatedAt, @archivedAt)`
            )
            .run({ ...column, color: column.color ?? null, archivedAt: column.archivedAt ?? null });
    }

    private insertCard(card: KanbanCard): void {
        this.database
            .prepare(
                `INSERT INTO kanban_cards
         (id, board_id, column_id, title, description_markdown, description_json, description_text, subtasks_json, comments_json, priority, due_date, start_date, end_date, sort_order, created_at, updated_at, archived_at)
         VALUES (@id, @boardId, @columnId, @title, @descriptionMarkdown, @descriptionJson, @descriptionText, @subtasksJson, @commentsJson, @priority, @dueDate, @startDate, @endDate, @sortOrder, @createdAt, @updatedAt, @archivedAt)`
            )
            .run({
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
            });
    }

    private nextColumnOrder(boardId: string): number {
        const row = this.database.prepare("SELECT MAX(sort_order) AS maxOrder FROM kanban_columns WHERE board_id = ?").get(boardId) as {
            maxOrder: number | null;
        };
        return (row.maxOrder ?? 0) + orderStep;
    }

    private nextCardOrder(columnId: string): number {
        const row = this.database.prepare("SELECT MAX(sort_order) AS maxOrder FROM kanban_cards WHERE column_id = ?").get(columnId) as {
            maxOrder: number | null;
        };
        return (row.maxOrder ?? 0) + orderStep;
    }

    private touchBoard(boardId: string, updatedAt: number): void {
        this.database.prepare("UPDATE kanban_boards SET updated_at = ? WHERE id = ?").run(updatedAt, boardId);
    }

    private attachCardLabels(cards: KanbanCard[]): KanbanCard[] {
        if (cards.length === 0) return cards;
        const labelsByCard = new Map<string, string[]>();
        const placeholders = cards.map(() => "?").join(",");
        const rows = this.database
            .prepare(`SELECT card_id, label_id FROM kanban_card_labels WHERE card_id IN (${placeholders})`)
            .all(...cards.map((card) => card.id)) as CardLabelRow[];
        for (const row of rows) {
            labelsByCard.set(row.card_id, [...(labelsByCard.get(row.card_id) ?? []), row.label_id]);
        }
        return cards.map((card) => ({ ...card, labelIds: labelsByCard.get(card.id) ?? [] }));
    }

    private attachRecurrenceSummaries(cards: KanbanCard[]): KanbanCard[] {
        if (cards.length === 0) return cards;
        const placeholders = cards.map(() => "?").join(",");
        const rows = this.database
            .prepare(
                `SELECT * FROM kanban_recurrence_series
         WHERE active_baton_card_id IN (${placeholders})
           AND status IN ('active', 'blocked')`
            )
            .all(...cards.map((card) => card.id)) as RecurrenceSeriesRow[];
        const summaries = new Map<string, KanbanCardRecurrenceSummary>();
        for (const row of rows) {
            if (!row.active_baton_card_id) continue;
            summaries.set(row.active_baton_card_id, {
                seriesId: row.id,
                trigger: row.trigger_mode,
                cycle: row.cycle,
                status: row.status,
                blockedReason: row.blocked_reason ?? undefined
            });
        }
        return cards.map((card) => ({ ...card, recurrence: summaries.get(card.id) }));
    }

    private listCardLabels(boardId: string): KanbanCardLabel[] {
        const rows = this.database
            .prepare(
                `SELECT relation.card_id, relation.label_id
         FROM kanban_card_labels relation
         JOIN kanban_cards cards ON cards.id = relation.card_id
         WHERE cards.board_id = ?`
            )
            .all(boardId) as CardLabelRow[];
        return rows.map((row) => ({ cardId: row.card_id, labelId: row.label_id }));
    }

    private listRecurrenceSeries(boardId: string): KanbanRecurrenceSeries[] {
        const rows = this.database.prepare("SELECT * FROM kanban_recurrence_series WHERE board_id = ?").all(boardId) as RecurrenceSeriesRow[];
        return rows.map(rowToRecurrenceSeries);
    }

    private listRecurrenceOccurrences(boardId: string): KanbanRecurrenceOccurrence[] {
        const rows = this.database
            .prepare(
                `SELECT occurrence.*
         FROM kanban_recurrence_occurrences occurrence
         JOIN kanban_recurrence_series series ON series.id = occurrence.series_id
         WHERE series.board_id = ?`
            )
            .all(boardId) as RecurrenceOccurrenceRow[];
        return rows.map(rowToRecurrenceOccurrence);
    }

    private activeSeriesForCard(cardId: string): RecurrenceSeriesRow | undefined {
        return this.database
            .prepare("SELECT * FROM kanban_recurrence_series WHERE active_baton_card_id = ? AND status IN ('active', 'blocked')")
            .get(cardId) as RecurrenceSeriesRow | undefined;
    }

    private requireActiveSeriesForCard(cardId: string): RecurrenceSeriesRow {
        const series = this.activeSeriesForCard(cardId);
        if (!series) throw new Error("当前卡片不是正在生效的周期卡片。");
        return series;
    }

    private requireRecurrenceSeries(id: string): RecurrenceSeriesRow {
        const row = this.database.prepare("SELECT * FROM kanban_recurrence_series WHERE id = ?").get(id) as RecurrenceSeriesRow | undefined;
        if (!row) throw new Error(`Recurrence series not found: ${id}`);
        return row;
    }

    private updateTemplateForActiveBaton(cardId: string): void {
        const series = this.activeSeriesForCard(cardId);
        if (!series || series.status === "stopped") return;
        const card = this.requireCard(cardId);
        if (card.archivedAt) return;
        const occurrenceDate = dateOnlyTimestampFromTimestamp(card.startDate ?? series.last_occurrence_date);
        const now = Date.now();
        this.database.transaction(() => {
            this.database
                .prepare(
                    `UPDATE kanban_recurrence_series
             SET template_json = ?, last_occurrence_date = ?, anchor_day = ?, status = 'active', blocked_reason = NULL, updated_at = ?
           WHERE id = ?`
                )
                .run(serializeRecurrenceTemplate(templateFromCard(card)), occurrenceDate, new Date(occurrenceDate).getDate(), now, series.id);
            this.database
                .prepare("UPDATE kanban_recurrence_occurrences SET occurrence_date = ? WHERE series_id = ? AND card_id = ?")
                .run(occurrenceDate, series.id, cardId);
        })();
    }

    private stopSeriesForActiveBaton(cardId: string, now = Date.now()): void {
        const series = this.activeSeriesForCard(cardId);
        if (!series) return;
        this.database
            .prepare(
                `UPDATE kanban_recurrence_series
         SET status = 'stopped', active_baton_card_id = NULL, stopped_at = ?, updated_at = ?
         WHERE id = ?`
            )
            .run(now, now, series.id);
    }

    private generateNextForCompletedCard(cardId: string, now = Date.now()): void {
        const series = this.activeSeriesForCard(cardId);
        if (!series || series.trigger_mode !== "completion" || series.status !== "active") return;
        const occurrence = this.database
            .prepare("SELECT * FROM kanban_recurrence_occurrences WHERE series_id = ? AND card_id = ?")
            .get(series.id, cardId) as RecurrenceOccurrenceRow | undefined;
        if (occurrence?.generated_next_at) return;
        const card = this.requireCard(cardId);
        const board = this.requireBoard(card.boardId);
        const completionColumnId = board.completionColumnId;
        const completionColumn = completionColumnId ? this.requireColumnIfExists(completionColumnId) : undefined;
        if (!completionColumn || completionColumn.archivedAt) {
            this.blockSeries(series.id, "请选择一个可用的完成列。", now);
            return;
        }
        if (card.columnId !== completionColumn.id) return;
        const nextOccurrenceDate = addCycle(dateOnlyTimestampFromTimestamp(now), series.cycle, new Date(now).getDate());
        this.generateOccurrence(series.id, nextOccurrenceDate, now);
    }

    private generateOccurrence(seriesId: string, occurrenceDate: number, now = Date.now()): KanbanCard | undefined {
        const series = this.requireRecurrenceSeries(seriesId);
        if (series.status !== "active" || !series.active_baton_card_id) return undefined;
        const source = this.requireCard(series.active_baton_card_id);
        if (source.archivedAt) {
            this.stopSeriesForActiveBaton(source.id, now);
            return undefined;
        }
        const targetColumn = this.ensureRecurrenceTargetColumn(source.boardId, now);
        const template = parseRecurrenceTemplate(series.template_json) ?? templateFromCard(source);
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
            sortOrder: this.nextCardOrder(targetColumn.id),
            createdAt: now,
            updatedAt: now,
            labelIds: [],
            subtasks: template.subtasks.map((subtask) => ({
                id: randomUUID(),
                title: subtask.title,
                completed: false,
                createdAt: now,
                updatedAt: now
            })),
            comments: []
        };
        this.database.transaction(() => {
            this.insertCard(card);
            const validLabelIds = template.labelIds.filter((labelId) => this.labelBelongsToBoard(labelId, source.boardId));
            const insertCardLabel = this.database.prepare("INSERT OR IGNORE INTO kanban_card_labels (card_id, label_id) VALUES (?, ?)");
            for (const labelId of validLabelIds) {
                insertCardLabel.run(card.id, labelId);
            }
            this.database
                .prepare("UPDATE kanban_recurrence_occurrences SET generated_next_at = ? WHERE series_id = ? AND card_id = ?")
                .run(now, series.id, source.id);
            this.database
                .prepare("INSERT INTO kanban_recurrence_occurrences (series_id, card_id, occurrence_date, generated_next_at, created_at) VALUES (?, ?, ?, NULL, ?)")
                .run(series.id, card.id, occurrenceDate, now);
            this.database
                .prepare(
                    `UPDATE kanban_recurrence_series
         SET active_baton_card_id = ?, last_occurrence_date = ?, anchor_day = ?, status = 'active', blocked_reason = NULL, updated_at = ?
           WHERE id = ?`
                )
                .run(card.id, occurrenceDate, new Date(occurrenceDate).getDate(), now, series.id);
            this.touchBoard(source.boardId, now);
        })();
        return this.requireCard(card.id);
    }

    private ensureRecurrenceTargetColumn(boardId: string, now: number): KanbanColumn {
        const board = this.requireBoard(boardId);
        const activeColumns = this.listColumns({ boardId }).filter((column) => !column.archivedAt);
        const target = activeColumns.find((column) => column.id !== board.completionColumnId);
        if (target) return target;

        const completionColumn = board.completionColumnId ? activeColumns.find((column) => column.id === board.completionColumnId) : undefined;
        const column: KanbanColumn = {
            id: randomUUID(),
            boardId,
            name: "Todo",
            color: defaultColumnColor(1),
            sortOrder: completionColumn ? completionColumn.sortOrder - orderStep : this.nextColumnOrder(boardId),
            createdAt: now,
            updatedAt: now
        };
        this.insertColumn(column);
        this.touchBoard(boardId, now);
        return column;
    }

    private blockSeries(seriesId: string, reason: string, now: number): void {
        this.database
            .prepare("UPDATE kanban_recurrence_series SET status = 'blocked', blocked_reason = ?, updated_at = ? WHERE id = ?")
            .run(reason, now, seriesId);
    }

    private requireColumnIfExists(id: string): KanbanColumn | undefined {
        const row = this.database.prepare("SELECT * FROM kanban_columns WHERE id = ?").get(id) as ColumnRow | undefined;
        return row ? rowToColumn(row) : undefined;
    }

    private labelBelongsToBoard(labelId: string, boardId: string): boolean {
        const row = this.database.prepare("SELECT id FROM kanban_labels WHERE id = ? AND board_id = ?").get(labelId, boardId);
        return Boolean(row);
    }
}

export function orderBetween(before?: number, after?: number): number {
    if (before === undefined && after === undefined) return orderStep;
    if (before === undefined && after !== undefined) return after - orderStep;
    if (before !== undefined && after === undefined) return before + orderStep;
    return ((before as number) + (after as number)) / 2;
}

function rowToBoard(row: BoardRow): KanbanBoard {
    return {
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        completionColumnId: row.completion_column_id ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: row.archived_at ?? undefined
    };
}

function rowToRecurrenceSeries(row: RecurrenceSeriesRow): KanbanRecurrenceSeries {
    return {
        id: row.id,
        boardId: row.board_id,
        trigger: row.trigger_mode,
        cycle: row.cycle,
        activeBatonCardId: row.active_baton_card_id ?? undefined,
        templateJson: row.template_json,
        status: row.status,
        blockedReason: row.blocked_reason ?? undefined,
        lastOccurrenceDate: row.last_occurrence_date,
        anchorDay: row.anchor_day,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        stoppedAt: row.stopped_at ?? undefined
    };
}

function rowToRecurrenceOccurrence(row: RecurrenceOccurrenceRow): KanbanRecurrenceOccurrence {
    return {
        seriesId: row.series_id,
        cardId: row.card_id,
        occurrenceDate: row.occurrence_date,
        generatedNextAt: row.generated_next_at ?? undefined,
        createdAt: row.created_at
    };
}

function rowToColumn(row: ColumnRow): KanbanColumn {
    return {
        id: row.id,
        boardId: row.board_id,
        name: row.name,
        color: row.color ?? undefined,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: row.archived_at ?? undefined
    };
}

function rowToCard(row: CardRow): KanbanCard {
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

function rowToLabel(row: LabelRow): KanbanLabel {
    return {
        id: row.id,
        boardId: row.board_id,
        name: row.name,
        color: row.color
    };
}

function normalizeName(value: string, message: string): string {
    const next = value.trim();
    if (!next) throw new Error(message);
    return next;
}

function normalizeOptionalText(value?: string): string | undefined {
    const next = value?.trim();
    return next ? next : undefined;
}

function normalizeTimestamp(value: number | null | undefined, field: string): number | null {
    if (value === undefined || value === null) return null;
    if (!Number.isFinite(value)) throw new Error(`Invalid Kanban ${field}.`);
    return Math.trunc(value);
}

function defaultColumnColor(index: number): string {
    return ["#9ca3af", "#3b82f6", "#f59e0b", "#22c55e"][index] ?? "#9ca3af";
}

function serializeRichText(value: KanbanRichTextDocument | undefined): string | null {
    return value === undefined ? null : JSON.stringify(value);
}

function parseRichText(value: string | null): KanbanRichTextDocument | undefined {
    if (!value) return undefined;
    try {
        return JSON.parse(value) as KanbanRichTextDocument;
    } catch {
        return undefined;
    }
}

function serializeSubtasks(value: KanbanSubtask[] | undefined): string {
    return JSON.stringify(value ?? []);
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

function serializeComments(value: KanbanComment[] | undefined): string {
    return JSON.stringify(value ?? []);
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

function normalizeRecurrenceTrigger(value: KanbanRecurrenceTrigger): KanbanRecurrenceTrigger {
    if (!validRecurrenceTriggers.has(value)) throw new Error(`Invalid Kanban recurrence trigger: ${value}`);
    return value;
}

function normalizeRecurrenceCycle(value: KanbanRecurrenceCycle): KanbanRecurrenceCycle {
    if (!validRecurrenceCycles.has(value)) throw new Error(`Invalid Kanban recurrence cycle: ${value}`);
    return value;
}

function templateFromCard(card: KanbanCard): RecurrenceTemplate {
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

function serializeRecurrenceTemplate(value: RecurrenceTemplate): string {
    return JSON.stringify(value);
}

function parseRecurrenceTemplate(value: string): RecurrenceTemplate | undefined {
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

function remapTemplateLabels(value: string, labelIds: Map<string, string>): string {
    const template = parseRecurrenceTemplate(value);
    if (!template) return value;
    return serializeRecurrenceTemplate({
        ...template,
        labelIds: template.labelIds.map((labelId) => labelIds.get(labelId)).filter((labelId): labelId is string => Boolean(labelId))
    });
}

function dateOnlyTimestampFromTimestamp(timestamp: number): number {
    const date = new Date(timestamp);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function fixedDueDate(now: number): number {
    const date = new Date(now);
    const todayAtFixedHour = new Date(date.getFullYear(), date.getMonth(), date.getDate(), fixedRecurrenceHour).getTime();
    const due = now >= todayAtFixedHour ? date : new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    return new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
}

function addCycle(timestamp: number, cycle: KanbanRecurrenceCycle, anchorDay?: number): number {
    const date = new Date(timestamp);
    if (cycle === "daily") return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    if (cycle === "weekly") return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7).getTime();
    const targetYear = date.getFullYear();
    const targetMonth = date.getMonth() + 1;
    const targetDay = Math.min(anchorDay ?? date.getDate(), new Date(targetYear, targetMonth + 1, 0).getDate());
    return new Date(targetYear, targetMonth, targetDay).getTime();
}

function occurrenceDateRange(source: KanbanCard, occurrenceDate: number): { startDate: number; endDate: number } {
    const sourceStart = source.startDate ?? source.dueDate;
    const sourceEnd = source.endDate ?? sourceStart;
    if (sourceStart === undefined || sourceEnd === undefined) {
        return { startDate: occurrenceDate, endDate: occurrenceDate };
    }
    const span = Math.max(0, dateOnlyTimestampFromTimestamp(sourceEnd) - dateOnlyTimestampFromTimestamp(sourceStart));
    return { startDate: occurrenceDate, endDate: occurrenceDate + span };
}

function ensureSameBoard(boardId: string, ...columns: Array<KanbanColumn | undefined>): void {
    if (columns.some((column) => column && column.boardId !== boardId)) {
        throw new Error("Columns must belong to the same board.");
    }
}

function ensureSameColumn(columnId: string, ...cards: Array<KanbanCard | undefined>): void {
    if (cards.some((card) => card && card.columnId !== columnId)) {
        throw new Error("Cards must belong to the target column.");
    }
}
