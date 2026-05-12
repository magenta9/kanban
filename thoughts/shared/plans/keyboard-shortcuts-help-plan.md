# Keyboard Shortcuts and Help Plan

## Goal

为当前 Kanban 桌面应用补齐第一版必要快捷键，并提供对应的 Help 面板。Help 入口使用 macOS 原生系统菜单栏中的 Help 下拉项，同时保留键盘快捷键打开。

## Confirmed Decisions

- 平台范围：先支持 macOS。
- Help 形态：应用内弹层/面板，不作为 Kanban/List/Archive 的新视图，也不新增路由。
- Help 入口：原生 Electron 菜单栏 `Help > Keyboard Shortcuts`。
- Help 打开快捷键：`Cmd+/`。
- Board 切换：`Cmd+1` 到 `Cmd+9` 按左侧 board 列表当前顺序切换第 1 到第 9 个 board；超出范围无动作。
- 视图切换：`Cmd+K` 切换 Kanban，`Cmd+L` 切换 List，`Cmd+A` 切换 Archive。
- 侧栏：`Cmd+B` 折叠或展开左侧 board 列表。
- 新建卡片：`Cmd+N` 打开新建卡片输入框。
- 新建卡片位置：上下文优先；如果卡片详情已打开，则在该卡片所在列打开 composer；否则保留当前已打开 composer；都没有时打开第一个可见列。
- 新建列：`Cmd+Shift+N` 打开新建列弹窗。
- 关闭：`Esc` 关闭 Help 面板、普通弹窗、确认弹窗或卡片详情。
- 不做删除快捷键。
- 不做归档快捷键。
- 输入态触发规则：用户正在输入普通 input、textarea 或富文本内容时，只允许 `Esc` 和 `Cmd+/` 生效；其他全局快捷键不触发。
- Help 内容：快捷键列表 + 简短使用说明。
- 使用说明粒度：短句主题说明：切换 board、切换视图、创建卡片/列、编辑卡片详情、整理/拖拽卡片。

## Current Code Facts

- 渲染端核心实现集中在 `packages/renderer/src/tools/kanban/kanban.tsx`。
- 现有快捷键只有 dnd-kit 的 `KeyboardSensor` 和卡片详情中的 `Escape` 关闭逻辑。
- 当前没有 Help 页面或 Help 组件。
- 主进程 `packages/main/src/index.ts` 已经在 macOS 下配置原生菜单，但模板只包含 App/Edit/View/Window，尚未包含 Help。
- preload 当前只通过 `contextBridge.exposeInMainWorld("api", api)` 暴露 invoke 型 API；菜单点击要打开 renderer 面板，需要补一个很小的 renderer 事件订阅能力。

## Proposed Implementation

1. 定义快捷键元数据
   - 在 renderer 侧新增一个本地快捷键定义常量，作为 Help 面板展示和快捷键处理的共同来源。
   - 字段建议包含：`id`、`keys`、`title`、`description`、`group`。

2. 增加 Help 面板状态与组件
   - 在 `KanbanPage` 中增加 `helpOpen` 状态。
   - 新增 `KeyboardShortcutsHelp` 组件，复用现有 dialog/backdrop 视觉语言。
   - 面板内容包含快捷键分组和短句使用说明。
   - `Esc` 可关闭 Help 面板。

3. 增加 renderer 全局快捷键处理
   - 在 `KanbanPage` 中增加一个 `window.keydown` effect。
   - 实现输入态判断：普通输入框、textarea、select、contenteditable、TipTap 编辑区域内，不触发除 `Esc` 和 `Cmd+/` 以外的快捷键。
   - `Cmd+/`：打开 Help 面板。
   - `Cmd+1...9`：选择左侧列表对应 board。
   - `Cmd+K/L/A`：分别切换 Kanban/List/Archive。
   - `Cmd+B`：切换 `boardListCollapsed`。
   - `Cmd+N`：按确认规则打开卡片 composer，并聚焦输入框。
   - `Cmd+Shift+N`：调用现有 `createColumn()`。
   - `Esc`：按优先级关闭 Help、text dialog、confirm dialog、card details。

4. 调整新建卡片 composer 聚焦
   - 给 composer 输入框增加 ref 或轻量 focus token。
   - `Cmd+N` 打开 composer 后聚焦标题输入框。
   - 如果当前没有可见列，快捷键无动作。

5. 增加 macOS Help 原生菜单
   - 在 `packages/main/src/index.ts` 的菜单模板中加入 `{ role: "help", submenu: [...] }`。
   - 菜单项建议：`Keyboard Shortcuts`，accelerator 为 `CommandOrControl+/`。
   - 点击菜单项时通过 `mainWindow?.webContents.send(...)` 通知 renderer 打开 Help 面板。

6. 暴露菜单事件到 renderer
   - 在 shared 层新增只读事件 channel，例如 `app:show-keyboard-shortcuts`。
   - preload 增加订阅方法，例如 `system.onShowKeyboardShortcuts(callback)`，返回 unsubscribe。
   - renderer 在 `KanbanPage` 初始化时订阅该事件并打开 Help 面板。

7. 测试
   - 为快捷键匹配和输入态判断抽出纯函数，使用 Vitest 覆盖。
   - 覆盖用例：`Cmd+/`、`Cmd+1...9`、`Cmd+K/L/A`、`Cmd+B`、`Cmd+N`、`Cmd+Shift+N`、输入态屏蔽规则、输入态允许 `Esc` 和 `Cmd+/`。
   - 保留现有 rich text editor 测试。

## Non-Goals

- 不实现完整命令面板。
- 不实现搜索。
- 不实现卡片键盘导航或焦点列系统。
- 不实现删除快捷键。
- 不实现归档快捷键。
- 不扩展 Windows/Linux 原生菜单。
- 不把 Help 做成独立路由或新主视图。

## Open Implementation Notes

- `Cmd+N` 在 macOS 中常见含义是新建文档。当前需求明确指定为新建卡片，因此实现时应在 Help 面板里写清楚上下文。
- `Cmd+1...9` 按当前 board 列表顺序工作；如果后续加入 board 搜索、排序或隐藏列表，需要重新确认编号映射。
- 原生菜单项和 renderer 快捷键都打开同一个 Help 面板，避免双实现。
