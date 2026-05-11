import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["packages/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.{test,spec}.{ts,tsx,js,mjs}"]
  },
  resolve: {
    alias: {
      "@kanban/shared": "/Users/zhang/code/ai/kanban/packages/shared/src/index.ts"
    }
  }
});
