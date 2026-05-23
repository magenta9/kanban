import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettingsService, apiKeyValidationMessage, chatCompletionHeaders, chatCompletionProviderOptions, chatCompletionsUrl, ollamaChatBody, ollamaChatUrl, providerRequiresApiKey, providerUsesOllamaNativeChat, responseErrorDetail, type SecretCodec } from "./settings-service";

const codec: SecretCodec = {
    isAvailable: () => true,
    encrypt: (value) => `enc:${value}`,
    decrypt: (value) => value.replace(/^enc:/, "")
};

let tempRoots: string[] = [];

function createService(): { root: string; service: AiSettingsService; settingsPath: string; logPath: string } {
    const root = mkdtempSync(join(tmpdir(), "kanban-ai-"));
    tempRoots.push(root);
    const settingsPath = join(root, "ai-settings.json");
    const logPath = join(root, "ai.log");
    return { root, settingsPath, logPath, service: new AiSettingsService({ settingsPath, logPath }, codec) };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
    tempRoots = [];
});

describe("AiSettingsService", () => {
    it("saves encrypted keys without exposing them in state", () => {
        const { service, settingsPath } = createService();

        const state = service.saveSettings({ enabled: true, baseUrl: " https://api.example.com/v1 ", model: " model-a ", apiKey: " secret-key " });

        expect(state).toMatchObject({ enabled: true, configured: true, baseUrl: "https://api.example.com/v1", model: "model-a", hasApiKey: true });
        expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toMatchObject({ encryptedApiKey: "enc:secret-key" });
        expect(JSON.stringify(state)).not.toContain("secret-key");
    });

    it("returns an incomplete result when testing without config", async () => {
        const { service } = createService();

        await expect(service.testConnection()).resolves.toEqual({ ok: false, message: "AI settings are incomplete." });
    });

    it("configures local Ollama-compatible providers without an API key", async () => {
        const { service, logPath } = createService();
        service.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
            expect(url).toBe("http://localhost:11434/api/chat");
            expect(init.headers).toEqual({ "Content-Type": "application/json" });
            expect(JSON.parse(String(init.body))).toMatchObject({ model: "llama3.2", stream: false, think: false, options: { num_predict: 5 } });
            return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
        }));

        await expect(service.testConnection()).resolves.toMatchObject({ ok: true });
        expect(service.getSettings()).toMatchObject({ configured: true, hasApiKey: false });
        const entry = JSON.parse(readFileSync(logPath, "utf8").trim()) as Record<string, unknown>;
        expect(entry).toMatchObject({
            level: "info",
            scope: "testConnection",
            scenario: "ai-settings.connection-test",
            event: "success",
            statusCode: 200,
            durationMs: expect.any(Number)
        });
        expect(entry.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
    });

    it("does not forward saved API keys to Ollama-compatible providers", async () => {
        const { service } = createService();
        service.saveSettings({ enabled: true, baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7", apiKey: "remote-key" });
        service.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            expect(init.headers).toEqual({ "Content-Type": "application/json" });
            return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
        }));

        await expect(service.testConnection()).resolves.toMatchObject({ ok: true });
    });

    it("includes provider error details when connection testing fails", async () => {
        const { service } = createService();
        service.saveSettings({ enabled: true, baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7", apiKey: "bad-key" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            expect(init.headers).toMatchObject({ "Authorization": "Bearer bad-key", "Content-Type": "application/json" });
            expect(JSON.parse(String(init.body))).toMatchObject({ temperature: 0.2, max_completion_tokens: 5, reasoning_split: true });
            return new Response(JSON.stringify({ base_resp: { status_msg: "invalid api key" } }), { status: 401 });
        }));

        const result = await service.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).toContain("HTTP 401");
        expect(result.message).toContain("invalid api key");
    });

    it("rejects expired JWT API keys before sending a request", async () => {
        const { service } = createService();
        const expiredJwt = jwtWithPayload({ exp: 10 });
        const fetch = vi.fn();
        service.saveSettings({ enabled: true, baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7", apiKey: expiredJwt });
        vi.stubGlobal("fetch", fetch);

        const result = await service.testConnection();

        expect(result).toMatchObject({ ok: false, message: "AI API key is expired. Generate a new key and save it again." });
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe("apiKeyValidationMessage", () => {
    it("detects expired JWT-like API keys", () => {
        expect(apiKeyValidationMessage(jwtWithPayload({ exp: 10 }), 11_000)).toBe("AI API key is expired. Generate a new key and save it again.");
    });

    it("ignores non-JWT API keys", () => {
        expect(apiKeyValidationMessage("sk-test", 11_000)).toBeUndefined();
    });
});

describe("responseErrorDetail", () => {
    it("extracts concise MiniMax error messages", async () => {
        const detail = await responseErrorDetail(new Response(JSON.stringify({
            error: { message: "login fail" },
            request_id: "request-1"
        }), { status: 401 }));

        expect(detail).toBe("login fail (request id: request-1)");
    });
});

describe("chatCompletionHeaders", () => {
    it("uses provider-compatible Authorization casing", () => {
        expect(chatCompletionHeaders("secret")).toEqual({
            "Authorization": "Bearer secret",
            "Content-Type": "application/json"
        });
    });

    it("omits Authorization when no API key is needed", () => {
        expect(chatCompletionHeaders("")).toEqual({
            "Content-Type": "application/json"
        });
    });
});

describe("chatCompletionProviderOptions", () => {
    it("sets provider-specific reasoning options only for matching hosts", () => {
        expect(chatCompletionProviderOptions("https://api.minimaxi.com/v1")).toEqual({ reasoning_split: true });
        expect(chatCompletionProviderOptions("http://localhost:11434/v1")).toEqual({});
        expect(chatCompletionProviderOptions("https://api.openai.com/v1")).toEqual({});
    });
});

describe("ollama native chat helpers", () => {
    it("resolves native chat URLs from OpenAI-compatible Ollama roots", () => {
        expect(ollamaChatUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/api/chat");
        expect(providerUsesOllamaNativeChat("http://127.0.0.1:11434/v1")).toBe(true);
        expect(providerUsesOllamaNativeChat("https://api.openai.com/v1")).toBe(false);
    });

    it("disables native Ollama thinking and limits predictions", () => {
        expect(ollamaChatBody({ model: "qwen3.5:2b", messages: [{ role: "user", content: "ok" }], maxTokens: 12 })).toMatchObject({
            model: "qwen3.5:2b",
            stream: false,
            think: false,
            options: { temperature: 0.2, num_predict: 12 }
        });
    });
});

describe("providerRequiresApiKey", () => {
    it("does not require keys for local Ollama-compatible providers", () => {
        expect(providerRequiresApiKey("http://localhost:11434/v1")).toBe(false);
        expect(providerRequiresApiKey("http://127.0.0.1:11434/v1")).toBe(false);
        expect(providerRequiresApiKey("https://api.openai.com/v1")).toBe(true);
    });
});

describe("chatCompletionsUrl", () => {
    it("appends the chat completions path to provider roots", () => {
        expect(chatCompletionsUrl("https://api.example.com")).toBe("https://api.example.com/v1/chat/completions");
        expect(chatCompletionsUrl("https://api.example.com/v1")).toBe("https://api.example.com/v1/chat/completions");
        expect(chatCompletionsUrl("https://api.example.com/v1/chat/completions")).toBe("https://api.example.com/v1/chat/completions");
    });
});

function jwtWithPayload(payload: object): string {
    return ["header", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".");
}