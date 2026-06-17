import { describe, expect, it, vi } from "vitest";
import type { KanbanCard, KanbanComment, KanbanSubtask } from "@kanban/shared";
import type { KanbanRepository } from "../db/repositories/kanban-repository";
import type { AgentRunRecord, AgentRunRepository } from "./agent-run-repository";
import { AgentRunService, buildPaseoPrompt } from "./agent-run-service";
import type { PaseoAdapter, PaseoCompletion } from "./paseo-adapter";

function testCard(patch: Partial<KanbanCard> = {}): KanbanCard {
    return {
        id: "card-12345678",
        boardId: "board-1",
        columnId: "todo",
        title: "Fix checkout flow",
        gitRepositoryPath: "/repo",
        priority: "none",
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
        labelIds: [],
        subtasks: [],
        comments: [],
        ...patch
    };
}

function testSubtask(title: string, completed = false): KanbanSubtask {
    return { id: title, title, completed, createdAt: 1, updatedAt: 1 };
}

function testComment(body: string): KanbanComment {
    return { id: body, body, createdAt: 1_765_000_000_000, updatedAt: 1_765_000_000_000 };
}

function expectPromptToExcludeDescription(prompt: string): void {
    expect(prompt).not.toContain("Requirement description:");
    expect(prompt).not.toContain("Checkout should preserve the selected shipping method.");
}

function createRepository(card: KanbanCard): KanbanRepository {
    return {
        listBoards: vi.fn(() => [{ id: "board-1", name: "Board", createdAt: 1, updatedAt: 1 }]),
        listCards: vi.fn(() => [card]),
        addCardComment: vi.fn(({ body }) => ({ ...card, comments: [...card.comments, testComment(body)] }))
    } as unknown as KanbanRepository;
}

function createAgentRuns(input: { running?: AgentRunRecord[] } = {}): AgentRunRepository {
    const records: AgentRunRecord[] = [...input.running ?? []];
    const repository = {
        transaction: vi.fn((operation: () => unknown) => operation()),
        create: vi.fn((runInput: Parameters<AgentRunRepository["create"]>[0]) => {
            const now = runInput.now ?? 10;
            const record: AgentRunRecord = {
                id: `run-${records.length + 1}`,
                cardId: runInput.cardId,
                paseoAgentId: runInput.paseoAgentId,
                providerId: runInput.providerId,
                providerName: runInput.providerName,
                modeLabel: runInput.modeLabel,
                repoRoot: runInput.repoRoot,
                worktreeName: runInput.worktreeName,
                status: "running",
                outcome: "unknown",
                startedAt: now,
                createdAt: now,
                updatedAt: now
            };
            records.push(record);
            return record;
        }),
        findRunningByCard: vi.fn((cardId: string) => records.find((record) => record.cardId === cardId && record.status === "running") ?? null),
        listRunning: vi.fn(() => records.filter((record) => record.status === "running")),
        markFinished: vi.fn((markInput: Parameters<AgentRunRepository["markFinished"]>[0]) => {
            const record = requireRecord(records, markInput.id);
            record.status = "finished";
            record.outcome = markInput.outcome;
            record.lastError = markInput.lastError;
            record.finishedAt = markInput.now ?? 20;
            record.updatedAt = record.finishedAt;
            return record;
        }),
        markRecoveryFailed: vi.fn((markInput: Parameters<AgentRunRepository["markRecoveryFailed"]>[0]) => {
            const record = requireRecord(records, markInput.id);
            record.status = "recovery_failed";
            record.outcome = "failed";
            record.lastError = markInput.lastError;
            record.finishedAt = markInput.now ?? 20;
            record.updatedAt = record.finishedAt;
            return record;
        }),
        recordTransientFailure: vi.fn((failureInput: Parameters<AgentRunRepository["recordTransientFailure"]>[0]) => {
            const record = requireRecord(records, failureInput.id);
            record.lastError = failureInput.lastError;
            record.updatedAt = failureInput.now ?? 20;
            return record;
        }),
        delete: vi.fn((deleteInput: Parameters<AgentRunRepository["delete"]>[0]) => {
            const index = records.findIndex((record) => record.id === deleteInput.id);
            if (index >= 0) records.splice(index, 1);
        }),
        require: vi.fn((id: string) => requireRecord(records, id))
    };
    return repository as unknown as AgentRunRepository;
}

function requireRecord(records: AgentRunRecord[], id: string): AgentRunRecord {
    const record = records.find((item) => item.id === id);
    if (!record) {
        throw new Error(`Agent Run record not found: ${id}`);
    }
    return record;
}

function runningRecord(patch: Partial<AgentRunRecord> = {}): AgentRunRecord {
    return {
        id: "run-1",
        cardId: "card-12345678",
        paseoAgentId: "agent-123",
        providerId: "codex",
        providerName: "Codex",
        modeLabel: "Full Access",
        repoRoot: "/Users/zhang/code/ai/kanban",
        worktreeName: "kanban-run",
        status: "running",
        outcome: "unknown",
        startedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        ...patch
    };
}

function createPaseoAdapter(patch: Partial<PaseoAdapter> = {}): PaseoAdapter {
    return {
        listProviders: vi.fn(async () => [{ id: "codex", name: "Codex" }]),
        validateRepoPath: vi.fn(async ({ path }) => ({ ok: true, path, repoRoot: "/repo" })),
        startDetachedRun: vi.fn(async () => ({ paseoAgentId: "agent-123" })),
        waitForCompletion: vi.fn(async () => ({ outcome: "completed" as const, details: "Status: completed; All checks passed." })),
        inspectRecovery: vi.fn(async () => ({ kind: "completed" as const, details: "Status: completed; Recovered." })),
        ...patch
    };
}

describe("AgentRunService", () => {
    it("loads providers from the Paseo adapter", async () => {
        const paseo = createPaseoAdapter();
        const service = new AgentRunService({} as KanbanRepository, createAgentRuns(), { paseo });

        await expect(service.listAvailable()).resolves.toEqual([{ id: "codex", name: "Codex" }]);
        expect(paseo.listProviders).toHaveBeenCalled();
    });

    it("surfaces Paseo adapter provider listing failures", async () => {
        const paseo = createPaseoAdapter({
            listProviders: vi.fn(async () => {
                throw new Error("paseo is not installed");
            })
        });
        const service = new AgentRunService({} as KanbanRepository, createAgentRuns(), { paseo });

        await expect(service.listAvailable()).rejects.toThrow("paseo is not installed");
    });

    it("starts a detached Paseo run and appends a start comment", async () => {
        const card = testCard({
            descriptionText: "Checkout should preserve the selected shipping method.",
            subtasks: [testSubtask("Add tests", true), testSubtask("Wire UI")],
            comments: [
                testComment("Use the new provider picker."),
                testComment("Agent run started.\n\n- Provider: Codex (codex)")
            ]
        });
        const repository = createRepository(card);
        const paseo = createPaseoAdapter();
        const onCardCommentsChanged = vi.fn();
        const backgroundTasks: Promise<void>[] = [];
        const agentRuns = createAgentRuns();
        const service = new AgentRunService(repository, agentRuns, {
            paseo,
            onCardCommentsChanged,
            backgroundTaskRunner: (task) => {
                backgroundTasks.push(task());
            }
        });

        const result = await service.startRun({ cardId: card.id, agentId: "codex" });
        await Promise.all(backgroundTasks);

        expect(result).toMatchObject({ paseoAgentId: "agent-123", status: "started", agent: { id: "codex", name: "Codex" } });
        expect(paseo.startDetachedRun).toHaveBeenCalledWith(expect.objectContaining({
            agent: { id: "codex", name: "Codex" },
            repoRoot: "/repo",
            title: "Fix checkout flow"
        }));
        const prompt = vi.mocked(paseo.startDetachedRun).mock.calls[0]?.[0].prompt ?? "";
        expect(prompt).toEqual(expect.stringMatching(/^\/goal\n/));
        expect(prompt).toContain("Requirement title:\nFix checkout flow");
        expectPromptToExcludeDescription(prompt);
        expect(prompt).toContain("- [x] Add tests");
        expect(prompt).toContain("- [ ] Wire UI");
        expect(prompt).toContain("Use the new provider picker.");
        expect(prompt).not.toContain("Complete the requested work.");
        expect(prompt).not.toContain("Provider: Codex (codex)");
        expect(repository.addCardComment).toHaveBeenNthCalledWith(1, {
            cardId: card.id,
            body: expect.stringContaining("Agent run started.")
        });
        expect(repository.addCardComment).toHaveBeenNthCalledWith(1, {
            cardId: card.id,
            body: expect.not.stringContaining("Mode:")
        });
        expect(repository.addCardComment).toHaveBeenNthCalledWith(2, {
            cardId: card.id,
            body: expect.stringContaining("Agent run completed.")
        });
        expect(repository.addCardComment).toHaveBeenNthCalledWith(2, {
            cardId: card.id,
            body: expect.stringContaining("All checks passed.")
        });
        expect(onCardCommentsChanged).toHaveBeenCalledTimes(2);
        expect(onCardCommentsChanged).toHaveBeenCalledWith({ boardId: "board-1", cardId: card.id });
        expect(agentRuns.create).toHaveBeenCalledWith(expect.objectContaining({
            cardId: card.id,
            paseoAgentId: "agent-123",
            providerId: "codex",
            providerName: "Codex",
            repoRoot: "/repo"
        }));
        expect(agentRuns.markFinished).toHaveBeenCalledWith(expect.objectContaining({
            id: "run-1",
            outcome: "completed"
        }));
    });

    it("blocks starting another Agent Run while the Card already has one running", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const agentRuns = createAgentRuns({ running: [runningRecord({ cardId: card.id })] });
        const paseo = createPaseoAdapter();
        const service = new AgentRunService(repository, agentRuns, { paseo });

        await expect(service.startRun({ cardId: card.id, agentId: "codex" })).rejects.toThrow("already has a running Agent Run");
        expect(paseo.startDetachedRun).not.toHaveBeenCalled();
    });

    it("requires the Card to bind a Git repository before starting an Agent Run", async () => {
        const card = testCard({ gitRepositoryPath: undefined });
        const repository = createRepository(card);
        const service = new AgentRunService(repository, createAgentRuns(), { paseo: createPaseoAdapter() });

        await expect(service.startRun({ cardId: card.id, agentId: "codex" })).rejects.toThrow("Bind a Git repository to this card");
    });

    it("appends a failed finish comment when Paseo wait fails", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const paseo = createPaseoAdapter({
            waitForCompletion: vi.fn(async () => ({ outcome: "failed" as const, details: "agent crashed" }))
        });
        const backgroundTasks: Promise<void>[] = [];
        const service = new AgentRunService(repository, createAgentRuns(), {
            paseo,
            backgroundTaskRunner: (task) => {
                backgroundTasks.push(task());
            }
        });

        await service.startRun({ cardId: card.id, agentId: "codex" });
        await Promise.all(backgroundTasks);

        expect(repository.addCardComment).toHaveBeenNthCalledWith(2, {
            cardId: card.id,
            body: expect.stringContaining("Agent run failed.")
        });
        expect(repository.addCardComment).toHaveBeenNthCalledWith(2, {
            cardId: card.id,
            body: expect.stringContaining("agent crashed")
        });
    });

    it("does not append a start comment when Paseo run fails before creating an agent", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const paseo = createPaseoAdapter({
            startDetachedRun: vi.fn(async () => {
                throw new Error("provider auth expired");
            })
        });
        const service = new AgentRunService(repository, createAgentRuns(), { paseo });

        await expect(service.startRun({ cardId: card.id, agentId: "codex" })).rejects.toThrow("provider auth expired");
        expect(repository.addCardComment).not.toHaveBeenCalled();
    });

    it("surfaces orphan Paseo agents when local recording fails after run creation", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const agentRuns = createAgentRuns();
        vi.mocked(agentRuns.transaction).mockImplementation(() => {
            throw new Error("database is locked");
        });
        const service = new AgentRunService(repository, agentRuns, { paseo: createPaseoAdapter() });

        await expect(service.startRun({ cardId: card.id, agentId: "codex" })).rejects.toThrow(/Paseo agent agent-123 was created, but Kanban could not record it.*paseo logs agent-123/);
    });

    it("appends a failed finish comment when Paseo wait cannot start", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const paseo = createPaseoAdapter({
            waitForCompletion: vi.fn(async () => {
                throw new Error("Paseo CLI is not available. Install Paseo, run \"paseo onboard\", then try again. daemon unavailable");
            })
        });
        const backgroundTasks: Promise<void>[] = [];
        const service = new AgentRunService(repository, createAgentRuns(), {
            paseo,
            backgroundTaskRunner: (task) => {
                backgroundTasks.push(task());
            }
        });

        await service.startRun({ cardId: card.id, agentId: "codex" });
        await Promise.all(backgroundTasks);

        expect(repository.addCardComment).toHaveBeenNthCalledWith(2, {
            cardId: card.id,
            body: expect.stringContaining("Agent run failed.")
        });
        expect(repository.addCardComment).toHaveBeenNthCalledWith(2, {
            cardId: card.id,
            body: expect.stringContaining("Install Paseo")
        });
    });

    it("recovers completed running records by appending a completed finish comment", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const agentRuns = createAgentRuns({ running: [runningRecord({ cardId: card.id })] });
        const paseo = createPaseoAdapter({
            inspectRecovery: vi.fn(async () => ({ kind: "completed" as const, details: "Status: completed; Recovered." }))
        });
        const onCardCommentsChanged = vi.fn();
        const service = new AgentRunService(repository, agentRuns, { paseo, onCardCommentsChanged });

        await service.recoverRunningRuns();

        expect(repository.addCardComment).toHaveBeenCalledWith({
            cardId: card.id,
            body: expect.stringContaining("Agent run completed.")
        });
        expect(agentRuns.markFinished).toHaveBeenCalledWith(expect.objectContaining({ id: "run-1", outcome: "completed" }));
        expect(onCardCommentsChanged).toHaveBeenCalledWith({ boardId: "board-1", cardId: card.id });
    });

    it("re-observes recovered records that are still running", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const agentRuns = createAgentRuns({ running: [runningRecord({ cardId: card.id })] });
        let finishWait!: (completion: PaseoCompletion) => void;
        const paseo = createPaseoAdapter({
            inspectRecovery: vi.fn(async () => ({ kind: "running" as const, details: "Still running." })),
            waitForCompletion: vi.fn(() => new Promise<PaseoCompletion>((resolve) => {
                finishWait = resolve;
            }))
        });
        const backgroundTasks: Promise<void>[] = [];
        const service = new AgentRunService(repository, agentRuns, {
            paseo,
            backgroundTaskRunner: (task) => {
                backgroundTasks.push(task());
            }
        });

        await service.recoverRunningRuns();

        expect(paseo.waitForCompletion).toHaveBeenCalledWith({ paseoAgentId: "agent-123", repoRoot: "/Users/zhang/code/ai/kanban" });
        expect(repository.addCardComment).not.toHaveBeenCalled();
        expect(agentRuns.markFinished).not.toHaveBeenCalled();

        finishWait({ outcome: "completed", details: "Status: completed; Recovered after restart." });
        await Promise.all(backgroundTasks);

        expect(repository.addCardComment).toHaveBeenCalledWith({
            cardId: card.id,
            body: expect.stringContaining("Agent run completed.")
        });
        expect(agentRuns.markFinished).toHaveBeenCalledWith(expect.objectContaining({ id: "run-1", outcome: "completed" }));
    });

    it("recovers failed external outcomes as finished Agent Runs with failed comments", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const agentRuns = createAgentRuns({ running: [runningRecord({ cardId: card.id })] });
        const paseo = createPaseoAdapter({
            inspectRecovery: vi.fn(async () => ({ kind: "failed" as const, details: "Status: cancelled; Stopped by user." }))
        });
        const service = new AgentRunService(repository, agentRuns, { paseo });

        await service.recoverRunningRuns();

        expect(repository.addCardComment).toHaveBeenCalledWith({
            cardId: card.id,
            body: expect.stringContaining("Agent run failed.")
        });
        expect(agentRuns.markFinished).toHaveBeenCalledWith(expect.objectContaining({ id: "run-1", outcome: "failed" }));
    });

    it("marks clearly missing Paseo agents as recovery_failed and appends one failed comment", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const agentRuns = createAgentRuns({ running: [runningRecord({ cardId: card.id })] });
        const paseo = createPaseoAdapter({
            inspectRecovery: vi.fn(async () => ({ kind: "missing" as const, details: "agent not found" }))
        });
        const service = new AgentRunService(repository, agentRuns, { paseo });

        await service.recoverRunningRuns();

        expect(repository.addCardComment).toHaveBeenCalledWith({
            cardId: card.id,
            body: expect.stringContaining("Agent run failed.")
        });
        expect(agentRuns.markRecoveryFailed).toHaveBeenCalledWith(expect.objectContaining({ id: "run-1", lastError: "agent not found" }));
    });

    it("keeps temporarily unobservable records running without appending comments", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const agentRuns = createAgentRuns({ running: [runningRecord({ cardId: card.id })] });
        const paseo = createPaseoAdapter({
            inspectRecovery: vi.fn(async () => {
                throw new Error("Paseo CLI is not available. Install Paseo, run \"paseo onboard\", then try again. daemon unavailable");
            })
        });
        const service = new AgentRunService(repository, agentRuns, { paseo });

        await service.recoverRunningRuns();

        expect(repository.addCardComment).not.toHaveBeenCalled();
        expect(agentRuns.recordTransientFailure).toHaveBeenCalledWith(expect.objectContaining({
            id: "run-1",
            lastError: expect.stringContaining("Install Paseo")
        }));
    });

    it("keeps records running when repoRoot is unavailable", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const agentRuns = createAgentRuns({ running: [runningRecord({ cardId: card.id, repoRoot: "/path/that/does/not/exist" })] });
        const paseo = createPaseoAdapter();
        const service = new AgentRunService(repository, agentRuns, { paseo });

        await service.recoverRunningRuns();

        expect(paseo.inspectRecovery).not.toHaveBeenCalled();
        expect(repository.addCardComment).not.toHaveBeenCalled();
        expect(agentRuns.recordTransientFailure).toHaveBeenCalledWith(expect.objectContaining({
            id: "run-1",
            lastError: "Repository path is not available: /path/that/does/not/exist"
        }));
    });
});

describe("buildPaseoPrompt", () => {
    it("contains only the current requirement context", () => {
        const prompt = buildPaseoPrompt(testCard({
            descriptionText: "Checkout should preserve the selected shipping method.",
            subtasks: [testSubtask("Ship it")],
            comments: [testComment("Human context."), testComment("Agent run failed.\n\nOld output.")]
        }));

        expect(prompt).toContain("Agent Run Requirement Context");
        expect(prompt).toContain("Requirement title:\nFix checkout flow");
        expectPromptToExcludeDescription(prompt);
        expect(prompt).toContain("Human context.");
        expect(prompt).not.toContain("Complete the requested work.");
        expect(prompt).not.toContain("Old output.");
    });
});
