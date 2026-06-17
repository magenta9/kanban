import { describe, expect, it, vi } from "vitest";
import { createPaseoCliAdapter, inspectSummary, parsePaseoProviders, parsePaseoRunId, paseoInspectOutcome } from "./paseo-adapter";

describe("Paseo CLI adapter", () => {
    it("loads providers from paseo provider ls --json", async () => {
        const commandRunner = vi.fn(async () => ({
            stdout: JSON.stringify([{ provider: "codex", label: "Codex", status: "available", enabled: "Enabled" }]),
            stderr: "",
            exitCode: 0
        }));
        const paseo = createPaseoCliAdapter(commandRunner);

        await expect(paseo.listProviders()).resolves.toEqual([{ id: "codex", name: "Codex" }]);
        expect(commandRunner).toHaveBeenCalledWith("paseo", ["provider", "ls", "--json"], process.cwd());
    });

    it("surfaces provider listing failures", async () => {
        const commandRunner = vi.fn(async () => ({
            stdout: "",
            stderr: "paseo is not installed",
            exitCode: 127
        }));
        const paseo = createPaseoCliAdapter(commandRunner);

        await expect(paseo.listProviders()).rejects.toThrow("paseo is not installed");
    });

    it("surfaces a user-actionable message when the Paseo CLI cannot start", async () => {
        const commandRunner = vi.fn(async () => {
            throw new Error("spawn paseo ENOENT");
        });
        const paseo = createPaseoCliAdapter(commandRunner);

        await expect(paseo.listProviders()).rejects.toThrow(/Install Paseo.*paseo onboard/);
    });

    it("validates a Card Binding as a Git repository path", async () => {
        const commandRunner = vi.fn(async (_command: string, args: string[]) => {
            if (args.includes("--show-toplevel")) {
                return { stdout: "/repo\n", stderr: "", exitCode: 0 };
            }
            if (args.includes("--is-inside-work-tree")) {
                return { stdout: "true\n", stderr: "", exitCode: 0 };
            }
            throw new Error(`Unexpected args: ${args.join(" ")}`);
        });
        const paseo = createPaseoCliAdapter(commandRunner);

        await expect(paseo.validateRepoPath({ path: "/repo/subdir" })).resolves.toEqual({
            ok: true,
            path: "/repo/subdir",
            repoRoot: "/repo"
        });
    });

    it("starts a detached run without provider-specific mode flags", async () => {
        const commandRunner = vi.fn(async (_command: string, args: string[]) => {
            expect(args).toEqual(expect.arrayContaining(["run", "--detach", "--json", "--provider", "codex", "--cwd", "/repo"]));
            expect(args).not.toContain("--mode");
            expect(args.at(-1)).toBe("/goal\nDo work");
            return { stdout: JSON.stringify({ id: "agent-123" }), stderr: "", exitCode: 0 };
        });
        const paseo = createPaseoCliAdapter(commandRunner);

        await expect(paseo.startDetachedRun({
            agent: { id: "codex", name: "Codex" },
            repoRoot: "/repo",
            worktreeName: "kanban-card",
            title: "Fix checkout flow",
            prompt: "/goal\nDo work"
        })).resolves.toEqual({
            paseoAgentId: "agent-123"
        });
    });

    it("maps wait failure to a failed completion", async () => {
        const commandRunner = vi.fn(async () => ({ stdout: "", stderr: "agent crashed", exitCode: 1 }));
        const paseo = createPaseoCliAdapter(commandRunner);

        await expect(paseo.waitForCompletion({ paseoAgentId: "agent-123", repoRoot: "/repo" })).resolves.toEqual({
            outcome: "failed",
            details: "agent crashed"
        });
    });

    it("maps missing agents during recovery", async () => {
        const commandRunner = vi.fn(async () => ({ stdout: "", stderr: "agent not found", exitCode: 1 }));
        const paseo = createPaseoCliAdapter(commandRunner);

        await expect(paseo.inspectRecovery({ paseoAgentId: "agent-123", repoRoot: "/repo" })).resolves.toEqual({
            kind: "missing",
            details: "agent not found"
        });
    });
});

describe("parsePaseoProviders", () => {
    it("keeps enabled available Paseo providers and maps labels", () => {
        const providers = parsePaseoProviders(JSON.stringify([
            { provider: "codex", label: "Codex", status: "available", enabled: "Enabled" },
            { provider: "pi", label: "Pi", status: "available", enabled: true },
            { provider: "omp", label: "Open Model Proxy", status: "unavailable", enabled: "Enabled" },
            { provider: "claude", label: "Claude", status: "available", enabled: "Disabled" },
            { provider: "opencode", status: "available", enabled: "Enabled" }
        ]));

        expect(providers).toEqual([
            { id: "codex", name: "Codex" },
            { id: "pi", name: "Pi" },
            { id: "opencode", name: "opencode" }
        ]);
    });

    it("throws when Paseo provider output is not valid JSON", () => {
        expect(() => parsePaseoProviders("not json")).toThrow("Paseo returned malformed provider JSON.");
    });

    it("throws when Paseo provider output is not an array", () => {
        expect(() => parsePaseoProviders("{}")).toThrow("Paseo provider output must be a JSON array.");
    });
});

describe("parsePaseoRunId", () => {
    it("accepts common Paseo run id shapes", () => {
        expect(parsePaseoRunId(JSON.stringify({ id: "agent-1" }))).toBe("agent-1");
        expect(parsePaseoRunId(JSON.stringify({ agentId: "agent-2" }))).toBe("agent-2");
        expect(parsePaseoRunId(JSON.stringify({ agent: { id: "agent-3" } }))).toBe("agent-3");
    });

    it("throws when no run id is present", () => {
        expect(() => parsePaseoRunId("{}")).toThrow("Paseo run output did not include an agent id.");
    });
});

describe("inspectSummary", () => {
    it("summarizes inspect JSON", () => {
        expect(inspectSummary(JSON.stringify({ status: "completed", summary: "Done" }))).toBe("Status: completed; Done");
    });
});

describe("paseoInspectOutcome", () => {
    it("maps explicit Paseo terminal and running states", () => {
        expect(paseoInspectOutcome(JSON.stringify({ status: "idle" }))).toMatchObject({ kind: "completed" });
        expect(paseoInspectOutcome(JSON.stringify({ state: "cancelled" }))).toMatchObject({ kind: "failed" });
        expect(paseoInspectOutcome(JSON.stringify({ phase: "running" }))).toMatchObject({ kind: "running" });
    });

    it("keeps unknown inspect states recoverable", () => {
        expect(paseoInspectOutcome(JSON.stringify({ status: "mystery" }))).toEqual({
            kind: "unknown",
            details: "Paseo inspect returned an unknown status: mystery"
        });
    });
});
