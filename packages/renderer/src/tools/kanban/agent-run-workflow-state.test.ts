import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KanbanAgentInfo, KanbanCard, PreloadApi } from "@kanban/shared";
import { useAgentRunWorkflowState } from "./agent-run-workflow-state";

type HookInput = Parameters<typeof useAgentRunWorkflowState>[0];

function testCard(patch: Partial<KanbanCard> = {}): KanbanCard {
    return {
        id: "card-1",
        boardId: "board-1",
        columnId: "todo",
        title: "Card",
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

function createApi(input: {
    agents?: KanbanAgentInfo[];
    selectedPath?: string | null;
    validation?: { ok: boolean; message?: string; repoRoot?: string };
} = {}): PreloadApi {
    const agents = input.agents ?? [{ id: "codex", name: "Codex" }];
    return {
        agent: {
            listAvailable: vi.fn(async () => agents),
            selectRepoPath: vi.fn(async () => input.selectedPath ?? null),
            validateRepoPath: vi.fn(async ({ path }) => ({ path, ...(input.validation ?? { ok: true, repoRoot: "/repo" }) })),
            startRun: vi.fn(async ({ agentId }) => ({
                card: testCard(),
                agent: agents.find((agent) => agent.id === agentId) ?? { id: agentId, name: agentId },
                paseoAgentId: "agent-1",
                status: "started" as const,
                summary: "Started Codex"
            }))
        },
        kanban: {} as PreloadApi["kanban"],
        ai: {} as PreloadApi["ai"],
        system: {} as PreloadApi["system"]
    };
}

function renderAgentRunWorkflowState(input: {
    api?: PreloadApi;
    card?: KanbanCard;
    onSave?: HookInput["onSave"];
    onAgentRunComplete?: HookInput["onAgentRunComplete"];
} = {}) {
    const api = input.api ?? createApi();
    const onSave = input.onSave ?? vi.fn().mockResolvedValue(undefined);
    const onAgentRunComplete = input.onAgentRunComplete ?? vi.fn().mockResolvedValue(undefined);
    return {
        api,
        onSave,
        onAgentRunComplete,
        ...renderHook(({ card }) => useAgentRunWorkflowState({
            api,
            card,
            onSave,
            onAgentRunComplete
        }), {
            initialProps: { card: input.card ?? testCard() }
        })
    };
}

async function flushProviderLoad(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}

describe("Agent Run Workflow State", () => {
    it("loads available Agent Providers and selects the first provider", async () => {
        const api = createApi({ agents: [{ id: "codex", name: "Codex" }, { id: "claude", name: "Claude" }] });
        const { result } = renderAgentRunWorkflowState({ api });

        await flushProviderLoad();

        expect(result.current.availableAgents.map((agent) => agent.id)).toEqual(["codex", "claude"]);
        expect(result.current.selectedAgentId).toBe("codex");
    });

    it("validates and saves the normalized Card Binding path", async () => {
        const api = createApi({ validation: { ok: true, repoRoot: "/repo-root" } });
        const onSave = vi.fn().mockResolvedValue(undefined);
        const { result } = renderAgentRunWorkflowState({ api, onSave });

        await act(async () => {
            expect(await result.current.validateBoundRepositoryPath("/input", true)).toBe(true);
        });

        expect(api.agent.validateRepoPath).toHaveBeenCalledWith({ path: "/input" });
        expect(result.current.repositoryPathDraft).toBe("/repo-root");
        expect(result.current.repoValidation).toMatchObject({ ok: true, repoRoot: "/repo-root" });
        expect(onSave).toHaveBeenCalledWith("card-1", { gitRepositoryPath: "/repo-root" });
    });

    it("blocks Agent Run start when repository validation fails", async () => {
        const api = createApi({ validation: { ok: false, message: "Not a Git repository" } });
        const onAgentRunComplete = vi.fn();
        const { result } = renderAgentRunWorkflowState({
            api,
            card: testCard({ gitRepositoryPath: "/bad" }),
            onAgentRunComplete
        });

        await flushProviderLoad();
        await act(async () => {
            await result.current.startAgentRun();
        });

        expect(api.agent.validateRepoPath).toHaveBeenCalledWith({ path: "/bad" });
        expect(api.agent.startRun).not.toHaveBeenCalled();
        expect(onAgentRunComplete).not.toHaveBeenCalled();
        expect(result.current.agentRunBusy).toBe(false);
        expect(result.current.repoValidation).toMatchObject({ ok: false, message: "Not a Git repository" });
    });

    it("validates and saves the Card Binding before starting an Agent Run", async () => {
        const api = createApi({ validation: { ok: true, repoRoot: "/repo-root" } });
        const onSave = vi.fn().mockResolvedValue(undefined);
        const onAgentRunComplete = vi.fn().mockResolvedValue(undefined);
        const { result } = renderAgentRunWorkflowState({
            api,
            card: testCard({ gitRepositoryPath: "/input" }),
            onSave,
            onAgentRunComplete
        });

        await flushProviderLoad();
        await act(async () => {
            await result.current.startAgentRun();
        });

        expect(onSave).toHaveBeenCalledWith("card-1", { gitRepositoryPath: "/repo-root" });
        expect(api.agent.startRun).toHaveBeenCalledWith({ cardId: "card-1", agentId: "codex" });
        expect(onAgentRunComplete).toHaveBeenCalled();
        expect(result.current.agentRunMessage).toBe("Started Codex. Start comment added with Paseo run details.");
    });

    it("resets draft status when the active Card changes", async () => {
        const api = createApi({ validation: { ok: true, repoRoot: "/repo-root" } });
        const { result, rerender } = renderAgentRunWorkflowState({
            api,
            card: testCard({ id: "card-1", gitRepositoryPath: "/first" })
        });

        await act(async () => {
            await result.current.validateBoundRepositoryPath("/input", false);
        });
        act(() => {
            result.current.updateRepositoryPathDraft("/dirty");
        });
        rerender({ card: testCard({ id: "card-2", gitRepositoryPath: "/second" }) });

        expect(result.current.repositoryPathDraft).toBe("/second");
        expect(result.current.repoValidation).toBeNull();
        expect(result.current.agentRunMessage).toBe("");
    });
});
