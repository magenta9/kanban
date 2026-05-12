export interface SyncSettings {
    iCloudEnabled: boolean;
    lastRequestedAt?: number;
    lastDisabledAt?: number;
}

export interface AppSettings {
    sync: SyncSettings;
}

export interface UpdateAppSettingsInput {
    sync?: Partial<Pick<SyncSettings, "iCloudEnabled">>;
}