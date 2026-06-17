import { useCallback, useEffect, useState } from "react";
import type { KanbanAgentInfo, KanbanCard, KanbanCardPatch, PreloadApi } from "@kanban/shared";

interface RepositoryValidationState {
    ok: boolean;
    message: string;
    repoRoot?: string;
}

interface AgentRunWorkflowState {
    repositoryPathDraft: string;
    repoValidation: RepositoryValidationState | null;
    availableAgents: KanbanAgentInfo[];
    selectedAgentId: string;
    agentRunMessage: string;
    agentRunBusy: boolean;
    updateRepositoryPathDraft: (value: string) => void;
    setSelectedAgentId: (value: string) => void;
    validateBoundRepositoryPath: (path?: string, save?: boolean) => Promise<boolean>;
    chooseAgentRepoPath: () => Promise<void>;
    startAgentRun: () => Promise<void>;
}

export function useAgentRunWorkflowState({
    api,
    card,
    onSave,
    onAgentRunComplete
}: {
    api: PreloadApi;
    card: KanbanCard;
    onSave: (cardId: string, patch: Partial<KanbanCardPatch>) => Promise<void>;
    onAgentRunComplete: () => Promise<void>;
}): AgentRunWorkflowState {
    const [repositoryPathDraft, setRepositoryPathDraft] = useState(card.gitRepositoryPath ?? "");
    const [repoValidation, setRepoValidation] = useState<RepositoryValidationState | null>(null);
    const [availableAgents, setAvailableAgents] = useState<KanbanAgentInfo[]>([]);
    const [selectedAgentId, setSelectedAgentId] = useState("");
    const [agentRunMessage, setAgentRunMessage] = useState("");
    const [agentRunBusy, setAgentRunBusy] = useState(false);

    useEffect(() => {
        setRepositoryPathDraft(card.gitRepositoryPath ?? "");
        setRepoValidation(null);
        setAgentRunMessage("");
    }, [card.id, card.gitRepositoryPath]);

    useEffect(() => {
        let cancelled = false;
        void api.agent.listAvailable().then((agents) => {
            if (cancelled) return;
            setAvailableAgents(agents);
            setSelectedAgentId((current) => current && agents.some((agent) => agent.id === current) ? current : agents[0]?.id ?? "");
        }).catch((caught) => {
            if (cancelled) return;
            setAvailableAgents([]);
            setSelectedAgentId("");
            setAgentRunMessage(errorMessage(caught));
        });
        return () => {
            cancelled = true;
        };
    }, [api]);

    const validateBoundRepositoryPath = useCallback(async (path = repositoryPathDraft.trim(), save = false): Promise<boolean> => {
        if (!path) {
            setRepoValidation(null);
            if (save && card.gitRepositoryPath) {
                await onSave(card.id, { gitRepositoryPath: null });
            }
            return false;
        }
        try {
            const result = await api.agent.validateRepoPath({ path });
            const message = result.ok ? `Repository ready: ${result.repoRoot ?? result.path}` : result.message ?? "This folder is not a Git repository.";
            setRepoValidation({ ok: result.ok, message, repoRoot: result.repoRoot });
            if (result.ok && save) {
                const nextPath = result.repoRoot ?? result.path;
                setRepositoryPathDraft(nextPath);
                await onSave(card.id, { gitRepositoryPath: nextPath });
            }
            return result.ok;
        } catch (caught) {
            setRepoValidation({ ok: false, message: errorMessage(caught) });
            return false;
        }
    }, [api, card.gitRepositoryPath, card.id, onSave, repositoryPathDraft]);

    const chooseAgentRepoPath = useCallback(async (): Promise<void> => {
        const path = await api.agent.selectRepoPath();
        if (!path) return;
        setRepositoryPathDraft(path);
        setAgentRunMessage("");
        void validateBoundRepositoryPath(path, true);
    }, [api, validateBoundRepositoryPath]);

    const startAgentRun = useCallback(async (): Promise<void> => {
        if (!selectedAgentId || agentRunBusy) return;
        setAgentRunBusy(true);
        setAgentRunMessage("Starting Paseo agent...");
        try {
            const valid = await validateBoundRepositoryPath(repositoryPathDraft.trim(), true);
            if (!valid) return;
            const result = await api.agent.startRun({
                cardId: card.id,
                agentId: selectedAgentId
            });
            setAgentRunMessage(`Started ${result.agent.name}. Start comment added with Paseo run details.`);
            await onAgentRunComplete();
        } catch (caught) {
            setAgentRunMessage(errorMessage(caught));
        } finally {
            setAgentRunBusy(false);
        }
    }, [agentRunBusy, api, card.id, onAgentRunComplete, repositoryPathDraft, selectedAgentId, validateBoundRepositoryPath]);

    return {
        repositoryPathDraft,
        repoValidation,
        availableAgents,
        selectedAgentId,
        agentRunMessage,
        agentRunBusy,
        updateRepositoryPathDraft: (value) => {
            setRepositoryPathDraft(value);
            setRepoValidation(null);
        },
        setSelectedAgentId,
        validateBoundRepositoryPath,
        chooseAgentRepoPath,
        startAgentRun
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
