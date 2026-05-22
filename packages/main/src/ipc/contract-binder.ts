import type { IpcMain } from "electron";
import { ipcChannels } from "@kanban/shared";

export type IpcHandler<TResult = unknown> = (input: any) => Promise<TResult> | TResult;

export function bindInvoke<TResult>(
  ipcMain: IpcMain,
  channel: string,
  handler: IpcHandler<TResult>
): void {
  ipcMain.handle(channel, async (_event, input: unknown) => handler(input));
}

export function allDeclaredInvokeChannels(): string[] {
  return [
    ipcChannels.system.getStatus,
    ...Object.values(ipcChannels.ai),
    ...Object.values(ipcChannels.kanban)
  ];
}
