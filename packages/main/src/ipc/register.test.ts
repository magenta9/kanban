import { describe, expect, it, vi } from "vitest";
import { allIpcInvokeChannels } from "@kanban/shared";
import { registerIpc, type IpcServiceContext } from "./register";

const mocks = vi.hoisted(() => ({
  handle: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/kanban-test"),
    getVersion: vi.fn(() => "0.0.0")
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
  },
  ipcMain: { handle: mocks.handle },
  shell: {
    openPath: vi.fn(async () => "")
  }
}));

function methodProxy(): Record<string, unknown> {
  return new Proxy({}, {
    get: (_target, property) => {
      if (typeof property !== "string") return undefined;
      return vi.fn();
    }
  });
}

describe("registerIpc", () => {
  it("registers every shared invoke channel", () => {
    mocks.handle.mockClear();

    registerIpc({
      kanban: methodProxy(),
      ai: methodProxy(),
      agent: methodProxy()
    } as unknown as IpcServiceContext);

    const channels = mocks.handle.mock.calls.map(([channel]) => channel);

    expect(channels).toEqual(allIpcInvokeChannels());
    expect(channels).toEqual(expect.arrayContaining([
      "agent:list-available",
      "agent:select-repo-path",
      "agent:validate-repo-path",
      "agent:start-run"
    ]));
  });
});
