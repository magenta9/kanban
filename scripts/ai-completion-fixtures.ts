import type { AiSuggestionCardContext, AiTextSuggestionField, KanbanCard } from "@kanban/shared";

export interface AiCompletionFixture {
    id: string;
    field: AiTextSuggestionField;
    textBeforeCursor: string;
    textAfterCursor: string;
    maxChars: number;
    expectedBehavior: "accept" | "reject";
    blockedInsertions: string[];
    expectedNotes: string;
    context: AiSuggestionCardContext;
}

const now = 1;

export const aiCompletionFixtures: AiCompletionFixture[] = [
    {
        id: "description-paragraph-grounded",
        field: "description",
        textBeforeCursor: "需要分析持有标的的",
        textAfterCursor: "",
        maxChars: 50,
        expectedBehavior: "accept",
        blockedInsertions: ["需要分析持有标的的"],
        expectedNotes: "Continue with grounded attributes such as position, P/L, or risk; do not restate the subject.",
        context: context(card({ title: "持仓复盘", descriptionText: "需要分析持有标的的仓位、盈亏和风险点。" }))
    },
    {
        id: "description-numbered-repeat-reject",
        field: "description",
        textBeforeCursor: "覆盖范围：需要分析持有标的的仓位、盈亏和风险点\n1.需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。\n2.",
        textAfterCursor: "",
        maxChars: 50,
        expectedBehavior: "reject",
        blockedInsertions: ["覆盖范围：需要分析持有标的的仓位、盈亏和风险点", "需要明确分析的具体标的范围、历史数据获取方式以及预期输出格式。"],
        expectedNotes: "Return an empty insert because the previous numbered item already covers scope, data source, and output format.",
        context: context(card({ title: "分析范围", descriptionText: "覆盖范围：需要分析持有标的的仓位、盈亏和风险点" }))
    },
    {
        id: "description-bullet-fragment",
        field: "description",
        textBeforeCursor: "- 补充构建流程的",
        textAfterCursor: "",
        maxChars: 40,
        expectedBehavior: "accept",
        blockedInsertions: ["- 补充构建流程的"],
        expectedNotes: "Return only the missing words after the bullet prefix, not another bullet marker.",
        context: context(card({ title: "构建流程", descriptionText: "需要补充构建流程的关键步骤和验证方式。" }))
    },
    {
        id: "description-complete-sentence-reject",
        field: "description",
        textBeforeCursor: "风险点已经确认。",
        textAfterCursor: "",
        maxChars: 40,
        expectedBehavior: "reject",
        blockedInsertions: ["风险点已经确认。"],
        expectedNotes: "Return empty because the local line already ends with terminal punctuation.",
        context: context(card({ title: "风险确认", descriptionText: "风险点已经确认。" }))
    },
    {
        id: "description-heading-reject",
        field: "description",
        textBeforeCursor: "### 输出格式",
        textAfterCursor: "",
        maxChars: 40,
        expectedBehavior: "reject",
        blockedInsertions: ["### 输出格式"],
        expectedNotes: "Return empty after a heading-only local line.",
        context: context(card({ title: "输出格式", descriptionText: "需要补齐输出格式说明。" }))
    },
    {
        id: "subtask-prefix-fragment",
        field: "subtask",
        textBeforeCursor: "补齐",
        textAfterCursor: "",
        maxChars: 12,
        expectedBehavior: "accept",
        blockedInsertions: ["我会", "补齐发布检查项"],
        expectedNotes: "Return a short actionable fragment such as 验收标准, not a full sentence or promise.",
        context: context(card({
            title: "发布检查项跟进",
            descriptionText: "需要补齐发布检查项和验收标准。",
            subtasks: ["确认发布检查项", "同步测试结果"]
        }))
    },
    {
        id: "subtask-action-continuation",
        field: "subtask",
        textBeforeCursor: "整理接口联调并",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["整理接口联调并"],
        expectedNotes: "Continue with a concrete action directly supported by the current card.",
        context: context(card({ title: "接口联调", descriptionText: "整理接口联调并同步测试结论。", subtasks: ["确认接口返回", "同步测试结论"] }))
    },
    {
        id: "subtask-complete-reject",
        field: "subtask",
        textBeforeCursor: "验收标准已同步。",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "reject",
        blockedInsertions: ["验收标准已同步。"],
        expectedNotes: "Return empty because the subtask title is already complete.",
        context: context(card({ title: "验收标准", descriptionText: "验收标准已同步。", subtasks: ["确认验收标准"] }))
    },
    {
        id: "subtask-no-owner-invention",
        field: "subtask",
        textBeforeCursor: "确认数据口径的",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["张三", "今天", "马上"],
        expectedNotes: "May complete with scope or来源; must not invent dates or owners.",
        context: context(card({ title: "数据口径", descriptionText: "确认数据口径的来源和统计范围。", subtasks: ["整理数据来源"] }))
    },
    {
        id: "subtask-existing-sibling-reject",
        field: "subtask",
        textBeforeCursor: "同步测试结果",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "reject",
        blockedInsertions: ["同步测试结果"],
        expectedNotes: "Return empty rather than duplicating an existing sibling subtask.",
        context: context(card({ title: "回归结果", descriptionText: "需要同步测试结果。", subtasks: ["同步测试结果", "确认回归结论"] }))
    },
    {
        id: "comment-status-update",
        field: "comment",
        textBeforeCursor: "进展 ",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["保证", "马上处理", "已经完成所有"],
        expectedNotes: "Use a concise teammate status update grounded in the card comments.",
        context: context(card({ title: "评论草稿", descriptionText: "需要整理评论草稿。", comments: ["昨天已经同步初稿"] }))
    },
    {
        id: "comment-reply",
        field: "comment",
        textBeforeCursor: "回复 ",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["无需确认", "我保证"],
        expectedNotes: "Sound like a short teammate reply without auto-resolving the task.",
        context: context(card({ title: "设计确认", descriptionText: "等待设计确认。", comments: ["设计稿已补截图"] }))
    },
    {
        id: "comment-action-note",
        field: "comment",
        textBeforeCursor: "下一步 ",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["今天完成", "保证"],
        expectedNotes: "Suggest a grounded next action without promising completion.",
        context: context(card({ title: "文档补齐", descriptionText: "下一步需要补齐文档中的配置说明。", comments: ["配置截图已补充"] }))
    },
    {
        id: "comment-ambiguous-reject",
        field: "comment",
        textBeforeCursor: "嗯",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "reject",
        blockedInsertions: ["收到", "马上处理"],
        expectedNotes: "Return empty because the user intent is ambiguous.",
        context: context(card({ title: "结论同步", descriptionText: "需要同步结论。", comments: ["结论还需要复核"] }))
    },
    {
        id: "comment-no-fact-invention",
        field: "comment",
        textBeforeCursor: "风险 ",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["已解决", "无风险", "上线完成"],
        expectedNotes: "May mention checking risk context, but must not claim resolution or completion.",
        context: context(card({ title: "风险点", descriptionText: "风险点需要继续确认影响范围。", comments: ["还缺影响范围"] }))
    }
];

function context(currentCard: KanbanCard): AiSuggestionCardContext {
    return {
        currentCard,
        relatedCards: [card({ id: `related-${currentCard.id}`, title: "旧相关卡片", descriptionText: "不应进入文本补全上下文。" })],
        boardLabels: [
            { id: "label-1", boardId: "board-1", name: "Dev", color: "#64748b" },
            { id: "label-2", boardId: "board-1", name: "Risk", color: "#ef4444" },
            { id: "label-3", boardId: "board-1", name: "Study", color: "#22c55e" }
        ],
        columnName: "Todo"
    };
}

function card(patch: Partial<KanbanCard> & { subtasks?: string[]; comments?: string[] } = {}): KanbanCard {
    const subtasks = (patch.subtasks ?? []).map((title, index) => ({
        id: `subtask-${index + 1}`,
        title,
        completed: false,
        createdAt: now,
        updatedAt: now
    }));
    const comments = (patch.comments ?? []).map((body, index) => ({
        id: `comment-${index + 1}`,
        body,
        createdAt: now,
        updatedAt: now
    }));
    return {
        id: patch.id ?? "card-1",
        boardId: "board-1",
        columnId: "column-1",
        title: patch.title ?? "AI 补全",
        descriptionText: patch.descriptionText,
        priority: patch.priority ?? "none",
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
        labelIds: patch.labelIds ?? [],
        subtasks,
        comments
    };
}