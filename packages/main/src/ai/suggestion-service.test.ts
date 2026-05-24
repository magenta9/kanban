import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiTextSuggestionInput, KanbanCard } from "@kanban/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettingsService } from "./settings-service";
import { AiSuggestionService, isSuggestionWithinLimit, isUsableTextSuggestion, normalizeInsertionSuggestion, normalizeLabelName, normalizeLabelSuggestions, normalizeSuggestion, normalizeTextSuggestion } from "./suggestion-service";

let tempRoots: string[] = [];

function createAiServices(): { root: string; settings: AiSettingsService; suggestions: AiSuggestionService } {
    const root = mkdtempSync(join(tmpdir(), "kanban-ai-suggestions-"));
    tempRoots.push(root);
    const settings = new AiSettingsService({ settingsPath: join(root, "ai-settings.json"), logPath: join(root, "ai.log") });
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
        expect(isSuggestionWithinLimit("。", 15)).toBe(false);
        expect(isSuggestionWithinLimit("这是一段超过限制的补全文本", 5)).toBe(false);
    });

    it("strips fenced text wrappers", () => {
        expect(normalizeSuggestion("```markdown\n- Finish review\n```")).toBe("- Finish review");
    });

    it("strips model reasoning blocks before enforcing completion limits", () => {
        expect(normalizeSuggestion("<think>Analyze the card first.</think>\n补充验收标准")).toBe("补充验收标准");
    });

    it("extracts scenario-specific JSON text contracts", () => {
        expect(normalizeTextSuggestion('{"insert":"补齐验收标准"}', "subtask")).toBe("补齐验收标准");
        expect(normalizeTextSuggestion('```json\n{"insert":"补充验收标准"}\n```', "description")).toBe("补充验收标准");
        expect(normalizeTextSuggestion('{"insert":"我先整理一版结论。"}', "comment")).toBe("我先整理一版结论。");
        expect(normalizeTextSuggestion('{"insert":""', "subtask")).toBe("");
        expect(normalizeTextSuggestion("估值变化", "description")).toBe("");
    });

    it("accepts concise subtask insertions within the character limit", () => {
        expect(isUsableTextSuggestion("验收标准", { field: "subtask", maxChars: 15 })).toBe(true);
        expect(isUsableTextSuggestion("这是一段超过限制的子任务补全文本", { field: "subtask", maxChars: 5 })).toBe(false);
        expect(isUsableTextSuggestion("。", { field: "subtask", maxChars: 15 })).toBe(false);
    });

    it("returns subtask suggestions from the insert contract", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: { content: '{"insert":"验收标准"}' } }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "subtask",
            textBeforeCursor: "补齐",
            textAfterCursor: "",
            maxChars: 12,
            context: { currentCard: testCard({ descriptionText: "需要补齐发布检查项和验收标准", subtasks: [{ id: "subtask-1", title: "确认发布检查项", completed: false, createdAt: 1, updatedAt: 1 }] }), relatedCards: [], boardLabels: [] }
        })).resolves.toEqual({ suggestion: "验收标准" });
    });

    it("rejects repeated description list items", () => {
        expect(isUsableTextSuggestion("需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。", {
            field: "description",
            textBeforeCursor: "覆盖范围：需要分析持有标的的仓位、盈亏和风险点\n1.需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。\n2.",
            maxChars: 50
        })).toBe(false);
        expect(isUsableTextSuggestion("补充仓位变化和盈亏归因。", {
            field: "description",
            textBeforeCursor: "覆盖范围：需要分析持有标的的仓位、盈亏和风险点\n1.梳理交易明细。\n2.",
            maxChars: 50
        })).toBe(true);
        expect(isUsableTextSuggestion("分析具体标的范围、历史数据获取方式以及预期输出格式。", {
            field: "description",
            textBeforeCursor: "覆盖范围：需要分析持有标的的仓位、盈亏和风险点\n1.需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。\n2.",
            maxChars: 50
        })).toBe(false);
        expect(isUsableTextSuggestion("关键步骤和验证方式", {
            field: "description",
            textBeforeCursor: "覆盖范围：需要分析持有标的的仓位、盈亏和风险点\n1.需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。\n2.",
            maxChars: 50
        })).toBe(false);
    });

    it("rejects description insertions after complete lines and headings", () => {
        expect(isUsableTextSuggestion("仓位、盈亏和风险点", {
            field: "description",
            textBeforeCursor: "持有标的已经确认。",
            maxChars: 50
        })).toBe(false);
        expect(isUsableTextSuggestion("仓位、盈亏和风险点", {
            field: "description",
            textBeforeCursor: "### 持有标的",
            maxChars: 50
        })).toBe(false);
        expect(isUsableTextSuggestion("- 关键步骤和验证方式", {
            field: "description",
            textBeforeCursor: "- 补充构建流程的",
            maxChars: 40
        })).toBe(false);
    });

    it("rejects ambiguous comment prefixes", () => {
        expect(isUsableTextSuggestion("收到，已同步测试初稿。", {
            field: "comment",
            textBeforeCursor: "嗯",
            maxChars: 24
        })).toBe(false);
        expect(isUsableTextSuggestion("今天补齐结论。", {
            field: "comment",
            textBeforeCursor: "进展 ",
            maxChars: 24
        })).toBe(true);
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
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }]; options: { num_predict: number } };
            expect(body).toMatchObject({ model: "llama3.2", stream: false, think: false, options: { num_predict: 160 } });
            expect(body.messages[0].content).toContain("Markdown kanban description");
            expect(body.messages[0].content).not.toContain("For example");
            expect(body.messages[0].content).not.toContain("仓位、盈亏和风险点");
            expect(body.messages[0].content).not.toContain("需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式");
            expect(body.messages[0].content).not.toContain("关键步骤和验证方式");
            expect(body.messages[0].content).not.toContain("补充构建流程的");
            expect(JSON.parse(body.messages[1].content)).toMatchObject({
                scenario: "description",
                markdownMode: "paragraph",
                suggestionProfile: { brevity: "high", directness: "high", evidenceAppetite: "medium" }
            });
            return new Response(JSON.stringify({ message: { content: '{"insert":"估值变化"}' } }), { status: 200 });
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

    it("adds structural cues for weak option-style description fragments", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            expect(body.messages[0].content).toContain("unfinished local phrase itself");
            expect(body.messages[0].content).toContain("current option with a short peer fragment");
            expect(JSON.parse(body.messages[1].content)).toMatchObject({
                scenario: "description",
                localLine: { before: "方案2:其他的趋势" },
                groundedContinuationHint: "线指标作为辅助信号",
                continuationStyleHint: "Continue the current option with a short peer fragment that matches nearby lines; do not start a new sentence or checklist.",
                recentNonEmptyLines: ["先整理出流程文章，然后再思考怎么弄成agent定时执行", "优化趋势交易信号", "方案1:1w、2w同向方向一致才是方向一致"]
            });
            return new Response(JSON.stringify({ message: { content: '{"insert":"方案2:其他的趋势"}' } }), { status: 200 });
        }));

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "先整理出流程文章，然后再思考怎么弄成agent定时执行\n\n优化趋势交易信号\n\n方案1:1w、2w同向方向一致才是方向一致\n方案2:其他的趋势",
            textAfterCursor: "",
            maxChars: 12,
            context: {
                currentCard: testCard({
                    title: "趋势交易的agent",
                    descriptionText: "先整理出流程文章，然后再思考怎么弄成agent定时执行\n\n优化趋势交易信号\n\n方案1:1w、2w同向方向一致才是方向一致\n方案2:其他的趋势",
                    comments: [
                        { id: "comment-1", body: "可以补充趋势线指标作为辅助信号", createdAt: 1, updatedAt: 1 }
                    ]
                }),
                relatedCards: [],
                boardLabels: [
                    { id: "label-1", boardId: "board-1", name: "agent", color: "#64748b" },
                    { id: "label-2", boardId: "board-1", name: "trade", color: "#22c55e" }
                ]
            }
        })).resolves.toEqual({ suggestion: "线指标作为辅助信号" });
    });

    it("derives grounded continuation hints from normalized description fragments", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            expect(JSON.parse(body.messages[1].content)).toMatchObject({
                scenario: "description",
                localLine: { before: "- 补充构建流程的" },
                groundedContinuationHint: "关键步骤和验证方式"
            });
            return new Response(JSON.stringify({ message: { content: '{"insert":"- 补充构建流程的"}' } }), { status: 200 });
        }));

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "- 补充构建流程的",
            textAfterCursor: "",
            maxChars: 20,
            context: {
                currentCard: testCard({
                    title: "构建流程",
                    descriptionText: "需要补充构建流程的关键步骤和验证方式。"
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "关键步骤和验证方式" });
    });

    it("derives grounded continuation hints for markdown table and code contexts", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        const fetch = vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            const promptInput = JSON.parse(body.messages[1].content) as { scenario: string; markdownMode: string; groundedContinuationHint: string };
            if (promptInput.markdownMode === "table") {
                expect(promptInput.groundedContinuationHint).toBe("85%");
                return new Response(JSON.stringify({ message: { content: '{"insert":"| 完成率 | "}' } }), { status: 200 });
            }
            expect(promptInput.markdownMode).toBe("code");
            expect(promptInput.groundedContinuationHint).toBe("30000");
            return new Response(JSON.stringify({ message: { content: '{"insert":""}' } }), { status: 200 });
        });
        vi.stubGlobal("fetch", fetch);

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "| 指标 | 当前值 |\n|---|---|\n| 完成率 | ",
            textAfterCursor: " |\n| 风险点 | 待确认 |",
            maxChars: 12,
            context: {
                currentCard: testCard({
                    title: "周报指标",
                    descriptionText: "| 指标 | 当前值 |\n|---|---|\n| 完成率 | 85% |\n| 风险点 | 待确认 |"
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "85%" });

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "配置示例：\n```json\n{\n  \"timeout\": ",
            textAfterCursor: ",\n  \"retry\": 3\n}\n```",
            maxChars: 8,
            context: {
                currentCard: testCard({
                    title: "接口配置",
                    descriptionText: "配置示例需要设置 timeout 为 30000，并保留 retry 为 3。"
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "30000" });

        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("shortens overlong suggestions to the first usable clause", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"观察小级别趋势变化，并补充进场条件和止损触发逻辑。"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "方案3:观察",
            textAfterCursor: "",
            maxChars: 12,
            context: {
                currentCard: testCard({ title: "趋势交易的agent", descriptionText: "方案3:观察" }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "小级别趋势变化" });
    });

    it("prefers a fuller grounded description hint over a one-word attribute fragment", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"风险"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "需要分析持有标的的",
            textAfterCursor: "",
            maxChars: 50,
            context: {
                currentCard: testCard({
                    title: "持仓复盘",
                    descriptionText: "需要分析持有标的的仓位、盈亏和风险点。"
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "仓位、盈亏和风险点" });
    });

    it("prefers the exact grounded table cell value over a plausible model guess", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"80%"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "| 指标 | 当前值 |\n|---|---|\n| 完成率 | ",
            textAfterCursor: " |\n| 风险点 | 待确认 |",
            maxChars: 12,
            context: {
                currentCard: testCard({
                    title: "周报指标",
                    descriptionText: "| 指标 | 当前值 |\n|---|---|\n| 完成率 | 85% |\n| 风险点 | 待确认 |"
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "85%" });
    });

    it("logs non-length discard reasons without mislabeling them as maxChars overflow", async () => {
        const { root, settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"收到，已同步测试初稿。"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "ok",
            textAfterCursor: "",
            maxChars: 24,
            context: {
                currentCard: testCard({ title: "趋势交易的agent" }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({});

        const entry = JSON.parse(readFileSync(join(root, "ai.log"), "utf8").trim()) as { event: string; message: string };
        expect(entry.event).toBe("discarded");
        expect(entry.message).toContain("comment prefix is too ambiguous");
        expect(entry.message).not.toContain("exceeds");
    });

    it("falls back to a grounded reply hint when the model returns a one-character placeholder", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"待"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "回复 ",
            textAfterCursor: "",
            maxChars: 24,
            context: {
                currentCard: testCard({
                    title: "设计确认",
                    descriptionText: "等待设计确认。",
                    comments: [
                        { id: "comment-1", body: "设计稿已补截图", createdAt: 1, updatedAt: 1 }
                    ]
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "设计稿已补截图" });
    });

    it("falls back to a grounded status hint when the model echoes the local prefix", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"Sync update:"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "Sync update: ",
            textAfterCursor: "",
            maxChars: 16,
            context: {
                currentCard: testCard({
                    title: "接口联调",
                    descriptionText: "API 接口已对齐，还需要同步测试结论。",
                    comments: [
                        { id: "comment-1", body: "API接口已对齐", createdAt: 1, updatedAt: 1 }
                    ]
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "API接口已对齐，测试结论待同步" });
    });

    it("prefers a grounded action hint over a generic request wrapper", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"需补充配置说明"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "下一步 ",
            textAfterCursor: "",
            maxChars: 24,
            context: {
                currentCard: testCard({
                    title: "文档补齐",
                    descriptionText: "下一步需要补齐文档中的配置说明。"
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "补齐文档中的配置说明" });
    });

    it("prefers a grounded status hint with temporal evidence over a shorter generic status", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"已同步初稿"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "进展 ",
            textAfterCursor: "",
            maxChars: 24,
            context: {
                currentCard: testCard({
                    title: "评论草稿",
                    descriptionText: "需要整理评论草稿。",
                    comments: [
                        { id: "comment-1", body: "昨天已经同步初稿", createdAt: 1, updatedAt: 1 }
                    ]
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "昨天已经同步初稿" });
    });

    it("prefers a grounded due-today task fragment over a longer status sentence", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"风险复核还在进行中"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "今天 ",
            textAfterCursor: "",
            maxChars: 24,
            context: {
                currentCard: testCard({
                    title: "支付链路上线",
                    descriptionText: "今天需要完成上线前风险复核。",
                    comments: [
                        { id: "comment-1", body: "联调已经通过", createdAt: 1, updatedAt: 1 },
                        { id: "comment-2", body: "风险复核还在进行", createdAt: 2, updatedAt: 2 }
                    ]
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "风险复核" });
    });

    it("prefers a grounded bilingual status recap over a pending-only fragment", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"测试结论待同步"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "Sync update: ",
            textAfterCursor: "",
            maxChars: 16,
            context: {
                currentCard: testCard({
                    title: "接口联调",
                    descriptionText: "API 接口已对齐，还需要同步测试结论。",
                    comments: [
                        { id: "comment-1", body: "API接口已对齐", createdAt: 1, updatedAt: 1 }
                    ]
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "API接口已对齐，测试结论待同步" });
    });

    it("prefers a grounded risk fragment over a generic risk follow-up", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"需要补充影响范围"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "风险 ",
            textAfterCursor: "",
            maxChars: 24,
            context: {
                currentCard: testCard({
                    title: "风险点",
                    descriptionText: "风险点需要继续确认影响范围。",
                    comments: [
                        { id: "comment-1", body: "还缺影响范围", createdAt: 1, updatedAt: 1 }
                    ]
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "影响范围" });
    });

    it("prefers a grounded action hint that keeps document context", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"补充配置说明"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "下一步 ",
            textAfterCursor: "",
            maxChars: 24,
            context: {
                currentCard: testCard({
                    title: "文档补齐",
                    descriptionText: "下一步需要补齐文档中的配置说明。"
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "补齐文档中的配置说明" });
    });

    it("prefers a grounded reply hint over a generic blocked-state placeholder", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"权限问题"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "回复 ",
            textAfterCursor: "",
            maxChars: 24,
            context: {
                currentCard: testCard({
                    title: "每日巡检",
                    descriptionText: "复发任务因权限缺失暂时阻塞。",
                    comments: [
                        { id: "comment-1", body: "今天的巡检没有自动生成", createdAt: 1, updatedAt: 1 },
                        { id: "comment-2", body: "需要先恢复权限", createdAt: 2, updatedAt: 2 }
                    ]
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "先恢复权限" });
    });

    it("prefers a grounded conclusion recap over a partial risk fragment", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"风险影响范围还需复核"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "结论 ",
            textAfterCursor: "",
            maxChars: 28,
            context: {
                currentCard: testCard({
                    title: "风险评审",
                    descriptionText: "当前结论倾向继续推进，但风险影响范围还要复核。",
                    comments: [
                        { id: "comment-1", body: "可以继续推进", createdAt: 1, updatedAt: 1 },
                        { id: "comment-2", body: "影响范围还没最终确认", createdAt: 2, updatedAt: 2 }
                    ]
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "继续推进，但风险影响范围还要复核" });
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

    it("parses ranked JSON tag suggestions", () => {
        expect(normalizeLabelSuggestions('{"suggestions":[{"name":"Bug","kind":"existing","confidence":0.91},{"name":"Ops","kind":"new","confidence":0.4}]}', 5, boardLabels, [])).toEqual([
            { name: "Bug", existingLabelId: "label-2" },
            { name: "Ops" }
        ]);
    });

    it("prioritizes existing labels over new labels after parsing", () => {
        expect(normalizeLabelSuggestions('{"suggestions":[{"name":"Ops","kind":"new","confidence":0.9},{"name":"Bug","kind":"existing","confidence":0.5}]}', 2, boardLabels, [])).toEqual([
            { name: "Bug", existingLabelId: "label-2" },
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
            expect(body.messages[0].content).toContain("rank kanban tag suggestions");
            const promptPayload = JSON.parse(body.messages[1].content) as { scenario: string; draft: string; candidateLabels: string[] };
            expect(promptPayload).toMatchObject({ scenario: "tags", draft: "Bu" });
            expect(promptPayload.candidateLabels[0]).toBe("Bug");
            return new Response(JSON.stringify({ message: { content: '{"suggestions":[{"name":"Fix tag autocomplete","kind":"new","confidence":0.4},{"name":"持有标的","kind":"new","confidence":0.3},{"name":"1","kind":"existing","confidence":0.2},{"name":"Bug","kind":"existing","confidence":0.9}]}' } }), { status: 200 });
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
        })).resolves.toEqual({
            suggestions: [
                { name: "1", existingLabelId: "label-4" },
                { name: "Bug", existingLabelId: "label-1" },
                { name: "持有标的" }
            ]
        });

        const entry = JSON.parse(readFileSync(join(root, "ai.log"), "utf8").trim()) as Record<string, unknown>;
        expect(entry).toMatchObject({
            level: "info",
            scope: "suggestLabels:tags",
            scenario: "tag-autocomplete",
            event: "success",
            message: "AI tag autocomplete completed: 3 usable suggestions.",
            statusCode: 200,
            durationMs: expect.any(Number)
        });
        expect(entry.prompt).toMatchObject({
            messages: [
                { role: "system", content: expect.stringContaining("draft") },
                { role: "user", content: expect.stringContaining('"scenario":"tags"') }
            ]
        });
        expect(entry.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
    });
});

describe("AI prompt contracts", () => {
    it("skips model calls for repeated numbered-list requirements", async () => {
        const { root, settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "覆盖范围：需要分析持有标的的仓位、盈亏和风险点\n1.需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。\n2.",
            textAfterCursor: "",
            maxChars: 50,
            context: { relatedCards: [], boardLabels: [] }
        })).resolves.toEqual({});

        expect(fetch).not.toHaveBeenCalled();
        const entry = JSON.parse(readFileSync(join(root, "ai.log"), "utf8").trim()) as { event: string; message: string; prompt: { messages: [{ content: string }, { content: string }] } };
        expect(entry.event).toBe("skipped");
        expect(entry.message).toContain("bare numbered-list item would likely duplicate previous list items");
        expect(entry.prompt.messages[0].content).toContain("never duplicate or paraphrase previousListItems");
        expect(entry.prompt.messages[0].content).toContain("For bullet mode only");
        expect(JSON.parse(entry.prompt.messages[1].content)).toMatchObject({
            scenario: "description",
            completionDecision: { returnEmpty: true, reason: "bare numbered-list item would likely duplicate previous list items" },
            maxChars: 50
        });
    });

    it("skips model calls for open-ended description enumerations without grounded continuation", async () => {
        const { root, settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "主要是包含一些标的：纳斯达克、标普、",
            textAfterCursor: "",
            maxChars: 50,
            context: {
                currentCard: testCard({ title: "结构化分析标的", descriptionText: "主要是包含一些标的：纳斯达克、标普、" }),
                relatedCards: [],
                boardLabels: [
                    { id: "label-1", boardId: "board-1", name: "Design", color: "#64748b" },
                    { id: "label-2", boardId: "board-1", name: "Trade", color: "#22c55e" }
                ]
            }
        })).resolves.toEqual({});

        expect(fetch).not.toHaveBeenCalled();
        const entry = JSON.parse(readFileSync(join(root, "ai.log"), "utf8").trim()) as { event: string; message: string; prompt: { messages: [{ content: string }, { content: string }] } };
        expect(entry.event).toBe("skipped");
        expect(entry.message).toContain("open-ended enumeration has no grounded continuation");
        expect(JSON.parse(entry.prompt.messages[1].content)).toMatchObject({
            scenario: "description",
            completionDecision: { returnEmpty: true, reason: "open-ended enumeration has no grounded continuation" },
            maxChars: 50
        });
    });

    it("skips model calls for ungrounded option-style lines that would only echo the cursor", async () => {
        const { root, settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "先整理出流程文章，然后再思考怎么弄成agent定时执行\n\n优化趋势交易信号\n\n方案1:1w、2w同向方向一致才是方向一致\n方案2:其他的趋势线指标\n方案3:观察小级别",
            textAfterCursor: "",
            maxChars: 50,
            context: {
                currentCard: testCard({
                    title: "趋势交易的agent",
                    descriptionText: "先整理出流程文章，然后再思考怎么弄成agent定时执行\n\n优化趋势交易信号\n\n方案1:1w、2w同向方向一致才是方向一致\n方案2:其他的趋势线指标\n方案3:观察小级别",
                    labelIds: ["label-1", "label-2"],
                    comments: [
                        { id: "comment-1", body: "现在的考虑是可以搞成一个notion技能，然后实现自动化采集期货软件的界面截图数据，然后让AI分析是否适合合适的买点", createdAt: 1, updatedAt: 1 }
                    ]
                }),
                relatedCards: [],
                boardLabels: [
                    { id: "label-1", boardId: "board-1", name: "agent", color: "#64748b" },
                    { id: "label-2", boardId: "board-1", name: "trade", color: "#22c55e" }
                ],
                columnName: "In Progress"
            }
        })).resolves.toEqual({});

        expect(fetch).not.toHaveBeenCalled();
        const entry = JSON.parse(readFileSync(join(root, "ai.log"), "utf8").trim()) as { event: string; message: string; prompt: { messages: [{ content: string }, { content: string }] } };
        expect(entry.event).toBe("skipped");
        expect(entry.message).toContain("option-style line has no grounded continuation");
        expect(JSON.parse(entry.prompt.messages[1].content)).toMatchObject({
            scenario: "description",
            completionDecision: { returnEmpty: true, reason: "option-style line has no grounded continuation" },
            maxChars: 50
        });
    });

    it("skips mixed numbered-option lines with no grounded continuation", async () => {
        const { root, settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "先整理出流程文章，然后再思考怎么弄成agent定时执行\n\n优化趋势交易信号\n\n1. 1w、2w同向方向一致才是方向一致\n2. 寻找其他趋势线\n方案3:观察小级别",
            textAfterCursor: "",
            maxChars: 50,
            context: {
                currentCard: testCard({
                    title: "趋势交易的agent",
                    descriptionText: "先整理出流程文章，然后再思考怎么弄成agent定时执行\n\n优化趋势交易信号\n\n1. 1w、2w同向方向一致才是方向一致\n2. 寻找其他趋势线\n方案3:观察小级别"
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({});

        expect(fetch).not.toHaveBeenCalled();
        const entry = JSON.parse(readFileSync(join(root, "ai.log"), "utf8").trim()) as { event: string; message: string; prompt: { messages: [{ content: string }, { content: string }] } };
        expect(entry.event).toBe("skipped");
        expect(entry.message).toContain("option-style line has no grounded continuation");
        expect(JSON.parse(entry.prompt.messages[1].content)).toMatchObject({
            scenario: "description",
            completionDecision: { returnEmpty: true, reason: "option-style line has no grounded continuation" },
            maxChars: 50
        });
    });

    it("uses the subtask prompt contract", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            expect(body.messages[0].content).toContain("Return JSON with one insert string");
            expect(body.messages[0].content).toContain("subtask title");
            expect(body.messages[0].content).toContain("short actionable fragment");
            expect(body.messages[0].content).toContain("Match the language already used in subtaskBeforeCursor");
            expect(body.messages[0].content).not.toContain("For subtaskBeforeCursor");
            expect(body.messages[0].content).not.toContain("同步测试结论");
            expect(body.messages[0].content).not.toContain("验收标准'; a bad insert");
            expect(JSON.parse(body.messages[1].content)).toMatchObject({
                scenario: "subtask",
                suggestionProfile: { brevity: "high", directness: "high", evidenceAppetite: "medium" },
                subtaskBeforeCursor: "补齐",
                subtaskAfterCursor: "",
                currentCard: {
                    descriptionText: "需要补齐发布检查项和验收标准",
                    priority: "high",
                    labels: ["Dev"],
                    dates: { startDate: "2026-05-23", dueDate: "2026-05-25" },
                    recurrence: { trigger: "completion", cycle: "weekly", status: "active" }
                },
                siblingSubtasks: ["确认发布检查项", "同步测试结果"]
            });
            expect(JSON.parse(body.messages[1].content)).toMatchObject({
                currentCard: {
                    subtasks: [
                        { title: "确认发布检查项", completed: false },
                        { title: "同步测试结果", completed: false }
                    ]
                }
            });
            return new Response(JSON.stringify({ message: { content: '{"insert":"验收标准"}' } }), { status: 200 });
        }));

        await expect(suggestions.suggestText({
            field: "subtask",
            textBeforeCursor: "补齐",
            textAfterCursor: "",
            maxChars: 12,
            context: {
                currentCard: testCard({
                    descriptionText: "需要补齐发布检查项和验收标准",
                    priority: "high",
                    labelIds: ["label-1"],
                    startDate: Date.UTC(2026, 4, 23),
                    dueDate: Date.UTC(2026, 4, 25),
                    recurrence: { seriesId: "series-1", trigger: "completion", cycle: "weekly", status: "active" },
                    subtasks: [
                        { id: "subtask-1", title: "确认发布检查项", completed: false, createdAt: 1, updatedAt: 1 },
                        { id: "subtask-2", title: "同步测试结果", completed: false, createdAt: 1, updatedAt: 1 }
                    ]
                }),
                relatedCards: [],
                boardLabels: [{ id: "label-1", boardId: "board-1", name: "Dev", color: "#64748b" }]
            }
        })).resolves.toEqual({ suggestion: "验收标准" });
    });

    it("skips model calls for duplicate subtask prefixes", async () => {
        const { root, settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);

        await expect(suggestions.suggestText({
            field: "subtask",
            textBeforeCursor: "同步测试",
            textAfterCursor: "",
            maxChars: 12,
            context: {
                currentCard: testCard({
                    subtasks: [
                        { id: "subtask-1", title: "同步测试结果", completed: false, createdAt: 1, updatedAt: 1 },
                        { id: "subtask-2", title: "确认回归结论", completed: false, createdAt: 1, updatedAt: 1 }
                    ]
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({});

        expect(fetch).not.toHaveBeenCalled();
        const entry = JSON.parse(readFileSync(join(root, "ai.log"), "utf8").trim()) as { event: string; message: string; prompt: { messages: [{ content: string }, { content: string }] } };
        expect(entry.event).toBe("skipped");
        expect(entry.message).toContain("subtask prefix would duplicate a sibling subtask");
        expect(JSON.parse(entry.prompt.messages[1].content)).toMatchObject({
            scenario: "subtask",
            completionDecision: { returnEmpty: true, reason: "subtask prefix would duplicate a sibling subtask" }
        });
    });

    it("uses the comment teammate prompt contract", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            expect(body.messages[0].content).toContain("natural teammate tone");
            expect(body.messages[0].content).toContain("Do not auto-resolve, promise work");
            expect(JSON.parse(body.messages[1].content)).toMatchObject({ scenario: "comment", commentMode: "status", recentComments: ["昨天已经同步初稿"] });
            return new Response(JSON.stringify({ message: { content: '{"insert":"今天补齐结论。"}' } }), { status: 200 });
        }));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "进展 ",
            textAfterCursor: "",
            maxChars: 20,
            context: { currentCard: testCard({ comments: [{ id: "comment-1", body: "昨天已经同步初稿", createdAt: 1, updatedAt: 1 }] }), relatedCards: [], boardLabels: [] }
        })).resolves.toEqual({ suggestion: "今天补齐结论。" });
    });
});

describe("AI completion quality benchmarks", () => {
    const cases: Array<{
        name: string;
        input: AiTextSuggestionInput;
        modelContent: string;
        expected: Record<string, string>;
        assertPrompt: (body: { messages: [{ role: string; content: string }, { role: string; content: string }] }) => void;
    }> = [
            {
                name: "subtask completes with an actionable fragment",
                input: {
                    field: "subtask",
                    textBeforeCursor: "补齐",
                    textAfterCursor: "",
                    maxChars: 12,
                    context: {
                        currentCard: testCard({
                            descriptionText: "需要补齐发布检查项和验收标准",
                            subtasks: [
                                { id: "subtask-1", title: "确认发布检查项", completed: false, createdAt: 1, updatedAt: 1 },
                                { id: "subtask-2", title: "同步测试结果", completed: false, createdAt: 1, updatedAt: 1 }
                            ]
                        }),
                        relatedCards: [],
                        boardLabels: []
                    }
                },
                modelContent: '{"insert":"验收标准"}',
                expected: { suggestion: "验收标准" },
                assertPrompt: (body) => {
                    expect(body.messages[0].content).toContain("subtask title");
                    expect(body.messages[0].content).toContain("short actionable fragment");
                    expect(JSON.parse(body.messages[1].content)).toMatchObject({ scenario: "subtask", subtaskBeforeCursor: "补齐" });
                }
            },
            {
                name: "description rejects a repeated requirement list item",
                input: {
                    field: "description",
                    textBeforeCursor: "覆盖范围：需要分析持有标的的仓位、盈亏和风险点\n1.需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。\n2.",
                    textAfterCursor: "",
                    maxChars: 50,
                    context: { relatedCards: [], boardLabels: [] }
                },
                modelContent: '{"insert":"需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。"}',
                expected: {},
                assertPrompt: (body) => {
                    expect(body.messages[0].content).toContain("never duplicate or paraphrase previousListItems");
                    expect(body.messages[0].content).toContain("blockedInsertions");
                    expect(body.messages[0].content).toContain("bare next numbered item after an existing requirement checklist");
                    expect(body.messages[0].content).not.toContain("需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式");
                    expect(JSON.parse(body.messages[1].content)).toMatchObject({
                        scenario: "description",
                        markdownMode: "numbered-list",
                        blockedInsertions: [
                            "覆盖范围：需要分析持有标的的仓位、盈亏和风险点",
                            "需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。"
                        ]
                    });
                }
            },
            {
                name: "comment keeps teammate update context",
                input: {
                    field: "comment",
                    textBeforeCursor: "进展 ",
                    textAfterCursor: "",
                    maxChars: 20,
                    context: { currentCard: testCard({ comments: [{ id: "comment-1", body: "昨天已经同步初稿", createdAt: 1, updatedAt: 1 }] }), relatedCards: [], boardLabels: [] }
                },
                modelContent: '{"insert":"今天补齐结论。"}',
                expected: { suggestion: "今天补齐结论。" },
                assertPrompt: (body) => {
                    expect(body.messages[0].content).toContain("natural teammate tone");
                    expect(JSON.parse(body.messages[1].content)).toMatchObject({ scenario: "comment", commentMode: "status", recentComments: ["昨天已经同步初稿"] });
                }
            }
        ];

    it.each(cases)("$name", async ({ input, modelContent, expected, assertPrompt }) => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            assertPrompt(body);
            return new Response(JSON.stringify({ message: { content: modelContent } }), { status: 200 });
        }));

        await expect(suggestions.suggestText(input)).resolves.toEqual(expected);
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