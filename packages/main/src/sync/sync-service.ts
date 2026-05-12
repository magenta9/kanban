import type { SyncStatus } from "@kanban/shared";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { SettingsRepository } from "../db/repositories/settings-repository";
import type { LocalSyncChange, RemoteSyncRecord } from "./cloudkit-helper-client";

const syncStateKeys = {
    deviceId: "device_id",
    lastSyncedAt: "last_synced_at"
} as const;

interface CountRow {
    count: number;
}

interface SyncStateRow {
    value: Buffer;
}

interface SyncOutboxRow {
    id: string;
    entity_type: string;
    entity_id: string;
    operation: "save" | "delete";
}

interface SyncHelper {
    getAccountStatus(): Promise<{ accountStatus: SyncStatus["accountStatus"] }>;
    syncNow(changes: LocalSyncChange[]): Promise<{ accountStatus: SyncStatus["accountStatus"]; acknowledgedOutboxIds?: string[]; records?: RemoteSyncRecord[] }>;
}

export class SyncService {
    constructor(
        private readonly database: Database.Database,
        private readonly settings: SettingsRepository,
        private readonly helper?: SyncHelper
    ) { }

    async getStatus(): Promise<SyncStatus> {
        const settings = this.settings.getSettings();
        const pendingChangeCount = this.pendingChangeCount();
        if (!settings.sync.iCloudEnabled) {
            return {
                state: "localOnly",
                iCloudEnabled: false,
                accountStatus: "unknown",
                lastSyncedAt: this.readNumber(syncStateKeys.lastSyncedAt),
                pendingChangeCount
            };
        }

        if (!this.helper) {
            return {
                state: "error",
                iCloudEnabled: true,
                accountStatus: "unavailable",
                lastSyncedAt: this.readNumber(syncStateKeys.lastSyncedAt),
                pendingChangeCount,
                error: "CloudKit helper is not configured."
            };
        }

        try {
            const result = await this.helper.getAccountStatus();
            return {
                state: result.accountStatus === "signedIn" ? "upToDate" : "paused",
                iCloudEnabled: true,
                accountStatus: result.accountStatus,
                lastSyncedAt: this.readNumber(syncStateKeys.lastSyncedAt),
                pendingChangeCount
            };
        } catch (error) {
            return {
                state: "error",
                iCloudEnabled: true,
                accountStatus: "unavailable",
                lastSyncedAt: this.readNumber(syncStateKeys.lastSyncedAt),
                pendingChangeCount,
                error: errorMessage(error)
            };
        }
    }

    async syncNow(): Promise<SyncStatus> {
        const settings = this.settings.getSettings();
        if (!settings.sync.iCloudEnabled || !this.helper) {
            return await this.getStatus();
        }

        try {
            const changes = this.pendingChanges();
            const result = await this.helper.syncNow(changes);
            const syncedAt = Date.now();
            this.acknowledgeOutbox(result.acknowledgedOutboxIds ?? changes.map((change) => change.outboxId));
            this.applyRemoteRecords(result.records ?? []);
            this.writeState(syncStateKeys.lastSyncedAt, String(syncedAt), syncedAt);
            return {
                state: "upToDate",
                iCloudEnabled: true,
                accountStatus: result.accountStatus,
                lastSyncedAt: syncedAt,
                pendingChangeCount: this.pendingChangeCount()
            };
        } catch (error) {
            return {
                state: "error",
                iCloudEnabled: true,
                accountStatus: "unavailable",
                lastSyncedAt: this.readNumber(syncStateKeys.lastSyncedAt),
                pendingChangeCount: this.pendingChangeCount(),
                error: errorMessage(error)
            };
        }
    }

    getLocalStatus(): SyncStatus {
        const settings = this.settings.getSettings();
        const pendingChangeCount = this.pendingChangeCount();
        if (!settings.sync.iCloudEnabled) {
            return {
                state: "localOnly",
                iCloudEnabled: false,
                accountStatus: "unknown",
                lastSyncedAt: this.readNumber(syncStateKeys.lastSyncedAt),
                pendingChangeCount
            };
        }

        return {
            state: "checking",
            iCloudEnabled: true,
            accountStatus: "unknown",
            lastSyncedAt: this.readNumber(syncStateKeys.lastSyncedAt),
            pendingChangeCount
        };
    }

    ensureDeviceId(): string {
        const existing = this.readString(syncStateKeys.deviceId);
        if (existing) return existing;
        const deviceId = randomUUID();
        this.writeState(syncStateKeys.deviceId, deviceId, Date.now());
        return deviceId;
    }

    private pendingChangeCount(): number {
        const row = this.database.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get() as CountRow;
        return row.count;
    }

    private pendingChanges(): LocalSyncChange[] {
        const rows = this.database
            .prepare("SELECT id, entity_type, entity_id, operation FROM sync_outbox ORDER BY created_at ASC")
            .all() as SyncOutboxRow[];
        return rows.map((row) => ({
            outboxId: row.id,
            entityType: row.entity_type,
            entityId: row.entity_id,
            operation: row.operation,
            fields: row.operation === "save" ? this.readEntityFields(row.entity_type, row.entity_id) : undefined
        }));
    }

    private acknowledgeOutbox(ids: string[]): void {
        if (ids.length === 0) return;
        const deleteOutbox = this.database.prepare("DELETE FROM sync_outbox WHERE id = ?");
        this.database.transaction(() => {
            for (const id of ids) deleteOutbox.run(id);
        })();
    }

    private readEntityFields(entityType: string, entityId: string): Record<string, unknown> | undefined {
        switch (entityType) {
            case "board":
                return this.readRow(
                    "SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt FROM kanban_boards WHERE id = ?",
                    entityId
                );
            case "column":
                return this.readRow(
                    "SELECT id, board_id AS boardId, name, color, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt FROM kanban_columns WHERE id = ?",
                    entityId
                );
            case "card":
                return this.readRow(
                    `SELECT id, board_id AS boardId, column_id AS columnId, title, description_json AS descriptionJson,
                            description_text AS descriptionText, subtasks_json AS subtasksJson, comments_json AS commentsJson,
                            priority, due_date AS dueDate, sort_order AS sortOrder, created_at AS createdAt,
                            updated_at AS updatedAt, archived_at AS archivedAt
                     FROM kanban_cards WHERE id = ?`,
                    entityId
                );
            case "label":
                return this.readRow("SELECT id, board_id AS boardId, name, color FROM kanban_labels WHERE id = ?", entityId);
            case "card_label": {
                const [cardId, labelId] = entityId.split(":");
                if (!cardId || !labelId) return undefined;
                return this.readRow("SELECT card_id AS cardId, label_id AS labelId FROM kanban_card_labels WHERE card_id = ? AND label_id = ?", cardId, labelId);
            }
            default:
                return undefined;
        }
    }

    private readRow(query: string, ...parameters: unknown[]): Record<string, unknown> | undefined {
        const row = this.database.prepare(query).get(...parameters) as Record<string, unknown> | undefined;
        return row ? Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? null])) : undefined;
    }

    private applyRemoteRecords(records: RemoteSyncRecord[]): void {
        const rank = new Map<string, number>([
            ["board", 0],
            ["column", 1],
            ["label", 2],
            ["card", 3],
            ["card_label", 4]
        ]);
        const ordered = [...records].sort((left, right) => (rank.get(left.entityType) ?? 99) - (rank.get(right.entityType) ?? 99));
        this.database.transaction(() => {
            for (const record of ordered.filter((item) => !item.deleted)) this.applyRemoteSave(record);
            for (const record of ordered.filter((item) => item.deleted).reverse()) this.applyRemoteDelete(record);
        })();
    }

    private applyRemoteSave(record: RemoteSyncRecord): void {
        const fields = parsePayload(record.payloadJson);
        switch (record.entityType) {
            case "board":
                this.upsertBoard(fields, record.modifiedAtMillis);
                return;
            case "column":
                this.upsertColumn(fields, record.modifiedAtMillis);
                return;
            case "card":
                this.upsertCard(fields, record.modifiedAtMillis);
                return;
            case "label":
                this.upsertLabel(fields);
                return;
            case "card_label":
                this.upsertCardLabel(fields);
                return;
        }
    }

    private applyRemoteDelete(record: RemoteSyncRecord): void {
        switch (record.entityType) {
            case "card_label": {
                const [cardId, labelId] = record.entityId.split(":");
                if (cardId && labelId) this.database.prepare("DELETE FROM kanban_card_labels WHERE card_id = ? AND label_id = ?").run(cardId, labelId);
                return;
            }
            case "card":
                this.database.prepare("DELETE FROM kanban_card_labels WHERE card_id = ?").run(record.entityId);
                this.database.prepare("DELETE FROM kanban_cards WHERE id = ?").run(record.entityId);
                return;
            case "label":
                this.database.prepare("DELETE FROM kanban_card_labels WHERE label_id = ?").run(record.entityId);
                this.database.prepare("DELETE FROM kanban_labels WHERE id = ?").run(record.entityId);
                return;
            case "column":
                this.database.prepare("DELETE FROM kanban_columns WHERE id = ?").run(record.entityId);
                return;
            case "board":
                this.database.prepare("DELETE FROM kanban_boards WHERE id = ?").run(record.entityId);
                return;
        }
    }

    private upsertBoard(fields: Record<string, unknown>, modifiedAtMillis: number): void {
        const id = stringValue(fields.id);
        const name = stringValue(fields.name);
        if (!id || !name || !this.shouldApplyTimestamp("kanban_boards", id, numberValue(fields.updatedAt) ?? modifiedAtMillis)) return;
        this.database
            .prepare(
                `INSERT INTO kanban_boards (id, name, description, created_at, updated_at, archived_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
                   updated_at = excluded.updated_at, archived_at = excluded.archived_at`
            )
            .run(id, name, nullableStringValue(fields.description), numberValue(fields.createdAt) ?? modifiedAtMillis, numberValue(fields.updatedAt) ?? modifiedAtMillis, nullableNumberValue(fields.archivedAt));
    }

    private upsertColumn(fields: Record<string, unknown>, modifiedAtMillis: number): void {
        const id = stringValue(fields.id);
        const boardId = stringValue(fields.boardId);
        const name = stringValue(fields.name);
        if (!id || !boardId || !name || !this.shouldApplyTimestamp("kanban_columns", id, numberValue(fields.updatedAt) ?? modifiedAtMillis)) return;
        this.database
            .prepare(
                `INSERT INTO kanban_columns (id, board_id, name, color, sort_order, created_at, updated_at, archived_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET board_id = excluded.board_id, name = excluded.name,
                   color = excluded.color, sort_order = excluded.sort_order, updated_at = excluded.updated_at,
                   archived_at = excluded.archived_at`
            )
            .run(id, boardId, name, nullableStringValue(fields.color), numberValue(fields.sortOrder) ?? 0, numberValue(fields.createdAt) ?? modifiedAtMillis, numberValue(fields.updatedAt) ?? modifiedAtMillis, nullableNumberValue(fields.archivedAt));
    }

    private upsertCard(fields: Record<string, unknown>, modifiedAtMillis: number): void {
        const id = stringValue(fields.id);
        const boardId = stringValue(fields.boardId);
        const columnId = stringValue(fields.columnId);
        const title = stringValue(fields.title);
        if (!id || !boardId || !columnId || !title || !this.shouldApplyTimestamp("kanban_cards", id, numberValue(fields.updatedAt) ?? modifiedAtMillis)) return;
        this.database
            .prepare(
                `INSERT INTO kanban_cards
                   (id, board_id, column_id, title, description_json, description_text, subtasks_json, comments_json,
                    priority, due_date, sort_order, created_at, updated_at, archived_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET board_id = excluded.board_id, column_id = excluded.column_id,
                   title = excluded.title, description_json = excluded.description_json,
                   description_text = excluded.description_text, subtasks_json = excluded.subtasks_json,
                   comments_json = excluded.comments_json, priority = excluded.priority, due_date = excluded.due_date,
                   sort_order = excluded.sort_order, updated_at = excluded.updated_at, archived_at = excluded.archived_at`
            )
            .run(
                id,
                boardId,
                columnId,
                title,
                nullableStringValue(fields.descriptionJson),
                nullableStringValue(fields.descriptionText),
                stringValue(fields.subtasksJson) ?? "[]",
                stringValue(fields.commentsJson) ?? "[]",
                stringValue(fields.priority) ?? "none",
                nullableNumberValue(fields.dueDate),
                numberValue(fields.sortOrder) ?? 0,
                numberValue(fields.createdAt) ?? modifiedAtMillis,
                numberValue(fields.updatedAt) ?? modifiedAtMillis,
                nullableNumberValue(fields.archivedAt)
            );
    }

    private upsertLabel(fields: Record<string, unknown>): void {
        const id = stringValue(fields.id);
        const boardId = stringValue(fields.boardId);
        const name = stringValue(fields.name);
        const color = stringValue(fields.color);
        if (!id || !boardId || !name || !color) return;
        this.database
            .prepare(
                `INSERT INTO kanban_labels (id, board_id, name, color)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET board_id = excluded.board_id, name = excluded.name, color = excluded.color`
            )
            .run(id, boardId, name, color);
    }

    private upsertCardLabel(fields: Record<string, unknown>): void {
        const cardId = stringValue(fields.cardId);
        const labelId = stringValue(fields.labelId);
        if (!cardId || !labelId) return;
        this.database.prepare("INSERT OR IGNORE INTO kanban_card_labels (card_id, label_id) VALUES (?, ?)").run(cardId, labelId);
    }

    private shouldApplyTimestamp(table: string, id: string, remoteUpdatedAt: number): boolean {
        const row = this.database.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get(id) as { updated_at: number } | undefined;
        return !row || row.updated_at <= remoteUpdatedAt;
    }

    private readString(key: string): string | undefined {
        const row = this.database.prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as SyncStateRow | undefined;
        if (!row) return undefined;
        return row.value.toString("utf8");
    }

    private readNumber(key: string): number | undefined {
        const value = this.readString(key);
        if (!value) return undefined;
        const numberValue = Number(value);
        return Number.isFinite(numberValue) ? numberValue : undefined;
    }

    private writeState(key: string, value: string, updatedAt: number): void {
        this.database
            .prepare(
                `INSERT INTO sync_state (key, value, updated_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
            )
            .run(key, Buffer.from(value, "utf8"), updatedAt);
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function parsePayload(payloadJson: string): Record<string, unknown> {
    try {
        const value = JSON.parse(payloadJson) as unknown;
        return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function nullableStringValue(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableNumberValue(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}