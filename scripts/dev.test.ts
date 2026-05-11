import { describe, expect, it, vi } from "vitest";
import {
    BUILD_OUTPUTS,
    DEFAULT_RENDERER_DEV_PORT,
    ELECTRON_NATIVE_MODULES,
    buildDevCommands,
    buildElectronRebuildArgs,
    buildWaitOnArgs,
    findAvailablePort,
    getRendererUrl,
    parseRendererPort
} from "./dev.mjs";

describe("dev launcher", () => {
    it("falls back to the default renderer port for invalid input", () => {
        expect(parseRendererPort(undefined)).toBe(DEFAULT_RENDERER_DEV_PORT);
        expect(parseRendererPort("nope")).toBe(DEFAULT_RENDERER_DEV_PORT);
        expect(parseRendererPort("70000")).toBe(DEFAULT_RENDERER_DEV_PORT);
    });

    it("builds renderer commands with the selected port", () => {
        expect(buildDevCommands(5199, true)).toEqual([
            "pnpm --filter @kanban/shared dev",
            "pnpm --filter @kanban/preload dev",
            "pnpm --filter @kanban/main dev",
            "pnpm --filter @kanban/renderer exec vite --port 5199",
            "pnpm dev:electron:wait"
        ]);

        expect(buildDevCommands(5199, false)).toEqual([
            "pnpm --filter @kanban/shared dev",
            "pnpm --filter @kanban/preload dev",
            "pnpm --filter @kanban/main dev",
            "pnpm --filter @kanban/renderer exec vite --port 5199"
        ]);
    });

    it("builds wait-on arguments from the resolved renderer URL", () => {
        expect(buildWaitOnArgs(getRendererUrl(5201))).toEqual(["exec", "wait-on", "http://127.0.0.1:5201", ...BUILD_OUTPUTS]);
    });

    it("builds Electron native rebuild arguments", () => {
        expect(buildElectronRebuildArgs()).toEqual(["exec", "electron-rebuild", "-f", "-w", ELECTRON_NATIVE_MODULES.join(",")]);
    });

    it("picks the next available renderer port when the preferred port is busy", async () => {
        const availabilityCheck = vi
            .fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        await expect(findAvailablePort(5173, "127.0.0.1", 5, availabilityCheck)).resolves.toBe(5175);
        expect(availabilityCheck).toHaveBeenNthCalledWith(1, 5173, "127.0.0.1");
        expect(availabilityCheck).toHaveBeenNthCalledWith(2, 5174, "127.0.0.1");
        expect(availabilityCheck).toHaveBeenNthCalledWith(3, 5175, "127.0.0.1");
    });
});