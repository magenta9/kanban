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
            expect(body.messages[0].content).toContain("after '需要分析持有标的的'");
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
                { role: "user", content: expect.stringContaining('"scenario":"tags"') }
            ]
        });
        expect(entry.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
    });
});

describe("AI prompt contracts", () => {
    it("uses a conservative description prompt for repeated numbered-list requirements", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            expect(body.messages[0].content).toContain("never duplicate or paraphrase previousListItems");
            expect(body.messages[0].content).toContain("blockedInsertions");
            expect(body.messages[0].content).toContain("For bullet mode only");
            expect(body.messages[0].content).toContain("previous list item already asks to clarify scope, data source, and output format");
            expect(body.messages[0].content).toContain("localLine.before is '2.'");
            const promptPayload = JSON.parse(body.messages[1].content) as { scenario: string; markdownMode: string; previousListItems: string[]; blockedInsertions: string[]; localLine: { before: string }; relatedFacts?: unknown };
            expect(promptPayload).toMatchObject({
                scenario: "description",
                suggestionProfile: { brevity: "high", directness: "high", evidenceAppetite: "medium" },
                markdownMode: "numbered-list",
                localLine: { before: "2." },
                previousListItems: ["需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。"],
                blockedInsertions: [
                    "覆盖范围：需要分析持有标的的仓位、盈亏和风险点",
                    "需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。"
                ]
            });
            expect(promptPayload.relatedFacts).toBeUndefined();
            return new Response(JSON.stringify({ message: { content: '{"insert":""}' } }), { status: 200 });
        }));

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "覆盖范围：需要分析持有标的的仓位、盈亏和风险点\n1.需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。\n2.",
            textAfterCursor: "",
            maxChars: 50,
            context: { relatedCards: [], boardLabels: [] }
        })).resolves.toEqual({});
    });

    it("uses the subtask prompt contract", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            expect(body.messages[0].content).toContain("Return JSON with one insert string");
            expect(body.messages[0].content).toContain("subtask title");
            expect(body.messages[0].content).toContain("For subtaskBeforeCursor '补齐'");
            expect(body.messages[0].content).toContain("short actionable fragment");
            expect(body.messages[0].content).toContain("Match the language already used in subtaskBeforeCursor");
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

    it("uses an empty completion decision for duplicate subtask prefixes", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            expect(JSON.parse(body.messages[1].content)).toMatchObject({
                scenario: "subtask",
                completionDecision: { returnEmpty: true, reason: "subtask prefix would duplicate a sibling subtask" }
            });
            return new Response(JSON.stringify({ message: { content: '{"insert":""}' } }), { status: 200 });
        }));

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
                    expect(body.messages[0].content).toContain("localLine.before is '2.'");
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