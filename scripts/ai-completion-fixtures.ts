import type { AiSuggestionCardContext, AiTextSuggestionField, KanbanCard } from "@kanban/shared";

export interface AiCompletionFixture {
    id: string;
    field: AiTextSuggestionField;
    dimensions?: string[];
    textBeforeCursor: string;
    textAfterCursor: string;
    maxChars: number;
    expectedBehavior: "accept" | "reject";
    blockedInsertions: string[];
    idealInsertions?: string[];
    expectedNotes: string;
    context: AiSuggestionCardContext;
}

const now = Date.UTC(2026, 4, 23);
const dayMs = 24 * 60 * 60 * 1000;

export const aiCompletionFixtures: AiCompletionFixture[] = [
    {
        id: "description-paragraph-grounded",
        field: "description",
        textBeforeCursor: "需要分析持有标的的",
        textAfterCursor: "",
        maxChars: 50,
        expectedBehavior: "accept",
        blockedInsertions: ["需要分析持有标的的"],
        idealInsertions: ["仓位、盈亏和风险点"],
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
        idealInsertions: ["关键步骤和验证方式"],
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
        idealInsertions: ["验收标准"],
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
        idealInsertions: ["同步测试结论"],
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
        idealInsertions: ["来源和统计范围"],
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
        idealInsertions: ["配置说明", "补充文档配置说明"],
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
    },
    {
        id: "description-table-cell-middle",
        field: "description",
        dimensions: ["markdown-table", "middle-insert", "structure-preservation"],
        textBeforeCursor: "| 指标 | 当前值 |\n|---|---|\n| 完成率 | ",
        textAfterCursor: " |\n| 风险点 | 待确认 |",
        maxChars: 12,
        expectedBehavior: "accept",
        blockedInsertions: ["| 完成率 |", "待确认", "风险点"],
        idealInsertions: ["85%"],
        expectedNotes: "Complete only the current table cell value, not another row, header, or neighboring risk value.",
        context: context(card({ title: "周报指标", descriptionText: "| 指标 | 当前值 |\n|---|---|\n| 完成率 | 85% |\n| 风险点 | 待确认 |" }))
    },
    {
        id: "description-code-block-value",
        field: "description",
        dimensions: ["markdown-code", "middle-insert", "syntax-boundary"],
        textBeforeCursor: "配置示例：\n```json\n{\n  \"timeout\": ",
        textAfterCursor: ",\n  \"retry\": 3\n}\n```",
        maxChars: 8,
        expectedBehavior: "accept",
        blockedInsertions: ["timeout", "retry", "```"],
        idealInsertions: ["30000"],
        expectedNotes: "Complete the JSON value only; do not repeat the property name, retry field, or code fence.",
        context: context(card({ title: "接口配置", descriptionText: "配置示例需要设置 timeout 为 30000，并保留 retry 为 3。" }))
    },
    {
        id: "description-long-context-target-metric",
        field: "description",
        dimensions: ["long-context", "maxchars-pressure", "middle-insert", "card-detail-context"],
        textBeforeCursor: "### 背景\n\n当前系统在高并发场景下存在性能瓶颈，主要体现在数据库连接池耗尽、缓存命中率低、API响应时间超过3秒。需要从架构层面进行优化，包括引入分布式缓存、数据库读写分离、异步消息队列、热点数据预热、批量写入降噪以及慢查询治理。\n\n### 目标\n\n优化后需要达到",
        textAfterCursor: "的性能指标。",
        maxChars: 18,
        expectedBehavior: "accept",
        blockedInsertions: ["当前系统", "性能瓶颈", "分布式缓存", "数据库读写分离"],
        expectedNotes: "Use the target metric from the card and stay within maxChars; do not summarize the long background.",
        context: context(card({
            title: "性能优化",
            descriptionText: "优化后需要达到 P95<800ms 的性能指标，且错误率保持在 0.1% 以下。",
            priority: "urgent",
            labelIds: ["label-1", "label-2"],
            startDate: now - dayMs,
            dueDate: now + 2 * dayMs,
            subtasks: [{ title: "压测数据库连接池", completed: true }, "补齐缓存命中率数据"]
        }))
    },
    {
        id: "description-stale-comment-conflict",
        field: "description",
        dimensions: ["conflicting-context", "stale-comment", "evidence-priority", "card-detail-context"],
        textBeforeCursor: "最新方案：采用",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["Redis缓存", "之前讨论", "最新方案：采用"],
        expectedNotes: "Prefer the current description's latest plan and ignore stale comments that mention Redis as the primary choice.",
        context: context(card({
            title: "缓存方案",
            descriptionText: "最新方案：采用本地内存缓存，保留Redis作为降级选项。",
            priority: "high",
            labelIds: ["label-1", "label-2"],
            dueDate: now + dayMs,
            comments: ["之前讨论过用Redis缓存作为主方案", "新方案已经改成本地内存优先"]
        }))
    },
    {
        id: "description-saturated-list-reject",
        field: "description",
        dimensions: ["semantic-duplicate", "list-saturation", "reject"],
        textBeforeCursor: "优化要点：\n1. 缩短API响应时间\n2. 提升缓存命中率\n3. 降低数据库查询延迟\n4.",
        textAfterCursor: "",
        maxChars: 40,
        expectedBehavior: "reject",
        blockedInsertions: ["缩短API响应时间", "提升缓存命中率", "降低数据库查询延迟", "优化系统性能", "改善用户体验"],
        expectedNotes: "Return empty because another list item would likely paraphrase the already covered performance goals.",
        context: context(card({ title: "性能优化", descriptionText: "优化要点已经覆盖响应时间、缓存命中率和数据库查询延迟。" }))
    },
    {
        id: "subtask-middle-source-insert",
        field: "subtask",
        dimensions: ["middle-insert", "two-sided-cursor", "short-fragment"],
        textBeforeCursor: "确认数据",
        textAfterCursor: "和格式",
        maxChars: 8,
        expectedBehavior: "accept",
        blockedInsertions: ["确认数据", "和格式", "确认数据来源和格式"],
        idealInsertions: ["来源"],
        expectedNotes: "Insert only the missing noun between the existing prefix and suffix.",
        context: context(card({ title: "数据交付", descriptionText: "确认数据来源和格式，避免下游解析失败。", subtasks: ["整理字段映射", "确认数据来源和格式"] }))
    },
    {
        id: "subtask-short-maxchars-long-context",
        field: "subtask",
        dimensions: ["long-context", "maxchars-pressure", "short-fragment", "card-detail-context"],
        textBeforeCursor: "整理",
        textAfterCursor: "",
        maxChars: 6,
        expectedBehavior: "accept",
        blockedInsertions: ["整理测试用例并同步给团队", "我会整理", "同步给团队"],
        idealInsertions: ["用例", "测试用例"],
        expectedNotes: "Use a compact noun phrase under a very small maxChars budget instead of a full action sentence.",
        context: context(card({
            title: "测试准备",
            descriptionText: "本轮测试准备需要整理测试用例并同步给团队，同时保留边界条件、异常路径和回归范围说明。",
            priority: "medium",
            labelIds: ["label-1"],
            startDate: now,
            endDate: now + 3 * dayMs,
            subtasks: [{ title: "确认测试环境", completed: true }, "同步回归范围"]
        }))
    },
    {
        id: "subtask-bilingual-project-term",
        field: "subtask",
        dimensions: ["bilingual", "project-term", "language-consistency"],
        textBeforeCursor: "Update the sprint ",
        textAfterCursor: "",
        maxChars: 20,
        expectedBehavior: "accept",
        blockedInsertions: ["Update the sprint", "迭代计划", "新需求"],
        expectedNotes: "Complete the English project-management phrase from the mixed-language card context.",
        context: context(card({ title: "迭代计划", descriptionText: "Update the sprint backlog with new requirements before planning starts.", subtasks: ["同步需求变更", "确认排期"] }))
    },
    {
        id: "subtask-partial-sibling-reject",
        field: "subtask",
        dimensions: ["semantic-duplicate", "partial-sibling", "reject"],
        textBeforeCursor: "同步测试",
        textAfterCursor: "",
        maxChars: 12,
        expectedBehavior: "reject",
        blockedInsertions: ["同步测试结果", "同步测试报告", "测试结果"],
        expectedNotes: "Return empty because the prefix would duplicate an existing sibling subtask.",
        context: context(card({ title: "回归同步", descriptionText: "需要同步测试结果并确认回归结论。", subtasks: ["编写测试用例", "同步测试结果", "确认回归结论"] }))
    },
    {
        id: "subtask-conflicting-related-card",
        field: "subtask",
        dimensions: ["conflicting-context", "current-card-priority", "short-fragment"],
        textBeforeCursor: "补齐接口",
        textAfterCursor: "",
        maxChars: 16,
        expectedBehavior: "accept",
        blockedInsertions: ["旧接口迁移说明", "老版本", "补齐接口"],
        expectedNotes: "Use the current card's API documentation need instead of stale related-card wording.",
        context: context(card({ title: "接口文档", descriptionText: "补齐接口鉴权参数和错误码说明。", subtasks: ["整理鉴权参数"] }))
    },
    {
        id: "comment-bilingual-status-short",
        field: "comment",
        dimensions: ["bilingual", "maxchars-pressure", "status"],
        textBeforeCursor: "Sync update: ",
        textAfterCursor: "",
        maxChars: 16,
        expectedBehavior: "accept",
        blockedInsertions: ["我保证", "马上完成", "already fixed all", "已经解决所有"],
        expectedNotes: "Complete a short mixed-language status grounded in comments without promising future work.",
        context: context(card({ title: "接口联调", descriptionText: "API 接口已对齐，还需要同步测试结论。", comments: ["API接口已对齐"] }))
    },
    {
        id: "comment-reply-stale-thread",
        field: "comment",
        dimensions: ["stale-comment", "reply", "temporal-context"],
        textBeforeCursor: "回复 ",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["设计稿已确认", "无需修改", "我保证", "马上处理"],
        idealInsertions: ["等待补充截图后再确认。", "等待补充截图后再确认"],
        expectedNotes: "Reply to the latest thread state without treating older comments as the current truth.",
        context: context(card({ title: "设计确认", descriptionText: "等待补充截图后再确认。", comments: ["设计稿需要修改", "已修改完成", "截图已补充"] }))
    },
    {
        id: "comment-middle-multiparagraph",
        field: "comment",
        dimensions: ["middle-insert", "multi-paragraph", "two-sided-cursor"],
        textBeforeCursor: "初步结论：方案可行。\n\n待确认：",
        textAfterCursor: "\n\n下一步：同步团队。",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["初步结论：方案可行", "下一步：同步团队", "同步团队"],
        expectedNotes: "Fill only the pending confirmation line between two existing paragraphs.",
        context: context(card({ title: "方案评审", descriptionText: "方案评审还需要确认数据口径和影响范围。", comments: ["数据口径需要二次确认"] }))
    },
    {
        id: "comment-decision-recap-with-risk",
        field: "comment",
        dimensions: ["decision-recap", "unsupported-claim", "risk", "card-detail-context"],
        textBeforeCursor: "结论 ",
        textAfterCursor: "",
        maxChars: 28,
        expectedBehavior: "accept",
        blockedInsertions: ["已上线", "风险已解除", "全部通过", "无需复核"],
        expectedNotes: "Recap the tentative decision without inventing completion, launch, or risk resolution.",
        context: context(card({
            title: "风险评审",
            descriptionText: "当前结论倾向继续推进，但风险影响范围还要复核。",
            priority: "high",
            labelIds: ["label-2"],
            dueDate: now + dayMs,
            recurrence: { seriesId: "series-1", trigger: "completion", cycle: "weekly", status: "active" },
            comments: ["可以继续推进", "影响范围还没最终确认"]
        }))
    },
    {
        id: "comment-ambiguous-multiline-reject",
        field: "comment",
        dimensions: ["ambiguous-intent", "multi-paragraph", "reject"],
        textBeforeCursor: "备注：\n嗯",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "reject",
        blockedInsertions: ["收到", "马上处理", "我来跟进"],
        expectedNotes: "Return empty because the local comment intent remains ambiguous even with surrounding context.",
        context: context(card({ title: "结论同步", descriptionText: "需要同步结论。", comments: ["结论还需要复核", "等产品确认"] }))
    },
    {
        id: "description-detail-risk-before-due-date",
        field: "description",
        dimensions: ["card-detail-context", "due-date", "labels", "completed-subtasks"],
        textBeforeCursor: "上线前需要确认",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["联调已完成", "明天上线", "上线前需要确认"],
        expectedNotes: "Use risk/priority/detail context to complete a pre-launch check, but do not claim launch or repeat completed subtasks.",
        context: context(card({
            title: "支付链路上线",
            descriptionText: "上线前需要确认回滚方案和风控开关。",
            priority: "urgent",
            labelIds: ["label-2"],
            dueDate: now + dayMs,
            subtasks: [{ title: "联调已完成", completed: true }, "确认回滚方案"],
            comments: ["风控开关还需要二次确认"]
        }))
    },
    {
        id: "description-detail-recurrence-blocked-reject",
        field: "description",
        dimensions: ["card-detail-context", "recurrence", "reject", "blocked-state"],
        textBeforeCursor: "本次巡检已暂停。",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "reject",
        blockedInsertions: ["继续生成下次巡检", "恢复巡检", "每天执行"],
        expectedNotes: "Return empty because the sentence is complete and the recurrence is blocked; do not suggest resuming the series.",
        context: context(card({
            title: "每日巡检",
            descriptionText: "本次巡检已暂停。复发规则因为权限缺失被阻塞。",
            priority: "medium",
            labelIds: ["label-2"],
            recurrence: { seriesId: "series-blocked", trigger: "fixed", cycle: "daily", status: "blocked", blockedReason: "缺少巡检权限" },
            comments: ["等权限恢复后再处理"]
        }))
    },
    {
        id: "subtask-detail-skip-completed",
        field: "subtask",
        dimensions: ["card-detail-context", "completed-subtasks", "short-fragment"],
        textBeforeCursor: "确认",
        textAfterCursor: "",
        maxChars: 12,
        expectedBehavior: "accept",
        blockedInsertions: ["联调结果", "确认联调结果", "已完成"],
        expectedNotes: "Complete with the remaining risk check, not the already completed integration result.",
        context: context(card({
            title: "支付链路上线",
            descriptionText: "联调结果已经确认，剩余风险开关需要确认。",
            priority: "urgent",
            labelIds: ["label-2"],
            dueDate: now + dayMs,
            subtasks: [{ title: "确认联调结果", completed: true }, "同步上线窗口"]
        }))
    },
    {
        id: "subtask-detail-recurrence-weekly",
        field: "subtask",
        dimensions: ["card-detail-context", "recurrence", "project-term"],
        textBeforeCursor: "整理本周",
        textAfterCursor: "",
        maxChars: 14,
        expectedBehavior: "accept",
        blockedInsertions: ["每日巡检", "下周", "整理本周"],
        expectedNotes: "Use the active weekly recurrence and current card description to complete the weekly summary task.",
        context: context(card({
            title: "周报复盘",
            descriptionText: "整理本周风险项和处理结论，作为周会材料。",
            priority: "medium",
            labelIds: ["label-2", "label-3"],
            recurrence: { seriesId: "series-weekly", trigger: "fixed", cycle: "weekly", status: "active" },
            subtasks: ["汇总风险项", "同步处理结论"]
        }))
    },
    {
        id: "comment-detail-due-today-status",
        field: "comment",
        dimensions: ["card-detail-context", "due-date", "status", "completed-subtasks"],
        textBeforeCursor: "今天 ",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["全部完成", "保证上线", "无需复核"],
        expectedNotes: "Use today's due date and completed subtasks for a grounded status without overclaiming completion.",
        context: context(card({
            title: "支付链路上线",
            descriptionText: "今天需要完成上线前风险复核。",
            priority: "urgent",
            labelIds: ["label-2"],
            dueDate: now,
            subtasks: [{ title: "联调已完成", completed: true }, "风险复核"],
            comments: ["联调已经通过", "风险复核还在进行"]
        }))
    },
    {
        id: "comment-detail-recurrence-blocked-reply",
        field: "comment",
        dimensions: ["card-detail-context", "recurrence", "reply", "blocked-state"],
        textBeforeCursor: "回复 ",
        textAfterCursor: "",
        maxChars: 24,
        expectedBehavior: "accept",
        blockedInsertions: ["已经恢复", "继续自动生成", "无需处理"],
        expectedNotes: "Reply using the blocked recurrence state without claiming the recurring workflow has resumed.",
        context: context(card({
            title: "每日巡检",
            descriptionText: "复发任务因权限缺失暂时阻塞。",
            priority: "high",
            labelIds: ["label-2"],
            recurrence: { seriesId: "series-blocked", trigger: "fixed", cycle: "daily", status: "blocked", blockedReason: "缺少巡检权限" },
            comments: ["今天的巡检没有自动生成", "需要先恢复权限"]
        }))
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

function card(patch: Partial<Omit<KanbanCard, "subtasks" | "comments">> & { subtasks?: Array<string | { title: string; completed?: boolean }>; comments?: string[] } = {}): KanbanCard {
    const subtasks = (patch.subtasks ?? []).map((subtask, index) => ({
        id: `subtask-${index + 1}`,
        title: typeof subtask === "string" ? subtask : subtask.title,
        completed: typeof subtask === "string" ? false : subtask.completed ?? false,
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