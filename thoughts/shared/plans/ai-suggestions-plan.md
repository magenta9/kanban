# AI Suggestions Plan

## Goal

为当前 Kanban 桌面应用加入第一版 AI suggestions：Card title 内联补全、Description/Comment Markdown 片段补全，以及 Add Tags 时的 Label 建议。建议只作为候选出现，用户明确接受后才写入。

## Confirmed Decisions

- 领域语言：数据模型与代码内使用 `Label`；UI 可继续显示 `Tags`。
- AI 来源：用户配置 OpenAI-compatible chat API。
- 密钥存储：API key 只在主进程侧处理，使用 Electron `safeStorage` 加密后存到 `userData` 配置文件；base URL/model 可明文存储。
- Settings：新增 AI Settings 面板，只从菜单栏 Help/Settings 打开。
- Settings 字段：base URL、model、API key、启用开关、Test Connection、日志文件入口。
- 总开关：配置了 Model API 后默认启用；第一版不做分场景开关。
- 未配置体验：输入区静默无补全，Settings 显示未配置状态。
- 错误体验：输入区静默失败，Settings 可查看最近错误摘要，并提供日志文件入口。
- 日志内容：不记录 prompt/context 正文，只记录元数据、状态码、耗时、字段类型和错误。
- 补全触发：输入停顿 500ms 后触发。
- 最少输入长度：Card title 2 字；Description/Comment 5 字。
- 旧请求处理：用户继续输入或移动光标后，旧请求取消或忽略。
- 超时：单次补全 6 秒超时，超时静默放弃并写日志。
- 流式：第一版不做 streaming，完整建议返回后再显示。
- 接受方式：建议可见时 Tab 接受；无建议时保留原生 Tab 行为。
- 取消方式：Esc 不处理建议；继续输入或切换光标时建议消失。
- 保存时机：接受补全只改变当前输入内容；Card title/Description 沿用自动保存，Comment 仍需 Add comment/Enter 提交。
- 标题范围：只覆盖 Card title 和新建 Card 标题输入框，不覆盖 Board/Column 命名。
- 标题建议：15 字以内；保守但可利用当前/相关 Cards 推断，所有推断必须有上下文支持。
- Description/Comment 建议：短 Completion Fragment，50 字以内，可包含 Markdown 和列表。
- Markdown：Description 和 Comment 都按 Markdown 字符串处理；textarea 编辑，显示时渲染 Markdown。
- Markdown 安全：渲染时不允许原始 HTML。
- Description 迁移：当前未生产，不做复杂兼容迁移，按 Markdown 处理。
- Comment 模型：保存 Markdown 字符串，不保存 rich text JSON。
- 任意光标位置：Description/Comment 在任意光标位置都可补全；AI 看到光标前后文，但只生成要插入的片段。
- 模型参数：temperature 固定为 0.2；第一版不暴露高级配置、custom headers、proxy、max tokens。
- 当前 Card AI 上下文：当前输入文本、当前 Card 的完整信息、Board Labels、Related Cards。
- Comments：所有场景都可发送当前 Card 的 Comments。
- Related Cards：active Cards only；最多 20 张，按 `updatedAt` 最近优先。
- Related Cards 选择：当前 Card 有 Labels 时，选择共享至少一个 Label 的 Cards；当前 Card 无 Labels 时，退回整个 Board 最近 20 张 active Cards。
- Related Cards 信息粒度：发送完整 card information，包括 Comments 和 Subtasks。
- Draft Card 上下文：新建 Card 标题使用 Board Labels + 当前 Column 最近 20 张 active Cards。
- Label 建议：点击 Add Tags 时展示，最多 5 个；已有 Labels 优先，也可建议新 Label。
- Label 接受：点击即附加；已有 Label 直接关联，新 Label 先创建再关联。
- Label 失败回退：建议为空或失败时，仍保留手动输入。
- Label 去重：按大小写/空白归一后复用已有 Label。
- 已附加 Label：从建议列表中排除。
- Label 颜色：AI 只给名称；本地决定颜色。同一 Board 内同名 Label 使用 boardId 加盐后保持稳定颜色。

## Current Code Facts

- 核心 UI 在 `packages/renderer/src/tools/kanban/kanban.tsx`。
- 当前 `KanbanCard` 有 `descriptionJson`、`descriptionText`、`comments: KanbanComment[]`；`KanbanComment` 只有 `body: string`。
- 当前 Description 和 Comment 草稿都使用 Tiptap `RichTextEditor`；Description 持久化 JSON，Comment 提交后只保存纯文本 body。
- 当前 Add Tags 入口在 `CardDetails` 中，使用 `tagEditorOpen` 和 `tagDraft`，新 Label 通过 `createLabel` 后 `setCardLabels` 关联。
- `createAndAttachLabel` 现在用 `randomLabelColor(labels.length)`，不是按名称稳定取色。
- IPC contract 当前只有 kanban CRUD/export/import，没有 AI settings、AI suggestion、日志或文件打开相关 API。
- 主进程已有 Electron 菜单能力，并已为快捷键帮助增加 renderer event 通道，可沿用同类模式打开 AI Settings。
- 当前没有 `CONTEXT.md`，本次已新增根目录 glossary。
- 本次已新增 ADR：`docs/adr/0002-openai-compatible-ai-settings.md`。

## Proposed Implementation

1. 调整领域类型与存储模型
   - 将 Card description 的持久模型从 rich text JSON 转为 Markdown 字符串。
   - 将 Comment 明确为 Markdown 字符串。
   - 保留必要的 plain text 派生字段用于卡片摘要展示和搜索式上下文构建。
   - 更新 shared types、repository serialization、import/export、相关测试。

2. 替换 Description/Comment 编辑器
   - 移除这些字段对 Tiptap 的依赖，改为 textarea Markdown 编辑。
   - Description 自动保存 Markdown 字符串。
   - Comment draft 保存 Markdown 字符串，提交后渲染为 Markdown。
   - 引入安全 Markdown renderer，禁用或转义 raw HTML。

3. 增加 AI settings 与 secret storage
   - shared IPC 增加 AI settings contract：读取状态、保存配置、测试连接、打开日志文件。
   - main 侧新增 AI settings service：`safeStorage` 加密/解密 API key，配置文件写入 `userData`。
   - renderer 增加 AI Settings 面板，由菜单栏 Help/Settings 打开。
   - Settings 展示启用状态、最近错误摘要、Test Connection、日志入口。

4. 增加 AI suggestion service
   - main 侧实现 OpenAI-compatible `/v1/chat/completions` 请求。
   - renderer 不直接持有 API key，只通过 IPC 请求 suggestion。
   - 请求超时 6 秒，旧请求用 request id/AbortController 取消或忽略。
   - 输出校验：标题 15 字以内；Description/Comment 50 字以内；超限重试一次，仍超限则不显示。
   - 不缓存未接受建议，不在日志记录正文。

5. 构建 AI 上下文
   - 当前 Card：发送完整 card information，包括 Comments/Subtasks/Labels/Column/Priority/Dates/Description。
   - Related Cards：active only，最多 20 张，最近更新优先；有 Labels 时按共享 Label 选取，无 Labels 时按 Board 最近 active Cards 选取。
   - Draft Card：使用 Board Labels + 当前 Column 最近 20 张 active Cards。
   - Label 建议：同样使用当前 Card、Board Labels、Related Cards。
   - 所有 card/user content 在 prompt 中作为 data 处理，不作为 system/developer 指令。

6. 实现内联补全 UI
   - Card title input 和 new card composer input 支持 ghost text。
   - Markdown textarea 支持任意光标位置 ghost text；发送 cursor 前后文，接受时只在光标处插入片段。
   - Tab 仅在建议可见时接受；继续输入或移动光标时建议消失。
   - 不显示 loading，不处理 Esc。

7. 实现 Label suggestions UI
   - Add Tags 打开后保留手动输入，同时展示最多 5 个建议。
   - 建议包含已有 Label 和新 Label；排除已附加 Label。
   - 点击已有 Label 直接关联；点击新 Label 先创建再关联。
   - 新 Label 颜色使用 boardId + normalized name 的稳定哈希映射到现有色板。

8. 测试与验证
   - 单元测试：上下文选取、Related Cards fallback、字数校验与重试、旧请求失效、Label 去重与颜色稳定、Markdown HTML 禁用。
   - Repository tests：Description/Comment Markdown 持久化、导入导出、Label 去重相关行为。
   - Renderer tests：Tab 接受、无建议时 Tab 原生行为、任意光标位置插入、Label suggestions 点击行为。
   - 运行 `pnpm run typecheck`、`pnpm test`，必要时运行 build。

## Non-Goals

- 不实现 streaming completion。
- 不实现分场景 AI 开关。
- 不暴露 temperature/max tokens/custom headers/proxy。
- 不记录 prompt/context 正文到日志。
- 不支持原始 HTML Markdown 渲染。
- 不自动写入 AI 建议。
- 不覆盖 Board/Column 命名补全。

## Open Implementation Notes

- Markdown renderer 需要选一个安全默认的库，并确认 raw HTML 默认不渲染。
- Description 从 rich text JSON 改为 Markdown 会删除当前 Tiptap 相关测试或改写为 Markdown editor 测试。
- 如果未来要支持本地 Ollama，只要它暴露 OpenAI-compatible endpoint，应复用同一配置模型。