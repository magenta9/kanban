# Kanban

一个从 `CodeTool` 拆出的独立 Electron + React 看板应用。

## 开发

```sh
pnpm install
pnpm run dev
```

## 主题

应用首次打开会按系统 `prefers-color-scheme` 选择浅色/深色主题；左下角的太阳/月亮按钮可手动切换，并会把选择保存在本地。

## 验证

```sh
pnpm run typecheck
pnpm test
pnpm run build
```
