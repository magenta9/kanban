import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";

export const DEFAULT_RENDERER_DEV_HOST = "127.0.0.1";
export const DEFAULT_RENDERER_DEV_PORT = 5173;
export const DEFAULT_PORT_SEARCH_LIMIT = 25;
export const BUILD_OUTPUTS = [
    "packages/shared/dist/index.js",
    "packages/preload/dist/index.js",
    "packages/main/dist/index.js"
];
export const ELECTRON_NATIVE_MODULES = ["better-sqlite3"];

export function parseRendererPort(value) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return DEFAULT_RENDERER_DEV_PORT;
    }

    return parsed;
}

export function getRendererUrl(port, host = DEFAULT_RENDERER_DEV_HOST) {
    return `http://${host}:${port}`;
}

export function buildDevCommands(port, includeElectron = true) {
    const commands = [
        "pnpm --filter @kanban/shared dev",
        "pnpm --filter @kanban/preload dev",
        "pnpm --filter @kanban/main dev",
        `pnpm --filter @kanban/renderer exec vite --port ${port}`
    ];

    if (includeElectron) {
        commands.push("pnpm dev:electron:wait");
    }

    return commands;
}

export function buildWaitOnArgs(rendererUrl) {
    return ["exec", "wait-on", rendererUrl, ...BUILD_OUTPUTS];
}

export function buildElectronRebuildArgs() {
    return ["exec", "electron-rebuild", "-f", "-w", ELECTRON_NATIVE_MODULES.join(",")];
}

export async function isPortAvailable(port, host = DEFAULT_RENDERER_DEV_HOST) {
    return await new Promise((resolve) => {
        const server = createServer();
        server.unref();
        server.once("error", () => {
            resolve(false);
        });
        server.once("listening", () => {
            server.close((error) => {
                resolve(!error);
            });
        });
        server.listen(port, host);
    });
}

export async function findAvailablePort(
    startPort,
    host = DEFAULT_RENDERER_DEV_HOST,
    maxAttempts = DEFAULT_PORT_SEARCH_LIMIT,
    availabilityCheck = isPortAvailable
) {
    for (let candidate = startPort; candidate < startPort + maxAttempts; candidate += 1) {
        if (await availabilityCheck(candidate, host)) {
            return candidate;
        }
    }

    throw new Error(
        `Unable to find an open renderer dev port between ${startPort} and ${startPort + maxAttempts - 1}.`
    );
}

export async function runPnpm(args, env = process.env) {
    return await new Promise((resolve, reject) => {
        const child = spawn("pnpm", args, {
            stdio: "inherit",
            env
        });

        const forwardSignal = (signal) => {
            if (!child.killed) {
                child.kill(signal);
            }
        };
        const cleanup = () => {
            process.off("SIGINT", forwardSignal);
            process.off("SIGTERM", forwardSignal);
        };

        process.on("SIGINT", forwardSignal);
        process.on("SIGTERM", forwardSignal);

        child.once("error", (error) => {
            cleanup();
            reject(error);
        });

        child.once("exit", (code, signal) => {
            cleanup();
            resolve({ code, signal });
        });
    });
}

function applyProcessResult({ code, signal }) {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
}

async function runElectronWhenReady(env) {
    const requestedPort = parseRendererPort(env.KANBAN_RENDERER_PORT);
    const rendererUrl = env.KANBAN_RENDERER_URL ?? getRendererUrl(requestedPort);
    const waitResult = await runPnpm(buildWaitOnArgs(rendererUrl), {
        ...env,
        KANBAN_RENDERER_URL: rendererUrl,
        KANBAN_RENDERER_PORT: String(requestedPort)
    });

    if (waitResult.code !== 0 || waitResult.signal) {
        applyProcessResult(waitResult);
        return;
    }

    process.stdout.write("Rebuilding native modules for Electron...\n");
    const rebuildResult = await runPnpm(buildElectronRebuildArgs(), env);
    if (rebuildResult.code !== 0 || rebuildResult.signal) {
        applyProcessResult(rebuildResult);
        return;
    }

    const electronResult = await runPnpm(["dev:electron"], {
        ...env,
        KANBAN_RENDERER_URL: rendererUrl,
        KANBAN_RENDERER_PORT: String(requestedPort)
    });

    applyProcessResult(electronResult);
}

async function runDevSession({ watchOnly }) {
    const preferredPort = parseRendererPort(process.env.KANBAN_RENDERER_PORT);
    const rendererPort = await findAvailablePort(preferredPort);
    const rendererUrl = getRendererUrl(rendererPort);
    const env = {
        ...process.env,
        KANBAN_RENDERER_PORT: String(rendererPort),
        KANBAN_RENDERER_URL: rendererUrl
    };

    process.stdout.write(`Using renderer dev server at ${rendererUrl}\n`);

    const result = await runPnpm(["exec", "concurrently", "-k", ...buildDevCommands(rendererPort, !watchOnly)], env);
    applyProcessResult(result);
}

export async function main(argv = process.argv.slice(2)) {
    const args = new Set(argv);

    if (args.has("--electron-only")) {
        await runElectronWhenReady(process.env);
        return;
    }

    await runDevSession({
        watchOnly: args.has("--watch-only")
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    });
}
