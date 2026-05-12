import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { SettingsRepository } from "../db/repositories/settings-repository";
import { SyncService } from "./sync-service";

function createService(): { settings: SettingsRepository; sync: SyncService } {
    const database = new Database(":memory:");
    migrate(database);
    const settings = new SettingsRepository(database);
    const sync = new SyncService(database, settings);
    return { settings, sync };
}

describe("SyncService", () => {
    it("reports local-only status by default", () => {
        const { sync } = createService();

        expect(sync.getStatus()).toMatchObject({
            state: "localOnly",
            iCloudEnabled: false,
            pendingChangeCount: 0
        });
    });

    it("reports checking status when iCloud is enabled", () => {
        const { settings, sync } = createService();

        settings.updateSettings({ sync: { iCloudEnabled: true } });

        expect(sync.getStatus()).toMatchObject({
            state: "checking",
            iCloudEnabled: true,
            pendingChangeCount: 0
        });
    });

    it("persists a stable device id", () => {
        const { sync } = createService();

        expect(sync.ensureDeviceId()).toBe(sync.ensureDeviceId());
    });
});