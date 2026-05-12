import { Cloud, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppSettings, SyncStatus, SyncStatusState } from "@kanban/shared";
import { getApi } from "../api";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let isMounted = true;
    setError(null);
    try {
      const api = getApi();
      void Promise.all([api.settings.getSettings(), api.sync.getStatus()])
        .then(([nextSettings, nextSyncStatus]) => {
          if (!isMounted) return;
          setSettings(nextSettings);
          setSyncStatus(nextSyncStatus);
        })
        .catch((unknownError) => {
          if (isMounted) setError(errorMessage(unknownError));
        });
    } catch (unknownError) {
      setSettings(null);
      setSyncStatus(null);
      setError(errorMessage(unknownError));
    }
    return () => {
      isMounted = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const iCloudEnabled = settings?.sync.iCloudEnabled ?? false;

  async function updateICloudEnabled(nextEnabled: boolean): Promise<void> {
    setIsSaving(true);
    setError(null);
    try {
      const api = getApi();
      const nextSettings = await api.settings.updateSettings({ sync: { iCloudEnabled: nextEnabled } });
      setSettings(nextSettings);
      setSyncStatus(await api.sync.getStatus());
    } catch (unknownError) {
      setError(errorMessage(unknownError));
    } finally {
      setIsSaving(false);
    }
  }

  async function syncNow(): Promise<void> {
    setIsSyncing(true);
    setError(null);
    try {
      setSyncStatus(await getApi().sync.syncNow());
    } catch (unknownError) {
      setError(errorMessage(unknownError));
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className="settings-overlay app-no-drag" role="presentation" onMouseDown={onClose}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-dialog-header">
          <div>
            <div className="settings-eyebrow">Settings</div>
            <h2 id="settings-title" className="settings-title">Preferences</h2>
          </div>
          <button type="button" className="settings-icon-button" aria-label="Close settings" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="settings-section">
          <div className="settings-row">
            <div className="settings-row-label">
              <span className="settings-row-icon"><Cloud size={16} /></span>
              <span>iCloud Sync</span>
            </div>
            <button
              type="button"
              className="settings-toggle"
              data-state={iCloudEnabled ? "on" : "off"}
              aria-pressed={iCloudEnabled}
              disabled={isSaving || !settings}
              onClick={() => void updateICloudEnabled(!iCloudEnabled)}
            >
              <span className="settings-toggle-thumb" />
            </button>
          </div>
          <div className="settings-status-line">
            {isSaving ? <Loader2 size={13} className="settings-spin" /> : null}
            <span>{syncStatus ? syncStatusLabel(syncStatus.state) : iCloudEnabled ? "On" : "Local only"}</span>
          </div>
          <div className="settings-sync-details">
            <span>{syncStatus?.accountStatus ? `Account: ${accountStatusLabel(syncStatus.accountStatus)}` : "Account: Unknown"}</span>
            <span>{syncStatus?.lastSyncedAt ? `Last synced: ${new Date(syncStatus.lastSyncedAt).toLocaleString()}` : "Last synced: Never"}</span>
            <span>{syncStatus ? `Pending: ${syncStatus.pendingChangeCount}` : "Pending: 0"}</span>
          </div>
          <button
            type="button"
            className="settings-secondary-button"
            disabled={!iCloudEnabled || !settings || isSaving || isSyncing}
            onClick={() => void syncNow()}
          >
            {isSyncing ? <Loader2 size={13} className="settings-spin" /> : null}
            <span>Sync Now</span>
          </button>
        </div>

        {error ? <div className="settings-error">{error}</div> : null}
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Settings are unavailable.";
}

function syncStatusLabel(state: SyncStatusState): string {
  switch (state) {
    case "localOnly":
      return "Local only";
    case "checking":
      return "Checking iCloud";
    case "syncing":
      return "Syncing";
    case "upToDate":
      return "Up to date";
    case "paused":
      return "Paused";
    case "error":
      return "Error";
  }
}

function accountStatusLabel(status: SyncStatus["accountStatus"]): string {
  switch (status) {
    case "unknown":
      return "Unknown";
    case "unavailable":
      return "Unavailable";
    case "signedOut":
      return "Signed out";
    case "signedIn":
      return "Signed in";
    case "changedAccount":
      return "Changed account";
  }
}