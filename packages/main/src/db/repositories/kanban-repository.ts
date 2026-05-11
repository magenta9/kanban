import type {
    CreateKanbanBoardInput,
    CreateKanbanCardInput,
    CreateKanbanColumnInput,
    CreateKanbanLabelInput,
    KanbanBoard,
    KanbanBoardExport,
    KanbanCard,
    KanbanCardLabel,
    KanbanCardPatch,
    KanbanColumn,
    KanbanColumnPatch,
    KanbanComment,
    KanbanLabel,
    KanbanPriority,
    KanbanRichTextDocument,
    KanbanSubtask
} from "@kanban/shared";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const defaultColumns = ["Backlog", "Todo", "In Progress", "Done"];
const validPriorities = new Set<KanbanPriority>(["none", "low", "medium", "high", "urgent"]);
const orderStep = 1000;

interface BoardRow {
    id: string;
    name: string;
    description: string | null;
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
    description_json: string | null;
    description_text: string | null;
    subtasks_json: string;
    comments_json: string;
    priority: KanbanPriority;
    due_date: number | null;
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
                this.insertColumn({
                    id: randomUUID(),
                    boardId: board.id,
                    name: columnName,
                    color: defaultColumnColor(index),
                    sortOrder: (index + 1) * orderStep,
                    createdAt: now,
                    updatedAt: now
                });
            }
        })();

        return board;
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
        return this.attachCardLabels((rows as CardRow[]).map(rowToCard));
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
        const updatedAt = Date.now();
        this.database
            .prepare(
                `UPDATE kanban_cards
         SET title = ?, column_id = ?, description_json = ?, description_text = ?, subtasks_json = ?, comments_json = ?, priority = ?, due_date = ?, updated_at = ?
         WHERE id = ?`
            )
            .run(
                input.patch.title === undefined ? current.title : normalizeName(input.patch.title, "Card title is required."),
                nextColumnId,
                input.patch.descriptionJson === undefined ? serializeRichText(current.descriptionJson) : serializeRichText(input.patch.descriptionJson),
                input.patch.descriptionText === undefined ? current.descriptionText ?? null : normalizeOptionalText(input.patch.descriptionText) ?? null,
                input.patch.subtasks === undefined ? serializeSubtasks(current.subtasks) : serializeSubtasks(input.patch.subtasks),
                input.patch.comments === undefined ? serializeComments(current.comments) : serializeComments(input.patch.comments),
                nextPriority,
                hasDueDatePatch ? input.patch.dueDate ?? null : current.dueDate ?? null,
                updatedAt,
                input.id
            );
        this.touchBoard(current.boardId, updatedAt);
        return this.requireCard(input.id);
    }

    deleteCard(input: { id: string }): void {
        const card = this.requireCard(input.id);
        this.database.prepare("DELETE FROM kanban_cards WHERE id = ?").run(input.id);
        this.touchBoard(card.boardId, Date.now());
    }

    archiveCard(input: { id: string }): KanbanCard {
        const card = this.requireCard(input.id);
        const now = Date.now();
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
    }

    exportBoard(input: { boardId: string }): KanbanBoardExport {
        const board = this.requireBoard(input.boardId);
        const columns = this.listColumns({ boardId: input.boardId, includeArchived: true });
        const cards = this.listCards({ boardId: input.boardId, includeArchived: true });
        const labels = this.listLabels({ boardId: input.boardId });
        const cardLabels = this.listCardLabels(input.boardId);
        return { version: 1, exportedAt: Date.now(), board, columns, cards, labels, cardLabels };
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
            createdAt: now,
            updatedAt: now,
            archivedAt: input.payload.board.archivedAt
        };

        this.database.transaction(() => {
            this.database
                .prepare(
                    `INSERT INTO kanban_boards (id, name, description, created_at, updated_at, archived_at)
           VALUES (@id, @name, @description, @createdAt, @updatedAt, @archivedAt)`
                )
                .run({ ...board, description: board.description ?? null, archivedAt: board.archivedAt ?? null });
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
        return this.attachCardLabels([rowToCard(row)])[0]!;
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
         (id, board_id, column_id, title, description_json, description_text, subtasks_json, comments_json, priority, due_date, sort_order, created_at, updated_at, archived_at)
         VALUES (@id, @boardId, @columnId, @title, @descriptionJson, @descriptionText, @subtasksJson, @commentsJson, @priority, @dueDate, @sortOrder, @createdAt, @updatedAt, @archivedAt)`
            )
            .run({
                ...card,
                descriptionJson: serializeRichText(card.descriptionJson),
                descriptionText: card.descriptionText ?? null,
                subtasksJson: serializeSubtasks(card.subtasks),
                commentsJson: serializeComments(card.comments),
                dueDate: card.dueDate ?? null,
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
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: row.archived_at ?? undefined
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
        descriptionJson: parseRichText(row.description_json),
        descriptionText: row.description_text ?? undefined,
        subtasks: parseSubtasks(row.subtasks_json),
        comments: parseComments(row.comments_json),
        priority: row.priority,
        dueDate: row.due_date ?? undefined,
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
