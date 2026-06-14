import type { IpcMain } from "electron";
import { allIpcInvokeChannels, ipcInvokeChannel, type IpcInvokeHandlerName } from "@kanban/shared";

export type IpcHandler<TResult = unknown> = (input: any) => Promise<TResult> | TResult;

export function bindContractInvoke<TResult>(
  ipcMain: IpcMain,
  handlerName: IpcInvokeHandlerName,
  handler: IpcHandler<TResult>
): void {
  ipcMain.handle(ipcInvokeChannel(handlerName), async (_event, input: unknown) => handler(input));
}

export function allDeclaredInvokeChannels(): string[] {
  return allIpcInvokeChannels();
}
