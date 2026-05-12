import type { PreloadApi } from "@kanban/shared";

export function getApi(): PreloadApi {
  if (!window.api) {
    throw new Error("Kanban preload API is unavailable.");
  }
  return window.api;
}
