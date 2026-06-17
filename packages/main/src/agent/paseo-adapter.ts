import type {
    KanbanAgentInfo,
    ValidateKanbanAgentRepoResult
} from "@kanban/shared";
import { spawn } from "node:child_process";

export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

export type CommandRunner = (command: string, args: string[], cwd: string) => Promise<CommandResult>;

export interface StartDetachedPaseoRunInput {
    agent: KanbanAgentInfo;
    repoRoot: string;
    worktreeName: string;
    title: string;
    prompt: string;
}

export interface StartDetachedPaseoRunResult {
    paseoAgentId: string;
}

export interface PaseoCompletion {
    outcome: "completed" | "failed";
    details: string;
}

export interface PaseoRecoveryInspection {
    kind: "running" | "completed" | "failed" | "missing" | "unknown";
    details: string;
}

export interface PaseoAdapter {
    listProviders(): Promise<KanbanAgentInfo[]>;
    validateRepoPath(input: { path: string }): Promise<ValidateKanbanAgentRepoResult>;
    startDetachedRun(input: StartDetachedPaseoRunInput): Promise<StartDetachedPaseoRunResult>;
    waitForCompletion(input: { paseoAgentId: string; repoRoot: string }): Promise<PaseoCompletion>;
    inspectRecovery(input: { paseoAgentId: string; repoRoot: string }): Promise<PaseoRecoveryInspection>;
}

interface PaseoProviderRecord {
    provider?: unknown;
    label?: unknown;
    status?: unknown;
    enabled?: unknown;
}

interface PaseoRunRecord {
    id?: unknown;
    agentId?: unknown;
    runId?: unknown;
    agent?: { id?: unknown };
}

export function createPaseoCliAdapter(commandRunner: CommandRunner = runCommand): PaseoAdapter {
    return new PaseoCliAdapter(commandRunner);
}

class PaseoCliAdapter implements PaseoAdapter {
    constructor(private readonly commandRunner: CommandRunner) { }

    async listProviders(): Promise<KanbanAgentInfo[]> {
        const result = await this.runPaseo(["provider", "ls", "--json"], process.cwd());
        if (result.exitCode !== 0) {
            throw new Error(cleanCommandError(result, "Unable to list Paseo providers."));
        }

        return parsePaseoProviders(result.stdout);
    }

    async validateRepoPath(input: { path: string }): Promise<ValidateKanbanAgentRepoResult> {
        const rawPath = input.path.trim();
        if (!rawPath) {
            return { ok: false, path: rawPath, message: "Select a Git repository folder." };
        }

        try {
            const repoRoot = await gitOutput(this.commandRunner, rawPath, ["rev-parse", "--show-toplevel"]);
            await gitOutput(this.commandRunner, repoRoot, ["rev-parse", "--is-inside-work-tree"]);
            return { ok: true, path: rawPath, repoRoot };
        }
        catch {
            return {
                ok: false,
                path: rawPath,
                message: "This folder is not a Git repository."
            };
        }
    }

    async startDetachedRun(input: StartDetachedPaseoRunInput): Promise<StartDetachedPaseoRunResult> {
        const result = await this.runPaseo([
            "run",
            "--detach",
            "--json",
            "--provider",
            input.agent.id,
            "--worktree",
            input.worktreeName,
            "--cwd",
            input.repoRoot,
            "--title",
            input.title,
            input.prompt
        ], input.repoRoot);
        if (result.exitCode !== 0) {
            throw new Error(cleanCommandError(result, "Paseo failed to start the agent run."));
        }

        return {
            paseoAgentId: parsePaseoRunId(result.stdout)
        };
    }

    async waitForCompletion(input: { paseoAgentId: string; repoRoot: string }): Promise<PaseoCompletion> {
        const waitResult = await this.runPaseo(["wait", "--json", input.paseoAgentId], input.repoRoot);
        if (waitResult.exitCode !== 0) {
            return { outcome: "failed", details: cleanCommandError(waitResult, "Paseo wait failed.") };
        }

        try {
            const inspectResult = await this.runPaseo(["inspect", "--json", input.paseoAgentId], input.repoRoot);
            return {
                outcome: "completed",
                details: inspectResult.exitCode === 0 ? inspectSummary(inspectResult.stdout) : cleanCommandError(inspectResult, "Paseo inspect failed.")
            };
        }
        catch (caught) {
            return { outcome: "completed", details: errorMessage(caught) };
        }
    }

    async inspectRecovery(input: { paseoAgentId: string; repoRoot: string }): Promise<PaseoRecoveryInspection> {
        const inspectResult = await this.runPaseo(["inspect", "--json", input.paseoAgentId], input.repoRoot);
        if (inspectResult.exitCode !== 0) {
            const details = cleanCommandError(inspectResult, "Paseo inspect failed.");
            return { kind: isPaseoAgentNotFound(details) ? "missing" : "unknown", details };
        }

        return paseoInspectOutcome(inspectResult.stdout);
    }

    private async runPaseo(args: string[], cwd: string): Promise<CommandResult> {
        try {
            return await this.commandRunner("paseo", args, cwd);
        }
        catch (caught) {
            throw new Error(paseoStartupMessage(caught));
        }
    }
}

export function parsePaseoProviders(stdout: string): KanbanAgentInfo[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        throw new Error("Paseo returned malformed provider JSON.");
    }

    if (!Array.isArray(parsed)) {
        throw new Error("Paseo provider output must be a JSON array.");
    }

    return parsed
        .map((item) => normalizePaseoProvider(item))
        .filter((item): item is KanbanAgentInfo => item !== null);
}

function normalizePaseoProvider(input: unknown): KanbanAgentInfo | null {
    if (!input || typeof input !== "object") {
        return null;
    }
    const record = input as PaseoProviderRecord;
    const provider = typeof record.provider === "string" ? record.provider.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!provider || !paseoProviderIsAvailable(record)) {
        return null;
    }

    return {
        id: provider,
        name: label || provider
    };
}

function paseoProviderIsAvailable(record: PaseoProviderRecord): boolean {
    const status = String(record.status ?? "").toLowerCase();
    const enabled = String(record.enabled ?? "").toLowerCase();
    return status === "available" && (enabled === "enabled" || enabled === "true");
}

export function parsePaseoRunId(stdout: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        throw new Error("Paseo returned malformed run JSON.");
    }

    if (typeof parsed === "string" && parsed.trim()) {
        return parsed.trim();
    }

    if (!parsed || typeof parsed !== "object") {
        throw new Error("Paseo run output did not include an agent id.");
    }

    const record = parsed as PaseoRunRecord;
    const candidates = [record.id, record.agentId, record.runId, record.agent?.id];
    const id = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
    if (typeof id === "string") {
        return id.trim();
    }

    throw new Error("Paseo run output did not include an agent id.");
}

export function inspectSummary(stdout: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return stdout.trim();
    }

    if (!parsed || typeof parsed !== "object") {
        return String(parsed ?? "").trim();
    }

    const record = parsed as Record<string, unknown>;
    const status = stringField(record, ["status", "state", "phase", "outcome"]);
    const summary = stringField(record, ["summary", "result", "message"]);
    return [status ? `Status: ${status}` : "", summary].filter(Boolean).join("; ") || "No summary returned.";
}

export function paseoInspectOutcome(stdout: string): PaseoRecoveryInspection {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        const trimmed = stdout.trim();
        return { kind: "unknown", details: trimmed ? `Paseo inspect returned non-JSON output: ${trimmed}` : "Paseo inspect returned empty output." };
    }

    if (!parsed || typeof parsed !== "object") {
        return { kind: "unknown", details: `Paseo inspect returned an unsupported value: ${String(parsed)}` };
    }

    const record = parsed as Record<string, unknown>;
    const rawStatus = stringField(record, ["status", "state", "phase", "outcome"]).toLowerCase();
    const details = inspectSummary(stdout);
    if (["idle", "completed", "succeeded", "success", "finished", "done"].includes(rawStatus)) {
        return { kind: "completed", details };
    }
    if (["failed", "cancelled", "canceled", "error", "errored"].includes(rawStatus)) {
        return { kind: "failed", details };
    }
    if (["running", "active", "busy", "working", "pending", "queued", "in_progress"].includes(rawStatus)) {
        return { kind: "running", details };
    }

    return {
        kind: "unknown",
        details: rawStatus ? `Paseo inspect returned an unknown status: ${rawStatus}` : "Paseo inspect did not include a status."
    };
}

function stringField(record: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "";
}

async function gitOutput(commandRunner: CommandRunner, cwd: string, args: string[]): Promise<string> {
    const result = await commandRunner("git", ["-C", cwd, ...args], process.cwd());
    if (result.exitCode !== 0) {
        throw new Error(cleanCommandError(result, "Git command failed."));
    }
    return result.stdout.trim();
}

function cleanCommandError(result: CommandResult, fallback: string): string {
    return result.stderr.trim() || result.stdout.trim() || fallback;
}

function paseoStartupMessage(caught: unknown): string {
    const detail = errorMessage(caught);
    return `Paseo CLI is not available. Install Paseo, run "paseo onboard", then try again. ${detail}`.trim();
}

function isPaseoAgentNotFound(value: string): boolean {
    return /\b(not found|no such agent|unknown agent|does not exist|missing agent)\b/i.test(value);
}

function errorMessage(caught: unknown): string {
    return caught instanceof Error ? caught.message : String(caught);
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, shell: false });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", (error) => reject(error));
        child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
    });
}
