import type { IpcContract } from "@kanban/shared";

export function getApi(): IpcContract {
  if (!window.api) {
    throw new Error("Kanban preload API is unavailable.");
  }
  return window.api;
}
