import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../schema";
import { SettingsRepository } from "./settings-repository";

function createRepository(): SettingsRepository {
    const database = new Database(":memory:");
    migrate(database);
    return new SettingsRepository(database);
}

describe("SettingsRepository", () => {
    it("returns local-only defaults", () => {
        const repository = createRepository();

        expect(repository.getSettings()).toEqual({
            sync: {
                iCloudEnabled: false,
                lastRequestedAt: undefined,
                lastDisabledAt: undefined
            }
        });
    });

    it("persists the iCloud sync toggle", () => {
        const repository = createRepository();

        const enabled = repository.updateSettings({ sync: { iCloudEnabled: true } });
        expect(enabled.sync.iCloudEnabled).toBe(true);
        expect(enabled.sync.lastRequestedAt).toEqual(expect.any(Number));

        const disabled = repository.updateSettings({ sync: { iCloudEnabled: false } });
        expect(disabled.sync.iCloudEnabled).toBe(false);
        expect(disabled.sync.lastRequestedAt).toBe(enabled.sync.lastRequestedAt);
        expect(disabled.sync.lastDisabledAt).toEqual(expect.any(Number));
    });
});