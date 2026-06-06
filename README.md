# Kanban

一个从 `CodeTool` 拆出的独立 Electron + React 看板应用。

## 开发

```sh
pnpm install
pnpm run dev
```

## 主题

应用默认使用 System 模式，按系统 `prefers-color-scheme` 自动选择浅色/深色主题，并会随系统变化更新。左下角按钮可在 System、Light、Dark 三种模式间循环，并会把选择保存在本地。

## 验证

```sh
pnpm run typecheck
pnpm test
pnpm run build
```
