import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiTextSuggestionInput, KanbanCard } from "@kanban/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettingsService } from "./settings-service";
import { AiSuggestionService, normalizeInsertionSuggestion, normalizeLabelName, normalizeLabelSuggestions, normalizeSuggestion, normalizeTextSuggestion } from "./suggestion-service";

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

    it("trims text that overlaps the cursor context", () => {
        expect(normalizeInsertionSuggestion("需要复盘持有标的的估值水平与涨跌原因", "需要复盘持有标的的", "")).toBe("估值水平与涨跌原因");
        expect(normalizeInsertionSuggestion("收盘价和目标价", "复盘", "和目标价")).toBe("收盘价");
        expect(normalizeInsertionSuggestion("风险复核\n测试结论待同步。", "今天 ", "测试结论待同步\n下一步：同步团队。")).toBe("风险复核");
        expect(normalizeInsertionSuggestion("先整理出流程文章，然后再思考怎么弄成agent定时执行", "先整理出流程文章，然后再思考怎么弄成agent定时执行\n如果", "")).toBe("");
        expect(normalizeInsertionSuggestion("观察小级别\n先整理出流程文章，然后再思考怎么弄成 agent 定时执行", "先整理出流程文章，然后再思考怎么弄成agent定时执行\n\n优化趋势交易信号\n\n1. 1w、2w同向方向一致才是方向一致\n2. 寻找其他趋势线\n方案3:", "")).toBe("观察小级别");
        expect(normalizeInsertionSuggestion("风险复核\n风险复核", "", "")).toBe("风险复核");
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
            expect(body.messages[0].content).toContain("continuationStyleHint");
            expect(body.messages[0].content).toContain("nearby peer lines");
            expect(JSON.parse(body.messages[1].content)).toMatchObject({
                scenario: "description",
                textBeforeCursor: "方案2:其他的趋势",
                localLine: { before: "方案2:其他的趋势" },
                groundedContinuationHint: "线指标作为辅助信号",
                continuationStyleHint: "Continue the current option with a short peer fragment that matches nearby lines; do not start a new sentence or checklist.",
                recentNonEmptyLines: ["方案1:1w、2w同向方向一致才是方向一致"]
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
        })).resolves.toEqual({});
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
        })).resolves.toEqual({});
    });

    it("derives grounded continuation hints for markdown table and code contexts", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        const fetch = vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            const promptInput = JSON.parse(body.messages[1].content) as { scenario: string; markdownMode: string; groundedContinuationHint: string };
            if (promptInput.markdownMode === "table") {
                expect(promptInput.groundedContinuationHint).toBe("85%");
                expect(promptInput).toMatchObject({ textAfterCursor: " |" });
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
        })).resolves.toEqual({ suggestion: "完成率" });

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
        })).resolves.toEqual({});

        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("returns long model suggestions without local shortening", async () => {
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
        })).resolves.toEqual({ suggestion: "小级别趋势变化，并补充进场条件和止损触发逻辑。" });
    });

    it("returns model description inserts directly without grounded override", async () => {
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
        })).resolves.toEqual({ suggestion: "风险" });
    });

    it("returns model table-cell inserts directly without grounded override", async () => {
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
        })).resolves.toEqual({ suggestion: "80%" });
    });

    it("discards only when cursor-fit normalization removes all text", async () => {
        const { root, settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            message: { content: '{"insert":"回复"}' }
        }), { status: 200 })));

        await expect(suggestions.suggestText({
            field: "comment",
            textBeforeCursor: "回复",
            textAfterCursor: "",
            maxChars: 24,
            context: {
                currentCard: testCard({ title: "趋势交易的agent" }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({});

        const entry = JSON.parse(readFileSync(join(root, "ai.log"), "utf8").trim()) as { event: string; message: string; promptChars?: number; outputChars?: number };
        expect(entry.event).toBe("discarded");
        expect(entry.message).toContain("content repeated cursor context");
        expect(entry.promptChars).toEqual(expect.any(Number));
        expect(entry.outputChars).toEqual(expect.any(Number));
    });

    it("returns model comment inserts directly without grounded override", async () => {
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
                    title: "设计确认",
                    descriptionText: "等待设计确认。",
                    comments: [
                        { id: "comment-1", body: "今天的巡检没有自动生成", createdAt: 1, updatedAt: 1 },
                        { id: "comment-2", body: "需要先恢复权限", createdAt: 2, updatedAt: 2 }
                    ]
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "权限问题" });
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
            durationMs: expect.any(Number),
            promptChars: expect.any(Number),
            outputChars: expect.any(Number)
        });
        expect(entry.prompt).toBeUndefined();
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
        expect(entry.prompt.messages[0].content).toContain("previousListItems as style context only");
        expect(entry.prompt.messages[0].content).toContain("current marker or label");
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
            expect(body.messages[0].content).toContain("shortest missing action or object phrase");
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
                groundedContinuationHint: "验收标准"
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
            expect(JSON.parse(body.messages[1].content)).toMatchObject({ scenario: "comment", commentBeforeCursor: "进展 ", commentMode: "status", recentComments: ["昨天已经同步初稿"] });
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

    it("keeps numbered-list peer context local for partial list items", async () => {
        const { settings, suggestions } = createAiServices();
        settings.saveSettings({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { messages: [{ role: string; content: string }, { role: string; content: string }] };
            expect(body.messages[0].content).toContain("current fragment");
            expect(body.messages[0].content).toContain("current marker or label");
            expect(JSON.parse(body.messages[1].content)).toMatchObject({
                scenario: "description",
                markdownMode: "numbered-list",
                textBeforeCursor: "3. 构建",
                currentListItemText: "构建",
                groundedContinuationHint: "趋势交易信号流程",
                continuationStyleHint: "Continue the current numbered-list item after the existing prefix with a short peer fragment; do not repeat the typed prefix, the item number, or earlier paragraphs/headings.",
                recentNonEmptyLines: [
                    "1. 1w、2w同向方向一致才是方向一致",
                    "2.关注小级别趋势"
                ],
                previousListItems: [
                    "1w、2w同向方向一致才是方向一致",
                    "关注小级别趋势"
                ]
            });
            return new Response(JSON.stringify({ message: { content: '{"insert":"构建交易信号回测流程"}' } }), { status: 200 });
        }));

        await expect(suggestions.suggestText({
            field: "description",
            textBeforeCursor: "先整理出流程文章，然后再思考怎么弄成agent定时执行\n\n## 优化趋势交易信号\n\n1. 1w、2w同向方向一致才是方向一致\n2.关注小级别趋势\n3. 构建",
            textAfterCursor: "",
            maxChars: 16,
            context: {
                currentCard: testCard({
                    title: "趋势交易的agent",
                    descriptionText: "先整理出流程文章，然后再思考怎么弄成agent定时执行\n\n## 优化趋势交易信号\n\n1. 1w、2w同向方向一致才是方向一致\n2.关注小级别趋势\n3. 构建"
                }),
                relatedCards: [],
                boardLabels: []
            }
        })).resolves.toEqual({ suggestion: "交易信号回测流程" });
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
                    expect(body.messages[0].content).toContain("shortest missing action or object phrase");
                    expect(JSON.parse(body.messages[1].content)).toMatchObject({ scenario: "subtask", subtaskBeforeCursor: "补齐" });
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