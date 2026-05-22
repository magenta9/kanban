import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettingsService, apiKeyValidationMessage, chatCompletionHeaders, chatCompletionsUrl, responseErrorDetail, type SecretCodec } from "./settings-service";

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

    it("includes provider error details when connection testing fails", async () => {
        const { service } = createService();
        service.saveSettings({ enabled: true, baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7", apiKey: "bad-key" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            expect(init.headers).toMatchObject({ "Authorization": "Bearer bad-key", "Content-Type": "application/json" });
            expect(JSON.parse(String(init.body))).toMatchObject({ temperature: 0.2, max_completion_tokens: 5 });
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