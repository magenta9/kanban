import { describe, expect, it } from "vitest";
import { allIpcInvokeChannels, ipcContractHandlers, ipcInvokeRegistry } from ".";

describe("ipc invoke registry", () => {
  it("lists every declared invoke channel once", () => {
    const channels = allIpcInvokeChannels();

    expect(channels).toEqual(Object.values(ipcInvokeRegistry));
    expect(channels).toHaveLength(ipcContractHandlers.length);
    expect(new Set(channels).size).toBe(channels.length);
  });

  it("includes Agent Run invoke channels", () => {
    expect(allIpcInvokeChannels()).toEqual(expect.arrayContaining([
      "agent:list-available",
      "agent:select-repo-path",
      "agent:validate-repo-path",
      "agent:start-run"
    ]));
  });
});
