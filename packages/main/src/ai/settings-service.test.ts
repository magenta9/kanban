import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettingsService, chatCompletionHeaders, ollamaChatBody, ollamaChatUrl, responseErrorDetail } from "./settings-service";

let tempRoots: string[] = [];

function createService(): { root: string; service: AiSettingsService; settingsPath: string; logPath: string } {
    const root = mkdtempSync(join(tmpdir(), "kanban-ai-"));
    tempRoots.push(root);
    const settingsPath = join(root, "ai-settings.json");
    const logPath = join(root, "ai.log");
    return { root, settingsPath, logPath, service: new AiSettingsService({ settingsPath, logPath }) };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
    tempRoots = [];
});

describe("AiSettingsService", () => {
    it("saves Ollama settings without API key state", () => {
        const { service, settingsPath } = createService();

        const state = service.saveSettings({ enabled: true, baseUrl: " http://localhost:11434/v1 ", model: " llama3.2 " });

        expect(state).toMatchObject({ enabled: true, configured: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toMatchObject({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        expect(JSON.stringify(state)).not.toContain("apiKey");
    });

    it("returns an incomplete result when testing without config", async () => {
        const { service } = createService();

        await expect(service.testConnection()).resolves.toEqual({ ok: false, message: "AI settings are incomplete." });
    });

    it("tests Ollama structured output capability", async () => {
        const { service, logPath } = createService();
        service.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
            expect(url).toBe("http://localhost:11434/api/chat");
            expect(init.headers).toEqual({ "Content-Type": "application/json" });
            expect(JSON.parse(String(init.body))).toMatchObject({
                model: "llama3.2",
                stream: false,
                think: false,
                format: { type: "object", properties: { insert: { type: "string" } }, required: ["insert"], additionalProperties: false },
                options: { num_predict: 12 }
            });
            return new Response(JSON.stringify({ message: { content: '{"insert":"ok"}' } }), { status: 200 });
        }));

        await expect(service.testConnection()).resolves.toMatchObject({ ok: true, message: "AI structured output succeeded." });
        expect(service.getSettings()).toMatchObject({ configured: true });
        const entry = JSON.parse(readFileSync(logPath, "utf8").trim()) as Record<string, unknown>;
        expect(entry).toMatchObject({
            level: "info",
            scope: "testConnection",
            scenario: "ai-settings.connection-test",
            event: "success",
            message: "AI structured output test completed.",
            statusCode: 200,
            durationMs: expect.any(Number)
        });
        expect(entry.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
    });

    it("fails connection testing when structured output is not valid", async () => {
        const { service } = createService();
        service.saveSettings({ enabled: true, baseUrl: "http://localhost:11434", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 })));

        await expect(service.testConnection()).resolves.toMatchObject({ ok: false, message: "AI test failed: structured output did not match schema." });
    });

    it("includes provider error details when connection testing fails", async () => {
        const { service } = createService();
        service.saveSettings({ enabled: true, baseUrl: "http://localhost:11434", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "model not found" }, request_id: "request-1" }), { status: 404 })));

        const result = await service.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).toContain("HTTP 404");
        expect(result.message).toContain("model not found (request id: request-1)");
    });
});

describe("responseErrorDetail", () => {
    it("extracts concise provider error messages", async () => {
        const detail = await responseErrorDetail(new Response(JSON.stringify({
            error: { message: "login fail" },
            request_id: "request-1"
        }), { status: 401 }));

        expect(detail).toBe("login fail (request id: request-1)");
    });
});

describe("chatCompletionHeaders", () => {
    it("uses JSON headers without Authorization", () => {
        expect(chatCompletionHeaders()).toEqual({
            "Content-Type": "application/json"
        });
    });
});

describe("ollama native chat helpers", () => {
    it("resolves native chat URLs from common Ollama roots", () => {
        expect(ollamaChatUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/api/chat");
        expect(ollamaChatUrl("http://127.0.0.1:11434/api")).toBe("http://127.0.0.1:11434/api/chat");
        expect(ollamaChatUrl("http://127.0.0.1:11434/api/chat")).toBe("http://127.0.0.1:11434/api/chat");
    });

    it("disables native Ollama thinking, limits predictions, and forwards schema format", () => {
        expect(ollamaChatBody({
            model: "qwen3.5:2b-mlx",
            messages: [{ role: "user", content: "ok" }],
            maxTokens: 12,
            format: { type: "object" }
        })).toMatchObject({
            model: "qwen3.5:2b-mlx",
            stream: false,
            think: false,
            format: { type: "object" },
            options: { temperature: 0.2, num_predict: 12 }
        });
    });
});