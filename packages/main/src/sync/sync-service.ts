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

interface SyncHelper {
    getAccountStatus(): Promise<{ accountStatus: SyncStatus["accountStatus"] }>;
    syncNow(): Promise<{ accountStatus: SyncStatus["accountStatus"] }>;
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
            const result = await this.helper.syncNow();
            const syncedAt = Date.now();
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