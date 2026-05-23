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
        if (!settings.baseUrl || !settings.model || (!apiKey && providerRequiresApiKey(settings.baseUrl))) {
            this.recordEvent({ level: "warn", scope: "testConnection", scenario: "ai-settings.connection-test", event: "skipped", message: "AI settings are incomplete." });
            return { ok: false, message: "AI settings are incomplete." };
        }

        const apiKeyIssue = apiKey ? apiKeyValidationMessage(apiKey) : undefined;
        if (apiKeyIssue) {
            this.recordError({ scope: "testConnection", scenario: "ai-settings.connection-test", event: "validation_failed", message: apiKeyIssue });
            return { ok: false, message: apiKeyIssue };
        }

        const startedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const requestApiKey = providerRequiresApiKey(settings.baseUrl) ? apiKey ?? "" : "";
        const messages = [{ role: "user", content: "Reply with ok." }];
        const useOllamaNativeChat = providerUsesOllamaNativeChat(settings.baseUrl);
        try {
            const response = await fetch(useOllamaNativeChat ? ollamaChatUrl(settings.baseUrl) : chatCompletionsUrl(settings.baseUrl), {
                method: "POST",
                signal: controller.signal,
                headers: chatCompletionHeaders(requestApiKey),
                body: JSON.stringify(useOllamaNativeChat
                    ? ollamaChatBody({ model: settings.model, messages, maxTokens: 5 })
                    : {
                        model: settings.model,
                        messages,
                        temperature: 0.2,
                        max_completion_tokens: 5,
                        ...chatCompletionProviderOptions(settings.baseUrl)
                    })
            });
            const durationMs = Date.now() - startedAt;
            if (!response.ok) {
                const detail = await responseErrorDetail(response);
                const message = `AI test failed with HTTP ${response.status}.${detail ? ` ${detail}` : ""}`;
                this.recordError({ scope: "testConnection", scenario: "ai-settings.connection-test", event: "http_error", message, statusCode: response.status, durationMs });
                return { ok: false, message, statusCode: response.status, durationMs };
            }
            this.recordEvent({ level: "info", scope: "testConnection", scenario: "ai-settings.connection-test", event: "success", message: "AI connection test completed.", statusCode: response.status, durationMs });
            return { ok: true, message: "AI connection succeeded.", statusCode: response.status, durationMs };
        }
        catch (caught) {
            const durationMs = Date.now() - startedAt;
            const message = isAbortError(caught) ? "AI connection test timed out." : caught instanceof Error ? caught.message : String(caught);
            this.recordError({ scope: "testConnection", scenario: "ai-settings.connection-test", event: "error", message, durationMs });
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

    recordEvent(input: Omit<AiLogEntry, "timestamp" | "timestampMs">): void {
        this.appendLogEntry(this.createLogEntry(input));
    }

    recordError(input: Omit<AiLogEntry, "timestamp" | "timestampMs" | "level">): void {
        const entry = this.createLogEntry({ level: "error", ...input });
        const settings = { ...this.readStoredSettings(), lastError: entry };
        this.writeStoredSettings(settings);
        this.appendLogEntry(entry);
    }

    private createLogEntry(input: Omit<AiLogEntry, "timestamp" | "timestampMs">): AiLogEntry {
        const timestampMs = Date.now();
        return { timestamp: new Date(timestampMs).toISOString(), timestampMs, ...input };
    }

    private appendLogEntry(entry: AiLogEntry): void {
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
                lastError: normalizeAiLogEntry(parsed.lastError)
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

export function ollamaChatUrl(baseUrl: string): string {
    const url = new URL(chatCompletionsUrl(baseUrl));
    return `${url.protocol}//${url.host}/api/chat`;
}

export function chatCompletionHeaders(apiKey: string): Record<string, string> {
    return {
        "Content-Type": "application/json",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {})
    };
}

export function chatCompletionProviderOptions(baseUrl: string): Record<string, unknown> {
    return {
        ...(isMiniMaxBaseUrl(baseUrl) ? { reasoning_split: true } : {})
    };
}

export function providerRequiresApiKey(baseUrl: string): boolean {
    return !isOllamaBaseUrl(baseUrl);
}

export function providerUsesOllamaNativeChat(baseUrl: string): boolean {
    return isOllamaBaseUrl(baseUrl);
}

export function ollamaChatBody(input: { model: string; messages: Array<{ role: string; content: string }>; maxTokens: number }): object {
    return {
        model: input.model,
        messages: input.messages,
        stream: false,
        think: false,
        options: {
            temperature: 0.2,
            num_predict: input.maxTokens
        }
    };
}

function toState(settings: StoredAiSettings): AiSettingsState {
    const hasApiKey = Boolean(settings.encryptedApiKey);
    return {
        enabled: settings.enabled,
        configured: Boolean(settings.baseUrl && settings.model && (hasApiKey || !providerRequiresApiKey(settings.baseUrl))),
        baseUrl: settings.baseUrl,
        model: settings.model,
        hasApiKey,
        lastError: settings.lastError
    };
}

function normalizeSettingText(value: string): string {
    return value.trim();
}

function isMiniMaxBaseUrl(baseUrl: string): boolean {
    try {
        return new URL(chatCompletionsUrl(baseUrl)).hostname.toLowerCase().includes("minimax");
    }
    catch {
        return false;
    }
}

function isOllamaBaseUrl(baseUrl: string): boolean {
    try {
        const url = new URL(chatCompletionsUrl(baseUrl));
        const hostname = url.hostname.toLowerCase();
        return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.includes("ollama");
    }
    catch {
        return false;
    }
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === "AbortError" || error.message === "This operation was aborted");
}

function normalizeAiLogEntry(value: unknown): AiLogEntry | undefined {
    if (!value || typeof value !== "object") return undefined;
    const entry = value as Partial<AiLogEntry> & { timestamp?: unknown; timestampMs?: unknown };
    if (typeof entry.scope !== "string" || typeof entry.message !== "string") return undefined;

    const timestampMs = typeof entry.timestampMs === "number" && Number.isFinite(entry.timestampMs)
        ? entry.timestampMs
        : typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
            ? entry.timestamp
            : undefined;
    const timestamp = typeof entry.timestamp === "string"
        ? entry.timestamp
        : timestampMs !== undefined
            ? new Date(timestampMs).toISOString()
            : undefined;
    if (!timestamp) return undefined;

    return { ...entry, timestamp, ...(timestampMs !== undefined ? { timestampMs } : {}) } as AiLogEntry;
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