# AI Prompt Rebuild Plan

## Goal

重构当前 AI prompt 与评估实现，让 description、subtask、comment 三类补全以统一的 suggestion profile 为控制面，同时收紧上下文边界并让运行时与评估共享同一套 contract、profile 和 schema 定义。

## Scope

- 本轮只覆盖 description、subtask、comment。
- labels 保持独立轨道，只同步上下文边界与评估框架，不并入 suggestion profile。
- title 暂不纳入这轮重构，因为它还不在当前运行时字段内。

## Confirmed Decisions

- Prompt 上下文移除 Related Cards；文本补全只使用局部光标上下文、当前 Card，以及保持结果有效所必需的最小板级约束。
- 保留字段级最小交互契约，suggestion profile 只在契约允许的范围内调节输出，不覆盖字段契约。
- “语气控制”改为 suggestion profile 控制；tone 只是 profile 的一部分。
- 第一版 profile 只作内部控制面，不对用户暴露。
- 第一版运行时只保留一个默认 profile。
- 默认 profile 取值为 high brevity、high directness、medium evidence appetite。
- 中等 evidence appetite 允许少量探索性补全，但只能来自当前 Card 明确出现或可直接推出的信息。
- 允许模型输出直接结论式表述，但这些结论必须来自当前 Card 可直接推出的信息，而不是通用场景先验。
- Prompt payload 以结构化字段携带 profile；结构化输出优先使用 provider schema 约束，Prompt 中的 JSON 指令只作为 fallback。
- 产品运行时改为 Ollama only，支持任意 Ollama endpoint，保留 baseUrl + model，移除非 Ollama provider 方向。
- Ollama 继续优先走 native /api/chat，请求中补 `format` schema。
- AI Settings 移除 API key，保留 baseUrl、model、启用开关、Test Connection 和日志入口。
- schema 输出校验失败时直接丢弃结果，不再做 Prompt JSON fallback 重试。
- Test Connection 需要验证结构化输出能力，而不是只测网络连通。

## Evaluation Decisions

- 评估主框架为硬约束统计加 A/B 对比，但当前阶段的结论定位为方向性信号，不作为严格量化上线门槛。
- A/B baseline 固定为当前仓库中的现行 Prompt 快照。
- 报告默认按字段切片展示，而不是只看整体指标。
- reviewer 分项从 style 扩展为 profileFit，并将 groundedness 拆为 evidenceSupport 与 plausibility。
- reviewer 可以把常识用于 usefulness、profileFit、plausibility，不强制隔离同模自评偏差，因此报告只作为方向性信号。
- 评估报告至少记录 git commit 作为追溯锚点。
- 正式报告允许同模自评，也不强制盲评或顺序随机化，因此所有 A/B 指标只解释为方向性信号。

## Fixture Strategy

- 评估继续以合成 cases 为主，不以真实编辑快照为主集。
- 合成 cases 先设计成矩阵，再使用 subagent 生成各部分 case。
- subagent 生成的 fixtures 需要冻结为仓库文件，并经人工审核后再进入正式评估。
- 每个 fixture 保留明确的 expected behavior 与硬约束标注，不要求唯一标准答案。

## Implementation Shape

- 运行时与评估共享同一套 TypeScript 定义：prompt contract、profile、schema、review rubric。
- 规则定义使用 TypeScript 模块承载；fixtures 使用静态 JSON 或等价数据文件承载。
- 当前 suggestion-service 与评估脚本中重复维护的 Prompt 文本和约束需要收口到共享模块。
- 评估脚本从 mjs 收敛到 TypeScript。
- 共享定义归 main 侧 AI 模块，而不是放进 packages/shared。