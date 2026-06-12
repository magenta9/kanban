import { describe, expect, it, vi } from "vitest";
import type { KanbanCard, KanbanComment, KanbanSubtask } from "@kanban/shared";
import type { KanbanRepository } from "../db/repositories/kanban-repository";
import type { AgentRunRecord, AgentRunRepository } from "./agent-run-repository";
import { AgentRunService, buildPaseoPrompt, inspectSummary, parsePaseoProviders, parsePaseoRunId, paseoInspectOutcome } from "./agent-run-service";

function testCard(patch: Partial<KanbanCard> = {}): KanbanCard {
    return {
        id: "card-12345678",
        boardId: "board-1",
        columnId: "todo",
        title: "Fix checkout flow",
        descriptionText: "Checkout should preserve the selected shipping method.",
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

describe("AgentRunService", () => {
    it("loads providers from paseo provider ls --json", async () => {
        const commandRunner = vi.fn(async () => ({
            stdout: JSON.stringify([{ provider: "codex", label: "Codex", status: "available", enabled: "Enabled" }]),
            stderr: "",
            exitCode: 0
        }));
        const service = new AgentRunService({} as KanbanRepository, createAgentRuns(), { commandRunner });

        await expect(service.listAvailable()).resolves.toEqual([{ id: "codex", name: "Codex" }]);
        expect(commandRunner).toHaveBeenCalledWith("paseo", ["provider", "ls", "--json"], process.cwd());
    });

    it("surfaces Paseo provider listing failures", async () => {
        const commandRunner = vi.fn(async () => ({
            stdout: "",
            stderr: "paseo is not installed",
            exitCode: 127
        }));
        const service = new AgentRunService({} as KanbanRepository, createAgentRuns(), { commandRunner });

        await expect(service.listAvailable()).rejects.toThrow("paseo is not installed");
    });

    it("surfaces a user-actionable message when the Paseo CLI cannot start", async () => {
        const commandRunner = vi.fn(async () => {
            throw new Error("spawn paseo ENOENT");
        });
        const service = new AgentRunService({} as KanbanRepository, createAgentRuns(), { commandRunner });

        await expect(service.listAvailable()).rejects.toThrow("Install Paseo");
        await expect(service.listAvailable()).rejects.toThrow("paseo onboard");
    });

    it("starts a detached Paseo run and appends a start comment", async () => {
        const card = testCard({
            subtasks: [testSubtask("Add tests", true), testSubtask("Wire UI")],
            comments: [
                testComment("Use the new provider picker."),
                testComment("Agent run started.\n\n- Provider: Codex (codex)")
            ]
        });
        const repository = createRepository(card);
        const commandRunner = vi.fn(async (command: string, args: string[]) => {
            if (command === "git" && args.includes("--show-toplevel")) {
                return { stdout: "/repo\n", stderr: "", exitCode: 0 };
            }
            if (command === "git" && args.includes("--is-inside-work-tree")) {
                return { stdout: "true\n", stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "provider") {
                return {
                    stdout: JSON.stringify([{ provider: "codex", label: "Codex", status: "available", enabled: "Enabled" }]),
                    stderr: "",
                    exitCode: 0
                };
            }
            if (command === "paseo" && args[0] === "run") {
                return { stdout: JSON.stringify({ id: "agent-123" }), stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "wait") {
                return { stdout: JSON.stringify({ status: "idle" }), stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "inspect") {
                return { stdout: JSON.stringify({ status: "completed", summary: "All checks passed." }), stderr: "", exitCode: 0 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        });
        const onCardCommentsChanged = vi.fn();
        const backgroundTasks: Promise<void>[] = [];
        const agentRuns = createAgentRuns();
        const service = new AgentRunService(repository, agentRuns, {
            commandRunner,
            onCardCommentsChanged,
            backgroundTaskRunner: (task) => {
                backgroundTasks.push(task());
            }
        });

        const result = await service.startRun({ cardId: card.id, agentId: "codex" });
        await Promise.all(backgroundTasks);

        expect(result).toMatchObject({ paseoAgentId: "agent-123", status: "started", agent: { id: "codex", name: "Codex" } });
        const runCall = commandRunner.mock.calls.find(([command, args]) => command === "paseo" && args[0] === "run");
        expect(runCall).toBeDefined();
        const runArgs = runCall?.[1] ?? [];
        expect(runArgs).toEqual(expect.arrayContaining(["run", "--detach", "--json", "--provider", "codex", "--cwd", "/repo", "--mode", "full-access"]));
        expect(runArgs[runArgs.length - 1]).toEqual(expect.stringMatching(/^\/goal\n/));
        const prompt = String(runArgs[runArgs.length - 1]);
        expect(prompt).toContain("Requirement title:\nFix checkout flow");
        expect(prompt).toContain("Requirement description:\nCheckout should preserve the selected shipping method.");
        expect(prompt).toContain("- [x] Add tests");
        expect(prompt).toContain("- [ ] Wire UI");
        expect(prompt).toContain("Use the new provider picker.");
        expect(prompt).not.toContain("Provider: Codex (codex)");
        expect(repository.addCardComment).toHaveBeenNthCalledWith(1, {
            cardId: card.id,
            body: expect.stringContaining("Agent run started.")
        });
        expect(repository.addCardComment).toHaveBeenNthCalledWith(1, {
            cardId: card.id,
            body: expect.stringContaining("Mode: Full Access")
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
            modeLabel: "Full Access",
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
        const commandRunner = vi.fn(async (command: string, args: string[]) => {
            if (command === "git" && args.includes("--show-toplevel")) {
                return { stdout: "/repo\n", stderr: "", exitCode: 0 };
            }
            if (command === "git" && args.includes("--is-inside-work-tree")) {
                return { stdout: "true\n", stderr: "", exitCode: 0 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        });
        const service = new AgentRunService(repository, agentRuns, { commandRunner });

        await expect(service.startRun({ cardId: card.id, agentId: "codex" })).rejects.toThrow("already has a running Agent Run");
        expect(commandRunner).not.toHaveBeenCalledWith("paseo", expect.any(Array), expect.any(String));
    });

    it("requires the Card to bind a Git repository before starting an Agent Run", async () => {
        const card = testCard({ gitRepositoryPath: undefined });
        const repository = createRepository(card);
        const service = new AgentRunService(repository, createAgentRuns(), { commandRunner: vi.fn() });

        await expect(service.startRun({ cardId: card.id, agentId: "codex" })).rejects.toThrow("Bind a Git repository to this card");
    });

    it("does not pass Codex full access mode to non-Codex providers", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const commandRunner = vi.fn(async (command: string, args: string[]) => {
            if (command === "git" && args.includes("--show-toplevel")) {
                return { stdout: "/repo\n", stderr: "", exitCode: 0 };
            }
            if (command === "git" && args.includes("--is-inside-work-tree")) {
                return { stdout: "true\n", stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "provider") {
                return {
                    stdout: JSON.stringify([{ provider: "pi", label: "Pi", status: "available", enabled: "Enabled" }]),
                    stderr: "",
                    exitCode: 0
                };
            }
            if (command === "paseo" && args[0] === "run") {
                return { stdout: JSON.stringify({ id: "agent-456" }), stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "wait") {
                return { stdout: JSON.stringify({ status: "idle" }), stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "inspect") {
                return { stdout: JSON.stringify({ status: "completed" }), stderr: "", exitCode: 0 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        });
        const backgroundTasks: Promise<void>[] = [];
        const service = new AgentRunService(repository, createAgentRuns(), {
            commandRunner,
            backgroundTaskRunner: (task) => {
                backgroundTasks.push(task());
            }
        });

        await service.startRun({ cardId: card.id, agentId: "pi" });
        await Promise.all(backgroundTasks);

        const runCall = commandRunner.mock.calls.find(([command, args]) => command === "paseo" && args[0] === "run");
        expect(runCall?.[1]).not.toContain("--mode");
        expect(repository.addCardComment).toHaveBeenNthCalledWith(1, {
            cardId: card.id,
            body: expect.not.stringContaining("Mode: Full Access")
        });
    });

    it("appends a failed finish comment when Paseo wait fails", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const commandRunner = vi.fn(async (command: string, args: string[]) => {
            if (command === "git" && args.includes("--show-toplevel")) {
                return { stdout: "/repo\n", stderr: "", exitCode: 0 };
            }
            if (command === "git" && args.includes("--is-inside-work-tree")) {
                return { stdout: "true\n", stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "provider") {
                return {
                    stdout: JSON.stringify([{ provider: "codex", label: "Codex", status: "available", enabled: "Enabled" }]),
                    stderr: "",
                    exitCode: 0
                };
            }
            if (command === "paseo" && args[0] === "run") {
                return { stdout: JSON.stringify({ id: "agent-123" }), stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "wait") {
                return { stdout: "", stderr: "agent crashed", exitCode: 1 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        });
        const backgroundTasks: Promise<void>[] = [];
        const service = new AgentRunService(repository, createAgentRuns(), {
            commandRunner,
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
        const commandRunner = vi.fn(async (command: string, args: string[]) => {
            if (command === "git" && args.includes("--show-toplevel")) {
                return { stdout: "/repo\n", stderr: "", exitCode: 0 };
            }
            if (command === "git" && args.includes("--is-inside-work-tree")) {
                return { stdout: "true\n", stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "provider") {
                return {
                    stdout: JSON.stringify([{ provider: "codex", label: "Codex", status: "available", enabled: "Enabled" }]),
                    stderr: "",
                    exitCode: 0
                };
            }
            if (command === "paseo" && args[0] === "run") {
                return { stdout: "", stderr: "provider auth expired", exitCode: 1 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        });
        const service = new AgentRunService(repository, createAgentRuns(), { commandRunner });

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
        const commandRunner = vi.fn(async (command: string, args: string[]) => {
            if (command === "git" && args.includes("--show-toplevel")) {
                return { stdout: "/repo\n", stderr: "", exitCode: 0 };
            }
            if (command === "git" && args.includes("--is-inside-work-tree")) {
                return { stdout: "true\n", stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "provider") {
                return {
                    stdout: JSON.stringify([{ provider: "codex", label: "Codex", status: "available", enabled: "Enabled" }]),
                    stderr: "",
                    exitCode: 0
                };
            }
            if (command === "paseo" && args[0] === "run") {
                return { stdout: JSON.stringify({ id: "agent-123" }), stderr: "", exitCode: 0 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        });
        const service = new AgentRunService(repository, agentRuns, { commandRunner });

        await expect(service.startRun({ cardId: card.id, agentId: "codex" })).rejects.toThrow("Paseo agent agent-123 was created, but Kanban could not record it");
        await expect(service.startRun({ cardId: card.id, agentId: "codex" })).rejects.toThrow("paseo logs agent-123");
    });

    it("appends a failed finish comment when Paseo wait cannot start", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const commandRunner = vi.fn(async (command: string, args: string[]) => {
            if (command === "git" && args.includes("--show-toplevel")) {
                return { stdout: "/repo\n", stderr: "", exitCode: 0 };
            }
            if (command === "git" && args.includes("--is-inside-work-tree")) {
                return { stdout: "true\n", stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "provider") {
                return {
                    stdout: JSON.stringify([{ provider: "codex", label: "Codex", status: "available", enabled: "Enabled" }]),
                    stderr: "",
                    exitCode: 0
                };
            }
            if (command === "paseo" && args[0] === "run") {
                return { stdout: JSON.stringify({ id: "agent-123" }), stderr: "", exitCode: 0 };
            }
            if (command === "paseo" && args[0] === "wait") {
                throw new Error("daemon unavailable");
            }
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        });
        const backgroundTasks: Promise<void>[] = [];
        const service = new AgentRunService(repository, createAgentRuns(), {
            commandRunner,
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
        const commandRunner = vi.fn(async (command: string, args: string[]) => {
            if (command === "paseo" && args[0] === "inspect") {
                return { stdout: JSON.stringify({ status: "completed", summary: "Recovered." }), stderr: "", exitCode: 0 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        });
        const onCardCommentsChanged = vi.fn();
        const service = new AgentRunService(repository, agentRuns, { commandRunner, onCardCommentsChanged });

        await service.recoverRunningRuns();

        expect(repository.addCardComment).toHaveBeenCalledWith({
            cardId: card.id,
            body: expect.stringContaining("Agent run completed.")
        });
        expect(agentRuns.markFinished).toHaveBeenCalledWith(expect.objectContaining({ id: "run-1", outcome: "completed" }));
        expect(onCardCommentsChanged).toHaveBeenCalledWith({ boardId: "board-1", cardId: card.id });
    });

    it("recovers failed external outcomes as finished Agent Runs with failed comments", async () => {
        const card = testCard();
        const repository = createRepository(card);
        const agentRuns = createAgentRuns({ running: [runningRecord({ cardId: card.id })] });
        const commandRunner = vi.fn(async (command: string, args: string[]) => {
            if (command === "paseo" && args[0] === "inspect") {
                return { stdout: JSON.stringify({ status: "cancelled", summary: "Stopped by user." }), stderr: "", exitCode: 0 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        });
        const service = new AgentRunService(repository, agentRuns, { commandRunner });

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
        const commandRunner = vi.fn(async (command: string, args: string[]) => {
            if (command === "paseo" && args[0] === "inspect") {
                return { stdout: "", stderr: "agent not found", exitCode: 1 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        });
        const service = new AgentRunService(repository, agentRuns, { commandRunner });

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
        const commandRunner = vi.fn(async () => {
            throw new Error("daemon unavailable");
        });
        const service = new AgentRunService(repository, agentRuns, { commandRunner });

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
        const commandRunner = vi.fn();
        const service = new AgentRunService(repository, agentRuns, { commandRunner });

        await service.recoverRunningRuns();

        expect(commandRunner).not.toHaveBeenCalled();
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
            subtasks: [testSubtask("Ship it")],
            comments: [testComment("Human context."), testComment("Agent run failed.\n\nOld output.")]
        }));

        expect(prompt).toContain("Agent Run Requirement Context");
        expect(prompt).toContain("Requirement title:\nFix checkout flow");
        expect(prompt).toContain("Requirement description:\nCheckout should preserve the selected shipping method.");
        expect(prompt).toContain("Human context.");
        expect(prompt).not.toContain("Old output.");
    });

    it("falls back to markdown description when plain text is unavailable", () => {
        const prompt = buildPaseoPrompt(testCard({
            descriptionText: "",
            descriptionMarkdown: "Use **markdown** details."
        }));

        expect(prompt).toContain("Requirement description:\nUse **markdown** details.");
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
