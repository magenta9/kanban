import type { SyncStatus } from "@kanban/shared";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { SettingsRepository } from "../db/repositories/settings-repository";

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

export class SyncService {
    constructor(
        private readonly database: Database.Database,
        private readonly settings: SettingsRepository
    ) { }

    getStatus(): SyncStatus {
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

    syncNow(): SyncStatus {
        return this.getStatus();
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