import { safeStorage } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AiLogEntry, AiSettingsState, AiTestConnectionResult, SaveAiSettingsInput } from "@kanban/shared";

interface StoredAiSettings {
    enabled: boolean;
    baseUrl: string;
    model: string;
    encryptedApiKey?: string;
    lastError?: AiLogEntry;
}

export interface AiSettingsPaths {
    settingsPath: string;
    logPath: string;
}

export interface SecretCodec {
    isAvailable(): boolean;
    encrypt(value: string): string;
    decrypt(value: string): string;
}

export const safeStorageSecretCodec: SecretCodec = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64"))
};

const defaultSettings: StoredAiSettings = {
    enabled: false,
    baseUrl: "",
    model: ""
};

export class AiSettingsService {
    constructor(
        private readonly paths: AiSettingsPaths,
        private readonly codec: SecretCodec = safeStorageSecretCodec
    ) { }

    getSettings(): AiSettingsState {
        return toState(this.readStoredSettings());
    }

    saveSettings(input: SaveAiSettingsInput): AiSettingsState {
        const current = this.readStoredSettings();
        const next: StoredAiSettings = {
            ...current,
            enabled: input.enabled,
            baseUrl: normalizeSettingText(input.baseUrl),
            model: normalizeSettingText(input.model)
        };

        if (input.clearApiKey) {
            delete next.encryptedApiKey;
        }
        else if (input.apiKey?.trim()) {
            if (!this.codec.isAvailable()) {
                throw new Error("Secure storage is not available on this system.");
            }
            next.encryptedApiKey = this.codec.encrypt(input.apiKey.trim());
        }

        this.writeStoredSettings(next);
        return toState(next);
    }

    async testConnection(): Promise<AiTestConnectionResult> {
        const settings = this.readStoredSettings();
        const apiKey = this.decryptApiKey(settings);
        if (!settings.baseUrl || !settings.model || !apiKey) {
            return { ok: false, message: "AI settings are incomplete." };
        }

        const apiKeyIssue = apiKeyValidationMessage(apiKey);
        if (apiKeyIssue) {
            this.recordError({ scope: "testConnection", message: apiKeyIssue });
            return { ok: false, message: apiKeyIssue };
        }

        const startedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(chatCompletionsUrl(settings.baseUrl), {
                method: "POST",
                signal: controller.signal,
                headers: chatCompletionHeaders(apiKey),
                body: JSON.stringify({
                    model: settings.model,
                    messages: [{ role: "user", content: "Reply with ok." }],
                    temperature: 0.2,
                    max_completion_tokens: 5
                })
            });
            const durationMs = Date.now() - startedAt;
            if (!response.ok) {
                const detail = await responseErrorDetail(response);
                const message = `AI test failed with HTTP ${response.status}.${detail ? ` ${detail}` : ""}`;
                this.recordError({ scope: "testConnection", message, statusCode: response.status, durationMs });
                return { ok: false, message, statusCode: response.status, durationMs };
            }
            return { ok: true, message: "AI connection succeeded.", statusCode: response.status, durationMs };
        }
        catch (caught) {
            const durationMs = Date.now() - startedAt;
            const message = caught instanceof Error ? caught.message : String(caught);
            this.recordError({ scope: "testConnection", message, durationMs });
            return { ok: false, message, durationMs };
        }
        finally {
            clearTimeout(timeout);
        }
    }

    ensureLogFile(): string {
        mkdirSync(dirname(this.paths.logPath), { recursive: true });
        if (!existsSync(this.paths.logPath)) {
            writeFileSync(this.paths.logPath, "", "utf8");
        }
        return this.paths.logPath;
    }

    getDecryptedApiKey(): string | undefined {
        return this.decryptApiKey(this.readStoredSettings());
    }

    recordError(input: Omit<AiLogEntry, "timestamp">): void {
        const entry: AiLogEntry = { timestamp: Date.now(), ...input };
        const settings = { ...this.readStoredSettings(), lastError: entry };
        this.writeStoredSettings(settings);
        mkdirSync(dirname(this.paths.logPath), { recursive: true });
        appendFileSync(this.paths.logPath, `${JSON.stringify(entry)}\n`, "utf8");
    }

    private readStoredSettings(): StoredAiSettings {
        if (!existsSync(this.paths.settingsPath)) return defaultSettings;
        try {
            const parsed = JSON.parse(readFileSync(this.paths.settingsPath, "utf8")) as Partial<StoredAiSettings>;
            return {
                enabled: Boolean(parsed.enabled),
                baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
                model: typeof parsed.model === "string" ? parsed.model : "",
                encryptedApiKey: typeof parsed.encryptedApiKey === "string" ? parsed.encryptedApiKey : undefined,
                lastError: isAiLogEntry(parsed.lastError) ? parsed.lastError : undefined
            };
        }
        catch {
            return defaultSettings;
        }
    }

    private writeStoredSettings(settings: StoredAiSettings): void {
        mkdirSync(dirname(this.paths.settingsPath), { recursive: true });
        writeFileSync(this.paths.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    }

    private decryptApiKey(settings: StoredAiSettings): string | undefined {
        if (!settings.encryptedApiKey) return undefined;
        try {
            return this.codec.decrypt(settings.encryptedApiKey);
        }
        catch {
            return undefined;
        }
    }
}

export function chatCompletionsUrl(baseUrl: string): string {
    const trimmed = normalizeSettingText(baseUrl).replace(/\/+$/, "");
    if (trimmed.endsWith("/chat/completions")) return trimmed;
    if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
    return `${trimmed}/v1/chat/completions`;
}

export function chatCompletionHeaders(apiKey: string): Record<string, string> {
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
    };
}

function toState(settings: StoredAiSettings): AiSettingsState {
    const hasApiKey = Boolean(settings.encryptedApiKey);
    return {
        enabled: settings.enabled,
        configured: Boolean(settings.baseUrl && settings.model && hasApiKey),
        baseUrl: settings.baseUrl,
        model: settings.model,
        hasApiKey,
        lastError: settings.lastError
    };
}

function normalizeSettingText(value: string): string {
    return value.trim();
}

function isAiLogEntry(value: unknown): value is AiLogEntry {
    return Boolean(value && typeof value === "object" && typeof (value as AiLogEntry).timestamp === "number" && typeof (value as AiLogEntry).scope === "string" && typeof (value as AiLogEntry).message === "string");
}

export async function responseErrorDetail(response: Response): Promise<string> {
    try {
        const text = (await response.text()).trim();
        if (!text) return "";
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object") {
            const error = (parsed as { error?: { message?: unknown } }).error;
            const baseResp = (parsed as { base_resp?: { status_msg?: unknown } }).base_resp;
            const requestId = (parsed as { request_id?: unknown }).request_id;
            const detail = typeof error?.message === "string" ? error.message : typeof baseResp?.status_msg === "string" ? baseResp.status_msg : "";
            const suffix = typeof requestId === "string" ? ` (request id: ${requestId})` : "";
            if (detail) return `${detail}${suffix}`;
        }
        return text.length > 500 ? `${text.slice(0, 500)}...` : text;
    }
    catch {
        return "";
    }
}

export function apiKeyValidationMessage(apiKey: string, now = Date.now()): string | undefined {
    const parts = apiKey.split(".");
    if (parts.length !== 3) return undefined;
    const payloadPart = parts[1];
    if (!payloadPart) return undefined;
    try {
        const payload = JSON.parse(Buffer.from(base64UrlToBase64(payloadPart), "base64").toString("utf8")) as { exp?: unknown };
        if (typeof payload.exp !== "number") return undefined;
        if (payload.exp * 1000 <= now) return "AI API key is expired. Generate a new key and save it again.";
    }
    catch {
        return undefined;
    }
    return undefined;
}

function base64UrlToBase64(value: string): string {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return `${normalized}${"=".repeat((4 - normalized.length % 4) % 4)}`;
}