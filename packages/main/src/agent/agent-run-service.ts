import { isAgentRunComment } from "@kanban/shared";
import type {
    KanbanAgentInfo,
    KanbanCard,
    KanbanCardCommentsChangedEvent,
    StartKanbanAgentRunInput,
    StartKanbanAgentRunResult,
    ValidateKanbanAgentRepoResult
} from "@kanban/shared";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { AgentRunOutcome, AgentRunRecord, AgentRunRepository } from "./agent-run-repository";
import { createPaseoCliAdapter, type PaseoAdapter } from "./paseo-adapter";

export interface AgentRunCardStore {
    getCard(input: { id: string }): KanbanCard;
    addCardComment(input: { cardId: string; body: string }): KanbanCard;
}

export interface AgentRunServiceOptions {
    paseo?: PaseoAdapter;
    onCardCommentsChanged?: (event: KanbanCardCommentsChangedEvent) => void;
    backgroundTaskRunner?: (task: () => Promise<void>) => void;
}

export class AgentRunService {
    private readonly paseo: PaseoAdapter;
    private readonly backgroundTaskRunner: (task: () => Promise<void>) => void;

    constructor(
        private readonly cards: AgentRunCardStore,
        private readonly agentRuns: AgentRunRepository,
        options: AgentRunServiceOptions = {}
    ) {
        this.paseo = options.paseo ?? createPaseoCliAdapter();
        this.onCardCommentsChanged = options.onCardCommentsChanged;
        this.backgroundTaskRunner = options.backgroundTaskRunner ?? ((task) => {
            void task().catch((caught) => {
                console.error("Failed to append Paseo agent finish comment", caught);
            });
        });
    }

    private readonly onCardCommentsChanged?: (event: KanbanCardCommentsChangedEvent) => void;

    async listAvailable(): Promise<KanbanAgentInfo[]> {
        return this.paseo.listProviders();
    }

    async validateRepoPath(input: { path: string }): Promise<ValidateKanbanAgentRepoResult> {
        return this.paseo.validateRepoPath(input);
    }

    async startRun(input: StartKanbanAgentRunInput): Promise<StartKanbanAgentRunResult> {
        const card = this.cards.getCard({ id: input.cardId });
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
        const startedRun = await this.paseo.startDetachedRun({ agent, repoRoot, worktreeName, title: card.title, prompt });
        let runRecord!: AgentRunRecord;
        let updatedCard!: KanbanCard;
        try {
            this.agentRuns.transaction(() => {
                runRecord = this.agentRuns.create({
                    cardId: card.id,
                    paseoAgentId: startedRun.paseoAgentId,
                    providerId: agent.id,
                    providerName: agent.name,
                    repoRoot,
                    worktreeName
                });
                updatedCard = this.cards.addCardComment({
                    cardId: card.id,
                    body: startComment({ agent, paseoAgentId: startedRun.paseoAgentId, worktreeName, title: card.title })
                });
            });
        }
        catch (caught) {
            throw new Error([
                `Paseo agent ${startedRun.paseoAgentId} was created, but Kanban could not record it.`,
                `Use "paseo logs ${startedRun.paseoAgentId}" or "paseo attach ${startedRun.paseoAgentId}" to inspect it.`,
                errorMessage(caught)
            ].join(" "));
        }
        this.emitCommentsChanged(updatedCard);
        this.backgroundTaskRunner(() => this.observeRunningRun(runRecord));

        return {
            card: updatedCard,
            agent,
            paseoAgentId: startedRun.paseoAgentId,
            status: "started",
            summary: `Paseo agent ${startedRun.paseoAgentId} started with ${agent.name}.`
        };
    }

    async recoverRunningRuns(): Promise<void> {
        const records = this.agentRuns.listRunning();
        for (const record of records) {
            await this.recoverRunningRun(record);
        }
    }

    private emitCommentsChanged(card: KanbanCard): void {
        this.onCardCommentsChanged?.({ boardId: card.boardId, cardId: card.id });
    }

    private async observeRunningRun(record: AgentRunRecord): Promise<void> {
        let completion: Awaited<ReturnType<PaseoAdapter["waitForCompletion"]>>;
        try {
            completion = await this.paseo.waitForCompletion({ paseoAgentId: record.paseoAgentId, repoRoot: record.repoRoot });
        }
        catch (caught) {
            this.finalizeAgentRun(record, { status: "finished", outcome: "failed", details: errorMessage(caught) });
            return;
        }
        this.finalizeAgentRun(record, { status: "finished", outcome: completion.outcome, details: completion.details });
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

        let outcome: Awaited<ReturnType<PaseoAdapter["inspectRecovery"]>>;
        try {
            outcome = await this.paseo.inspectRecovery({ paseoAgentId: record.paseoAgentId, repoRoot: record.repoRoot });
        }
        catch (caught) {
            this.agentRuns.recordTransientFailure({ id: record.id, lastError: errorMessage(caught) });
            return;
        }

        if (outcome.kind === "missing") {
            this.finalizeAgentRun(record, { status: "recovery_failed", outcome: "failed", details: outcome.details });
            return;
        }

        if (outcome.kind === "completed" || outcome.kind === "failed") {
            this.finalizeAgentRun(record, { status: "finished", outcome: outcome.kind, details: outcome.details });
            return;
        }
        if (outcome.kind === "running") {
            this.backgroundTaskRunner(() => this.observeRunningRun(record));
            return;
        }
        if (outcome.kind === "unknown") {
            this.agentRuns.recordTransientFailure({ id: record.id, lastError: outcome.details });
        }
    }

    private cardExists(cardId: string): boolean {
        try {
            this.cards.getCard({ id: cardId });
            return true;
        }
        catch {
            return false;
        }
    }

    private finalizeAgentRun(record: AgentRunRecord, input: { status: "finished" | "recovery_failed"; outcome: Exclude<AgentRunOutcome, "unknown">; details: string }): void {
        let updatedCard!: KanbanCard;
        this.agentRuns.transaction(() => {
            updatedCard = this.cards.addCardComment({
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

export function buildPaseoPrompt(card: KanbanCard): string {
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
        "Subtasks:",
        subtasks,
        "",
        "Comments:",
        comments
    ].join("\n");
}

function agentWorktreeName(card: KanbanCard): string {
    const slug = card.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "card";
    return `kanban-${slug}-${card.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
}

function startComment(input: { agent: KanbanAgentInfo; paseoAgentId: string; worktreeName: string; title: string }): string {
    return [
        "Agent run started.",
        "",
        `- Provider: ${input.agent.name} (${input.agent.id})`,
        `- Paseo agent: ${input.paseoAgentId}`,
        `- Worktree: ${input.worktreeName}`,
        `- Logs: paseo logs ${input.paseoAgentId}`,
        `- Attach: paseo attach ${input.paseoAgentId}`,
        `- Requirement title: ${input.title}`
    ].join("\n");
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

function formatCommentDate(timestamp: number): string {
    return new Date(timestamp).toISOString();
}

function indentMultiline(value: string, prefix: string): string {
    return value.replace(/\n/g, `\n${prefix}`);
}

function errorMessage(caught: unknown): string {
    return caught instanceof Error ? caught.message : String(caught);
}
