import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AiLogEntry, AiSettingsState, AiTestConnectionResult, SaveAiSettingsInput } from "@kanban/shared";

interface StoredAiSettings {
    enabled: boolean;
    baseUrl: string;
    model: string;
    lastError?: AiLogEntry;
}

export interface AiSettingsPaths {
    settingsPath: string;
    logPath: string;
}

const defaultSettings: StoredAiSettings = {
    enabled: false,
    baseUrl: "",
    model: ""
};

const connectionTestOutputSchema = {
    type: "object",
    properties: {
        status: { type: "string" }
    },
    required: ["status"],
    additionalProperties: false
} as const;

export class AiSettingsService {
    constructor(private readonly paths: AiSettingsPaths) { }

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

        this.writeStoredSettings(next);
        return toState(next);
    }

    async testConnection(): Promise<AiTestConnectionResult> {
        const settings = this.readStoredSettings();
        if (!settings.baseUrl || !settings.model) {
            this.recordEvent({ level: "warn", scope: "testConnection", scenario: "ai-settings.connection-test", event: "skipped", message: "AI settings are incomplete." });
            return { ok: false, message: "AI settings are incomplete." };
        }

        const startedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const messages = [
            { role: "system", content: "Return JSON only: {\"status\":\"ok\"}. Use the key status exactly." },
            { role: "user", content: "Test structured output capability." }
        ];
        try {
            let lastContent: unknown = "";
            let lastStatusCode: number | undefined;

            for (let attempt = 0; attempt < 2; attempt += 1) {
                const response = await fetch(ollamaChatUrl(settings.baseUrl), {
                    method: "POST",
                    signal: controller.signal,
                    headers: chatCompletionHeaders(),
                    body: JSON.stringify(ollamaChatBody({ model: settings.model, messages, maxTokens: 12, format: connectionTestOutputSchema }))
                });
                const durationMs = Date.now() - startedAt;
                if (!response.ok) {
                    const detail = await responseErrorDetail(response);
                    const message = `AI test failed with HTTP ${response.status}.${detail ? ` ${detail}` : ""}`;
                    this.recordError({ scope: "testConnection", scenario: "ai-settings.connection-test", event: "http_error", message, statusCode: response.status, durationMs });
                    return { ok: false, message, statusCode: response.status, durationMs };
                }

                lastStatusCode = response.status;
                const json = await response.json() as { message?: { content?: unknown } };
                lastContent = json.message?.content;
                if (parseStructuredConnectionProbe(lastContent)) {
                    this.recordEvent({ level: "info", scope: "testConnection", scenario: "ai-settings.connection-test", event: "success", message: "AI structured output test completed.", statusCode: response.status, durationMs });
                    return { ok: true, message: "AI structured output succeeded.", statusCode: response.status, durationMs };
                }
            }

            const durationMs = Date.now() - startedAt;
            const preview = previewStructuredContent(lastContent);
            const message = `AI test failed: structured output did not match schema.${preview ? ` Response preview: ${preview}` : ""}`;
            this.recordError({ scope: "testConnection", scenario: "ai-settings.connection-test", event: "schema_failed", message, ...(lastStatusCode !== undefined ? { statusCode: lastStatusCode } : {}), durationMs });
            return { ok: false, message, ...(lastStatusCode !== undefined ? { statusCode: lastStatusCode } : {}), durationMs };
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

}

export function ollamaChatUrl(baseUrl: string): string {
    const trimmed = normalizeSettingText(baseUrl).replace(/\/+$/, "");
    if (trimmed.endsWith("/api/chat")) return trimmed;
    if (trimmed.endsWith("/api")) return `${trimmed}/chat`;
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}/api/chat`;
}

export function chatCompletionHeaders(): Record<string, string> {
    return {
        "Content-Type": "application/json"
    };
}

export function ollamaChatBody(input: { model: string; messages: Array<{ role: string; content: string }>; maxTokens: number; format?: object }): object {
    return {
        model: input.model,
        messages: input.messages,
        stream: false,
        think: false,
        ...(input.format ? { format: input.format } : {}),
        options: {
            temperature: 0.2,
            num_predict: input.maxTokens
        }
    };
}

function toState(settings: StoredAiSettings): AiSettingsState {
    return {
        enabled: settings.enabled,
        configured: Boolean(settings.baseUrl && settings.model),
        baseUrl: settings.baseUrl,
        model: settings.model,
        lastError: settings.lastError
    };
}

function normalizeSettingText(value: string): string {
    return value.trim();
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === "AbortError" || error.message === "This operation was aborted");
}

function parseStructuredConnectionProbe(content: unknown): boolean {
    if (content && typeof content === "object" && !Array.isArray(content)) {
        const parsed = content as Record<string, unknown>;
        return typeof parsed.status === "string" || typeof parsed.insert === "string";
    }
    if (typeof content !== "string") return false;
    const parsed = parseJsonObject(stripFencedText(stripModelReasoning(content)));
    return Boolean(parsed && (typeof parsed.status === "string" || typeof parsed.insert === "string"));
}

function previewStructuredContent(content: unknown): string {
    if (content && typeof content === "object" && !Array.isArray(content)) {
        const normalized = JSON.stringify(content).replace(/\s+/g, " ").trim();
        if (!normalized) return "";
        return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
    }
    if (typeof content !== "string") return "";
    const normalized = stripFencedText(stripModelReasoning(content)).replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function stripModelReasoning(value: string): string {
    const withoutClosedBlocks = value.replace(/<think>[\s\S]*?<\/think>/gi, "");
    const openBlockIndex = withoutClosedBlocks.search(/<think>/i);
    return openBlockIndex >= 0 ? withoutClosedBlocks.slice(0, openBlockIndex) : withoutClosedBlocks;
}

function stripFencedText(value: string): string {
    const trimmed = value.trim();
    const match = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
    return match?.[1]?.trim() ?? trimmed;
}

function jsonCandidate(value: string): string {
    const trimmed = value.trim();
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) return trimmed.slice(objectStart, objectEnd + 1);
    return trimmed;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
    try {
        const parsed = JSON.parse(jsonCandidate(value)) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    }
    catch { }
    return undefined;
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
