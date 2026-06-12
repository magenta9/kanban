import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { KanbanRepository } from "../db/repositories/kanban-repository";
import { AgentRunRepository } from "./agent-run-repository";

function createRepositories(): { kanban: KanbanRepository; agentRuns: AgentRunRepository } {
    const database = new Database(":memory:");
    migrate(database);
    return {
        kanban: new KanbanRepository(database),
        agentRuns: new AgentRunRepository(database)
    };
}

function createCard(kanban: KanbanRepository): { cardId: string } {
    const board = kanban.createBoard({ name: "Board" });
    const [column] = kanban.listColumns({ boardId: board.id });
    const card = kanban.createCard({ boardId: board.id, columnId: column!.id, title: "Run agent" });
    return { cardId: card.id };
}

function createRun(agentRuns: AgentRunRepository, cardId: string, patch: Partial<Parameters<AgentRunRepository["create"]>[0]> = {}) {
    return agentRuns.create({
        cardId,
        paseoAgentId: "agent-1",
        providerId: "codex",
        providerName: "Codex",
        modeLabel: "Full Access",
        repoRoot: "/repo",
        worktreeName: "kanban-run",
        now: 10,
        ...patch
    });
}

describe("AgentRunRepository", () => {
    it("creates running Agent Run records", () => {
        const { kanban, agentRuns } = createRepositories();
        const { cardId } = createCard(kanban);

        const record = createRun(agentRuns, cardId);

        expect(record).toMatchObject({
            cardId,
            paseoAgentId: "agent-1",
            providerId: "codex",
            providerName: "Codex",
            modeLabel: "Full Access",
            repoRoot: "/repo",
            worktreeName: "kanban-run",
            status: "running",
            outcome: "unknown",
            startedAt: 10,
            createdAt: 10,
            updatedAt: 10
        });
        expect(agentRuns.listRunning()).toHaveLength(1);
        expect(agentRuns.findRunningByCard(cardId)?.id).toBe(record.id);
    });

    it("allows only one running Agent Run per Card", () => {
        const { kanban, agentRuns } = createRepositories();
        const { cardId } = createCard(kanban);

        createRun(agentRuns, cardId);

        expect(() => createRun(agentRuns, cardId, { paseoAgentId: "agent-2" })).toThrow();
    });

    it("allows a new running Agent Run after a previous run reaches a terminal state", () => {
        const { kanban, agentRuns } = createRepositories();
        const { cardId } = createCard(kanban);
        const first = createRun(agentRuns, cardId);
        agentRuns.markFinished({ id: first.id, outcome: "completed", now: 20 });

        const second = createRun(agentRuns, cardId, { paseoAgentId: "agent-2", now: 30 });

        expect(second.status).toBe("running");
        expect(agentRuns.listRunning().map((record) => record.id)).toEqual([second.id]);
        expect(agentRuns.require(first.id)).toMatchObject({ status: "finished", outcome: "completed", finishedAt: 20 });
    });

    it("keeps running records after card archive and cascades them on card delete", () => {
        const { kanban, agentRuns } = createRepositories();
        const { cardId } = createCard(kanban);
        const record = createRun(agentRuns, cardId);

        kanban.archiveCard({ id: cardId });
        expect(agentRuns.require(record.id)).toMatchObject({ id: record.id });

        kanban.deleteCard({ id: cardId });
        expect(agentRuns.listRunning()).toEqual([]);
        expect(() => agentRuns.require(record.id)).toThrow("Agent Run record not found");
    });

    it("records transient and terminal recovery states", () => {
        const { kanban, agentRuns } = createRepositories();
        const { cardId } = createCard(kanban);
        const record = createRun(agentRuns, cardId);

        expect(agentRuns.recordTransientFailure({ id: record.id, lastError: "daemon unavailable", now: 20 })).toMatchObject({
            status: "running",
            outcome: "unknown",
            lastError: "daemon unavailable",
            updatedAt: 20
        });
        expect(agentRuns.markRecoveryFailed({ id: record.id, lastError: "agent not found", now: 30 })).toMatchObject({
            status: "recovery_failed",
            outcome: "failed",
            lastError: "agent not found",
            finishedAt: 30,
            updatedAt: 30
        });
    });
});
