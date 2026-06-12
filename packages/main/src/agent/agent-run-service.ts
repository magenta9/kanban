import type {
    KanbanAgentInfo,
    KanbanCard,
    KanbanCardCommentsChangedEvent,
    KanbanComment,
    StartKanbanAgentRunInput,
    StartKanbanAgentRunResult,
    ValidateKanbanAgentRepoResult
} from "@kanban/shared";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { KanbanRepository } from "../db/repositories/kanban-repository";
import type { AgentRunOutcome, AgentRunRecord, AgentRunRepository } from "./agent-run-repository";

interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

type CommandRunner = (command: string, args: string[], cwd: string) => Promise<CommandResult>;

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

export interface AgentRunServiceOptions {
    commandRunner?: CommandRunner;
    onCardCommentsChanged?: (event: KanbanCardCommentsChangedEvent) => void;
    backgroundTaskRunner?: (task: () => Promise<void>) => void;
}

export class AgentRunService {
    private readonly commandRunner: CommandRunner;
    private readonly backgroundTaskRunner: (task: () => Promise<void>) => void;

    constructor(
        private readonly kanban: KanbanRepository,
        private readonly agentRuns: AgentRunRepository,
        options: AgentRunServiceOptions = {}
    ) {
        this.commandRunner = options.commandRunner ?? runCommand;
        this.onCardCommentsChanged = options.onCardCommentsChanged;
        this.backgroundTaskRunner = options.backgroundTaskRunner ?? ((task) => {
            void task().catch((caught) => {
                console.error("Failed to append Paseo agent finish comment", caught);
            });
        });
    }

    private readonly onCardCommentsChanged?: (event: KanbanCardCommentsChangedEvent) => void;

    async listAvailable(): Promise<KanbanAgentInfo[]> {
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

    async startRun(input: StartKanbanAgentRunInput): Promise<StartKanbanAgentRunResult> {
        const card = this.findCard(input.cardId);
        const repoPath = card.gitRepositoryPath?.trim();
        if (!repoPath) {
            throw new Error("Bind a Git repository to this card before starting an Agent Run.");
        }
        const validation = await this.validateRepoPath({ path: repoPath });
        if (!validation.ok) {
            throw new Error(validation.message ?? "Select a valid Git repository folder.");
        }

        const existingRun = this.agentRuns.findRunningByCard(card.id);
        if (existingRun) {
            throw new Error("This card already has a running Agent Run.");
        }
        const agents = await this.listAvailable();
        const agent = agents.find((item) => item.id === input.agentId);
        if (!agent) {
            throw new Error("Selected Paseo provider is not available.");
        }

        const repoRoot = validation.repoRoot ?? validation.path;
        const worktreeName = agentWorktreeName(card);
        const prompt = buildPaseoPrompt(card);
        const mode = agentRunMode(agent);
        const result = await this.runPaseo([
            "run",
            "--detach",
            "--json",
            "--provider",
            agent.id,
            "--worktree",
            worktreeName,
            "--cwd",
            repoRoot,
            "--title",
            card.title,
            ...mode.args,
            prompt
        ], repoRoot);
        if (result.exitCode !== 0) {
            throw new Error(cleanCommandError(result, "Paseo failed to start the agent run."));
        }

        const paseoAgentId = parsePaseoRunId(result.stdout);
        let runRecord!: AgentRunRecord;
        let updatedCard!: KanbanCard;
        try {
            this.agentRuns.transaction(() => {
                runRecord = this.agentRuns.create({
                    cardId: card.id,
                    paseoAgentId,
                    providerId: agent.id,
                    providerName: agent.name,
                    modeLabel: mode.label,
                    repoRoot,
                    worktreeName
                });
                updatedCard = this.kanban.addCardComment({
                    cardId: card.id,
                    body: startComment({ agent, modeLabel: mode.label, paseoAgentId, worktreeName, title: card.title })
                });
            });
        }
        catch (caught) {
            throw new Error([
                `Paseo agent ${paseoAgentId} was created, but Kanban could not record it.`,
                `Use "paseo logs ${paseoAgentId}" or "paseo attach ${paseoAgentId}" to inspect it.`,
                errorMessage(caught)
            ].join(" "));
        }
        this.emitCommentsChanged(updatedCard);
        this.backgroundTaskRunner(() => this.observeRunningRun(runRecord));

        return {
            card: updatedCard,
            agent,
            paseoAgentId,
            status: "started",
            summary: `Paseo agent ${paseoAgentId} started with ${agent.name}.`
        };
    }

    async recoverRunningRuns(): Promise<void> {
        const records = this.agentRuns.listRunning();
        for (const record of records) {
            await this.recoverRunningRun(record);
        }
    }

    private findCard(cardId: string): KanbanCard {
        const boards = this.kanban.listBoards();
        for (const board of boards) {
            const card = this.kanban.listCards({ boardId: board.id, includeArchived: true }).find((item) => item.id === cardId);
            if (card) return card;
        }
        throw new Error(`Kanban card not found: ${cardId}`);
    }

    private emitCommentsChanged(card: KanbanCard): void {
        this.onCardCommentsChanged?.({ boardId: card.boardId, cardId: card.id });
    }

    private async observeRunningRun(record: AgentRunRecord): Promise<void> {
        let waitResult: CommandResult;
        try {
            waitResult = await this.runPaseo(["wait", "--json", record.paseoAgentId], record.repoRoot);
        }
        catch (caught) {
            this.finalizeAgentRun(record, { status: "finished", outcome: "failed", details: errorMessage(caught) });
            return;
        }
        if (waitResult.exitCode !== 0) {
            this.finalizeAgentRun(record, { status: "finished", outcome: "failed", details: cleanCommandError(waitResult, "Paseo wait failed.") });
            return;
        }

        let details: string;
        try {
            const inspectResult = await this.runPaseo(["inspect", "--json", record.paseoAgentId], record.repoRoot);
            details = inspectResult.exitCode === 0 ? inspectSummary(inspectResult.stdout) : cleanCommandError(inspectResult, "Paseo inspect failed.");
        }
        catch (caught) {
            details = errorMessage(caught);
        }
        this.finalizeAgentRun(record, { status: "finished", outcome: "completed", details });
    }

    private async recoverRunningRun(record: AgentRunRecord): Promise<void> {
        if (!this.cardExists(record.cardId)) {
            this.agentRuns.delete({ id: record.id });
            return;
        }

        if (!existsSync(record.repoRoot)) {
            this.agentRuns.recordTransientFailure({
                id: record.id,
                lastError: `Repository path is not available: ${record.repoRoot}`
            });
            return;
        }

        let inspectResult: CommandResult;
        try {
            inspectResult = await this.runPaseo(["inspect", "--json", record.paseoAgentId], record.repoRoot);
        }
        catch (caught) {
            this.agentRuns.recordTransientFailure({ id: record.id, lastError: errorMessage(caught) });
            return;
        }

        if (inspectResult.exitCode !== 0) {
            const details = cleanCommandError(inspectResult, "Paseo inspect failed.");
            if (isPaseoAgentNotFound(details)) {
                this.finalizeAgentRun(record, { status: "recovery_failed", outcome: "failed", details });
                return;
            }
            this.agentRuns.recordTransientFailure({ id: record.id, lastError: details });
            return;
        }

        const outcome = paseoInspectOutcome(inspectResult.stdout);
        if (outcome.kind === "completed") {
            this.finalizeAgentRun(record, { status: "finished", outcome: "completed", details: outcome.details });
            return;
        }
        if (outcome.kind === "failed") {
            this.finalizeAgentRun(record, { status: "finished", outcome: "failed", details: outcome.details });
            return;
        }
        if (outcome.kind === "unknown") {
            this.agentRuns.recordTransientFailure({ id: record.id, lastError: outcome.details });
        }
    }

    private async runPaseo(args: string[], cwd: string): Promise<CommandResult> {
        try {
            return await this.commandRunner("paseo", args, cwd);
        }
        catch (caught) {
            throw new Error(commandStartupMessage("paseo", caught));
        }
    }

    private cardExists(cardId: string): boolean {
        try {
            this.findCard(cardId);
            return true;
        }
        catch {
            return false;
        }
    }

    private finalizeAgentRun(record: AgentRunRecord, input: { status: "finished" | "recovery_failed"; outcome: Exclude<AgentRunOutcome, "unknown">; details: string }): void {
        let updatedCard!: KanbanCard;
        this.agentRuns.transaction(() => {
            updatedCard = this.kanban.addCardComment({
                cardId: record.cardId,
                body: finishComment({
                    agent: { id: record.providerId, name: record.providerName },
                    paseoAgentId: record.paseoAgentId,
                    worktreeName: record.worktreeName,
                    outcome: input.outcome,
                    details: input.details
                })
            });
            if (input.status === "recovery_failed") {
                this.agentRuns.markRecoveryFailed({ id: record.id, lastError: input.details });
            } else {
                this.agentRuns.markFinished({ id: record.id, outcome: input.outcome, lastError: input.outcome === "failed" ? input.details : undefined });
            }
        });
        this.emitCommentsChanged(updatedCard);
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

export function buildPaseoPrompt(card: KanbanCard): string {
    const description = requirementDescription(card);
    const subtasks = card.subtasks.length > 0
        ? card.subtasks.map((subtask) => `- [${subtask.completed ? "x" : " "}] ${subtask.title.trim()}`).join("\n")
        : "No subtasks.";
    const humanComments = card.comments.filter((comment) => !isAgentRunComment(comment));
    const comments = humanComments.length > 0
        ? humanComments.map((comment) => `- ${formatCommentDate(comment.createdAt)}: ${indentMultiline(comment.body.trim(), "  ")}`).join("\n")
        : "No human comments.";

    return [
        "/goal",
        "",
        "Agent Run Requirement Context",
        "",
        "Requirement title:",
        card.title.trim(),
        "",
        "Requirement description:",
        description,
        "",
        "Subtasks:",
        subtasks,
        "",
        "Comments:",
        comments,
        "",
        "Complete the requested work. When finished, summarize what changed, checks run, and any follow-up needed."
    ].join("\n");
}

function requirementDescription(card: KanbanCard): string {
    const descriptionText = card.descriptionText?.trim();
    if (descriptionText) {
        return descriptionText;
    }

    const descriptionMarkdown = card.descriptionMarkdown?.trim();
    if (descriptionMarkdown) {
        return descriptionMarkdown;
    }

    return "No description.";
}

function isAgentRunComment(comment: KanbanComment): boolean {
    return /^Agent run (started|completed|failed|finished)\./i.test(comment.body.trim());
}

function agentWorktreeName(card: KanbanCard): string {
    const slug = card.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "card";
    return `kanban-${slug}-${card.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
}

function agentRunMode(agent: KanbanAgentInfo): { args: string[]; label?: string } {
    if (agent.id.toLowerCase() === "codex") {
        return { args: ["--mode", "full-access"], label: "Full Access" };
    }
    return { args: [] };
}

function startComment(input: { agent: KanbanAgentInfo; modeLabel?: string; paseoAgentId: string; worktreeName: string; title: string }): string {
    const lines = [
        "Agent run started.",
        "",
        `- Provider: ${input.agent.name} (${input.agent.id})`,
        input.modeLabel ? `- Mode: ${input.modeLabel}` : "",
        `- Paseo agent: ${input.paseoAgentId}`,
        `- Worktree: ${input.worktreeName}`,
        `- Logs: paseo logs ${input.paseoAgentId}`,
        `- Attach: paseo attach ${input.paseoAgentId}`,
        `- Requirement title: ${input.title}`
    ];
    return lines.filter((line) => line !== "").join("\n");
}

function finishComment(input: { agent: KanbanAgentInfo; paseoAgentId: string; worktreeName: string; outcome: "completed" | "failed"; details: string }): string {
    const heading = input.outcome === "completed" ? "Agent run completed." : "Agent run failed.";
    return [
        heading,
        "",
        `- Provider: ${input.agent.name} (${input.agent.id})`,
        `- Paseo agent: ${input.paseoAgentId}`,
        `- Worktree: ${input.worktreeName}`,
        `- Inspect: paseo inspect ${input.paseoAgentId}`,
        `- Logs: paseo logs ${input.paseoAgentId}`,
        `- Details: ${input.details || "No summary returned."}`
    ].join("\n");
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

function formatCommentDate(timestamp: number): string {
    return new Date(timestamp).toISOString();
}

function indentMultiline(value: string, prefix: string): string {
    return value.replace(/\n/g, `\n${prefix}`);
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

export function paseoInspectOutcome(stdout: string): { kind: "running" | "completed" | "failed" | "unknown"; details: string } {
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

function commandStartupMessage(command: string, caught: unknown): string {
    const detail = errorMessage(caught);
    if (command === "paseo") {
        return `Paseo CLI is not available. Install Paseo, run "paseo onboard", then try again. ${detail}`.trim();
    }
    return `${command} failed to start. ${detail}`.trim();
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
