export type SyncStatusState = "localOnly" | "checking" | "syncing" | "upToDate" | "paused" | "error";
export type ICloudAccountStatus = "unknown" | "unavailable" | "signedOut" | "signedIn" | "changedAccount";

export interface SyncStatus {
    state: SyncStatusState;
    iCloudEnabled: boolean;
    accountStatus: ICloudAccountStatus;
    lastSyncedAt?: number;
    pendingChangeCount: number;
    error?: string;
}