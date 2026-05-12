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
    it("reports local-only status by default", async () => {
        const { sync } = createService();

        await expect(sync.getStatus()).resolves.toMatchObject({
            state: "localOnly",
            iCloudEnabled: false,
            pendingChangeCount: 0
        });
    });

    it("reports helper account status when iCloud is enabled", async () => {
        const database = new Database(":memory:");
        migrate(database);
        const settings = new SettingsRepository(database);
        const sync = new SyncService(database, settings, {
            getAccountStatus: async () => ({ accountStatus: "signedIn" }),
            syncNow: async () => ({ accountStatus: "signedIn" })
        });

        settings.updateSettings({ sync: { iCloudEnabled: true } });

        await expect(sync.getStatus()).resolves.toMatchObject({
            state: "upToDate",
            iCloudEnabled: true,
            accountStatus: "signedIn",
            pendingChangeCount: 0
        });
    });

    it("reports an error when iCloud is enabled without a helper", async () => {
        const { settings, sync } = createService();

        settings.updateSettings({ sync: { iCloudEnabled: true } });

        await expect(sync.getStatus()).resolves.toMatchObject({
            state: "error",
            iCloudEnabled: true,
            accountStatus: "unavailable"
        });
    });

    it("persists a stable device id", () => {
        const { sync } = createService();

        expect(sync.ensureDeviceId()).toBe(sync.ensureDeviceId());
    });
});