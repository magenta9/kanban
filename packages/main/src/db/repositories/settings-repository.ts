import type { AppSettings, UpdateAppSettingsInput } from "@kanban/shared";
import type Database from "better-sqlite3";

const settingKeys = {
    iCloudEnabled: "sync.icloud.enabled",
    lastRequestedAt: "sync.icloud.lastRequestedAt",
    lastDisabledAt: "sync.icloud.lastDisabledAt"
} as const;

interface SettingRow {
    value_json: string;
}

export class SettingsRepository {
    constructor(private readonly database: Database.Database) { }

    getSettings(): AppSettings {
        return {
            sync: {
                iCloudEnabled: this.readBoolean(settingKeys.iCloudEnabled, false),
                lastRequestedAt: this.readNumber(settingKeys.lastRequestedAt),
                lastDisabledAt: this.readNumber(settingKeys.lastDisabledAt)
            }
        };
    }

    updateSettings(input: UpdateAppSettingsInput): AppSettings {
        const iCloudEnabled = input.sync?.iCloudEnabled;
        if (iCloudEnabled !== undefined) {
            const now = Date.now();
            this.database.transaction(() => {
                this.writeSetting(settingKeys.iCloudEnabled, iCloudEnabled, now);
                this.writeSetting(iCloudEnabled ? settingKeys.lastRequestedAt : settingKeys.lastDisabledAt, now, now);
            })();
        }
        return this.getSettings();
    }

    private readBoolean(key: string, fallback: boolean): boolean {
        const value = this.readJson(key);
        return typeof value === "boolean" ? value : fallback;
    }

    private readNumber(key: string): number | undefined {
        const value = this.readJson(key);
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }

    private readJson(key: string): unknown {
        const row = this.database.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key) as SettingRow | undefined;
        if (!row) return undefined;
        try {
            return JSON.parse(row.value_json) as unknown;
        } catch {
            return undefined;
        }
    }

    private writeSetting(key: string, value: unknown, updatedAt: number): void {
        this.database
            .prepare(
                `INSERT INTO app_settings (key, value_json, updated_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
            )
            .run(key, JSON.stringify(value), updatedAt);
    }
}