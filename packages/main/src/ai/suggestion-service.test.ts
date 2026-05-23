import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KanbanCard } from "@kanban/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettingsService, type SecretCodec } from "./settings-service";
import { AiSuggestionService, isSuggestionWithinLimit, normalizeInsertionSuggestion, normalizeLabelName, normalizeLabelSuggestions, normalizeSuggestion } from "./suggestion-service";

const codec: SecretCodec = {
    isAvailable: () => true,
    encrypt: (value) => `enc:${value}`,
    decrypt: (value) => value.replace(/^enc:/, "")
};

let tempRoots: string[] = [];

function createAiServices(): { root: string; settings: AiSettingsService; suggestions: AiSuggestionService } {
    const root = mkdtempSync(join(tmpdir(), "kanban-ai-suggestions-"));
    tempRoots.push(root);
    const settings = new AiSettingsService({ settingsPath: join(root, "ai-settings.json"), logPath: join(root, "ai.log") }, codec);
    return { root, settings, suggestions: new AiSuggestionService(settings) };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
    tempRoots = [];
});

describe("AI text suggestion normalization", () => {
    it("accepts non-empty suggestions within the character limit", () => {
        expect(isSuggestionWithinLimit("补全标题", 15)).toBe(true);
        expect(isSuggestionWithinLimit("", 15)).toBe(false);
        expect(isSuggestionWithinLimit("这是一段超过限制的补全文本", 5)).toBe(false);
    });

    it("strips fenced text wrappers", () => {
        expect(normalizeSuggestion("```markdown\n- Finish review\n```")).toBe("- Finish review");
    });

    it("strips model reasoning blocks before enforcing completion limits", () => {
        expect(normalizeSuggestion("<think>Analyze the card first.</think>\n补充验收标准")).toBe("补充验收标准");
    });

    it("trims text that overlaps the cursor context", () => {
        expect(normalizeInsertionSuggestion("需要复盘持有标的的估值水平与涨跌原因", "需要复盘持有标的的", "")).toBe("估值水平与涨跌原因");
        expect(normalizeInsertionSuggestion("收盘价和目标价", "复盘", "和目标价")).toBe("收盘价");
    });
});

describe("AI text suggestions", () => {
    it("calls local Ollama-compatible providers without an API key", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        const fetch = vi.fn(async (url: string, init: RequestInit) => {
            expect(url).toBe("http://localhost:11434/api/chat");
            expect(init.headers).toEqual({ "Content-Type": "application/json" });
            expect(JSON.parse(String(init.body))).toMatchObject({ model: "llama3.2", stream: false, think: false, options: { num_predict: 512 } });
            return new Response(JSON.stringify({ message: { content: "估值变化" } }), { status: 200 });
        });
        vi.stubGlobal("fetch", fetch);

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "复盘持有标的",
            textAfterCursor: "",
            maxChars: 20,
            context: { relatedCards: [], boardLabels: [] }
        })).resolves.toEqual({ suggestion: "估值变化" });
        expect(fetch).toHaveBeenCalledOnce();
    });
});

describe("AI label suggestion normalization", () => {
    const boardLabels = [
        { id: "label-1", name: "Frontend" },
        { id: "label-2", name: "Bug" }
    ];

    it("deduplicates labels and reuses existing unattached labels", () => {
        expect(normalizeLabelSuggestions('[" frontend ", "New", "new", "Bug"]', 5, boardLabels, ["label-2"])).toEqual([
            { name: "frontend", existingLabelId: "label-1" },
            { name: "New" }
        ]);
    });

    it("parses JSON labels after model reasoning blocks", () => {
        expect(normalizeLabelSuggestions('<think>Review the current card.</think>\n["Review", "Ops"]', 5, boardLabels, [])).toEqual([
            { name: "Review" },
            { name: "Ops" }
        ]);
    });

    it("does not turn prose or reasoning into labels", () => {
        expect(normalizeLabelSuggestions('<think>Let me analyze this card.</think> Priority: high, no labels assigned', 5, boardLabels, [])).toEqual([]);
    });

    it("normalizes label names case-insensitively", () => {
        expect(normalizeLabelName("  Product   Ops ")).toBe("product ops");
    });
});

describe("AI label suggestions", () => {
    it("logs tag autocomplete requests with scenario, formatted timestamp, and latency", async () => {
        const { root, settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
            expect(url).toBe("http://localhost:11434/api/chat");
            expect(init.headers).toEqual({ "Content-Type": "application/json" });
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            expect(body).toMatchObject({ model: "llama3.2", stream: false, think: false, options: { num_predict: 128 } });
            expect(JSON.parse(body.messages[1].content)).toMatchObject({ draft: "Bu" });
            return new Response(JSON.stringify({ message: { content: '["Fix tag autocomplete", "持有标的", "1", "Bug"]' } }), { status: 200 });
        }));
        const card = testCard({ labelIds: [] });

        await expect(suggestions.suggestLabels({
            context: {
                currentCard: card,
                relatedCards: [],
                boardLabels: [
                    { id: "label-1", boardId: "board-1", name: "Bug", color: "#ef4444" },
                    { id: "label-2", boardId: "board-1", name: "Dev", color: "#64748b" },
                    { id: "label-3", boardId: "board-1", name: "Trade", color: "#22c55e" },
                    { id: "label-4", boardId: "board-1", name: "1", color: "#84cc16" }
                ]
            },
            maxSuggestions: 5,
            draft: "Bu"
        })).resolves.toEqual({ suggestions: [{ name: "Bug", existingLabelId: "label-1" }] });

        const entry = JSON.parse(readFileSync(join(root, "ai.log"), "utf8").trim()) as Record<string, unknown>;
        expect(entry).toMatchObject({
            level: "info",
            scope: "suggestLabels:tags",
            scenario: "tag-autocomplete",
            event: "success",
            message: "AI tag autocomplete completed: 1 usable suggestions.",
            statusCode: 200,
            durationMs: expect.any(Number)
        });
        expect(entry.prompt).toMatchObject({
            messages: [
                { role: "system", content: expect.stringContaining("draft") },
                { role: "user", content: expect.stringContaining('"draft":"Bu"') }
            ]
        });
        expect(entry.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
    });
});

function testCard(patch: Partial<KanbanCard> = {}): KanbanCard {
    const now = Date.now();
    return {
        id: "card-1",
        boardId: "board-1",
        columnId: "column-1",
        title: "Fix tag autocomplete",
        priority: "none",
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
        labelIds: [],
        subtasks: [],
        comments: [],
        ...patch
    };
}