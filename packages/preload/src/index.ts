import { contextBridge } from "electron";
import { api } from "./api";

contextBridge.exposeInMainWorld("api", api);

declare global {
  interface Window {
    api: typeof api;
  }
}
