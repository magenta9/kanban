import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { SettingsRepository } from "../db/repositories/settings-repository";
import { KanbanRepository } from "../db/repositories/kanban-repository";
import { SyncService } from "./sync-service";
import type { LocalSyncChange } from "./cloudkit-helper-client";

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

    it("uploads pending outbox changes and acknowledges them", async () => {
        const database = new Database(":memory:");
        migrate(database);
        const settings = new SettingsRepository(database);
        const repository = new KanbanRepository(database);
        const board = repository.createBoard({ name: "Launch" });
        const [column] = repository.listColumns({ boardId: board.id });
        repository.createCard({ boardId: board.id, columnId: column!.id, title: "Design" });
        settings.updateSettings({ sync: { iCloudEnabled: true } });
        let uploadedChanges: LocalSyncChange[] = [];
        const sync = new SyncService(database, settings, {
            getAccountStatus: async () => ({ accountStatus: "signedIn" }),
            syncNow: async (changes) => {
                uploadedChanges = changes;
                return { accountStatus: "signedIn", acknowledgedOutboxIds: changes.map((change) => change.outboxId) };
            }
        });

        await expect(sync.syncNow()).resolves.toMatchObject({
            state: "upToDate",
            pendingChangeCount: 0
        });

        expect(uploadedChanges).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ entityType: "board", operation: "save", fields: expect.objectContaining({ name: "Launch" }) }),
                expect.objectContaining({ entityType: "column", operation: "save" }),
                expect.objectContaining({ entityType: "card", operation: "save", fields: expect.objectContaining({ title: "Design" }) })
            ])
        );
        expect(database.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get()).toEqual({ count: 0 });
    });
});