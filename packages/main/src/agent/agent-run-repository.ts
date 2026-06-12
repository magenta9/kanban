import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type AgentRunStatus = "running" | "finished" | "recovery_failed";
export type AgentRunOutcome = "unknown" | "completed" | "failed";

export interface AgentRunRecord {
    id: string;
    cardId: string;
    paseoAgentId: string;
    providerId: string;
    providerName: string;
    modeLabel?: string;
    repoRoot: string;
    worktreeName: string;
    status: AgentRunStatus;
    outcome: AgentRunOutcome;
    lastError?: string;
    startedAt: number;
    finishedAt?: number;
    createdAt: number;
    updatedAt: number;
}

export interface CreateAgentRunRecordInput {
    cardId: string;
    paseoAgentId: string;
    providerId: string;
    providerName: string;
    modeLabel?: string;
    repoRoot: string;
    worktreeName: string;
    now?: number;
}

interface AgentRunRow {
    id: string;
    card_id: string;
    paseo_agent_id: string;
    provider_id: string;
    provider_name: string;
    mode_label: string | null;
    repo_root: string;
    worktree_name: string;
    status: AgentRunStatus;
    outcome: AgentRunOutcome;
    last_error: string | null;
    started_at: number;
    finished_at: number | null;
    created_at: number;
    updated_at: number;
}

export class AgentRunRepository {
    constructor(private readonly database: Database.Database) { }

    transaction<T>(operation: () => T): T {
        return this.database.transaction(operation)();
    }

    create(input: CreateAgentRunRecordInput): AgentRunRecord {
        const now = input.now ?? Date.now();
        const record: AgentRunRecord = {
            id: randomUUID(),
            cardId: input.cardId,
            paseoAgentId: normalizeText(input.paseoAgentId, "Paseo agent id is required."),
            providerId: normalizeText(input.providerId, "Provider id is required."),
            providerName: normalizeText(input.providerName, "Provider name is required."),
            modeLabel: optionalText(input.modeLabel),
            repoRoot: normalizeText(input.repoRoot, "Repository root is required."),
            worktreeName: normalizeText(input.worktreeName, "Worktree name is required."),
            status: "running",
            outcome: "unknown",
            startedAt: now,
            createdAt: now,
            updatedAt: now
        };
        this.database
            .prepare(
                `INSERT INTO agent_runs
                 (id, card_id, paseo_agent_id, provider_id, provider_name, mode_label, repo_root, worktree_name, status, outcome, last_error, started_at, finished_at, created_at, updated_at)
                 VALUES
                 (@id, @cardId, @paseoAgentId, @providerId, @providerName, @modeLabel, @repoRoot, @worktreeName, @status, @outcome, @lastError, @startedAt, @finishedAt, @createdAt, @updatedAt)`
            )
            .run(toParams(record));
        return record;
    }

    findRunningByCard(cardId: string): AgentRunRecord | null {
        const row = this.database.prepare("SELECT * FROM agent_runs WHERE card_id = ? AND status = 'running' LIMIT 1").get(cardId) as AgentRunRow | undefined;
        return row ? rowToAgentRun(row) : null;
    }

    listRunning(): AgentRunRecord[] {
        const rows = this.database.prepare("SELECT * FROM agent_runs WHERE status = 'running' ORDER BY started_at ASC").all() as AgentRunRow[];
        return rows.map(rowToAgentRun);
    }

    markFinished(input: { id: string; outcome: Exclude<AgentRunOutcome, "unknown">; lastError?: string; now?: number }): AgentRunRecord {
        return this.updateTerminal({
            id: input.id,
            status: "finished",
            outcome: input.outcome,
            lastError: input.lastError,
            now: input.now
        });
    }

    markRecoveryFailed(input: { id: string; lastError: string; now?: number }): AgentRunRecord {
        return this.updateTerminal({
            id: input.id,
            status: "recovery_failed",
            outcome: "failed",
            lastError: input.lastError,
            now: input.now
        });
    }

    recordTransientFailure(input: { id: string; lastError: string; now?: number }): AgentRunRecord {
        const now = input.now ?? Date.now();
        this.database
            .prepare("UPDATE agent_runs SET last_error = ?, updated_at = ? WHERE id = ?")
            .run(input.lastError, now, input.id);
        return this.require(input.id);
    }

    delete(input: { id: string }): void {
        this.database.prepare("DELETE FROM agent_runs WHERE id = ?").run(input.id);
    }

    require(id: string): AgentRunRecord {
        const row = this.database.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as AgentRunRow | undefined;
        if (!row) {
            throw new Error(`Agent Run record not found: ${id}`);
        }
        return rowToAgentRun(row);
    }

    private updateTerminal(input: { id: string; status: AgentRunStatus; outcome: AgentRunOutcome; lastError?: string; now?: number }): AgentRunRecord {
        const now = input.now ?? Date.now();
        this.database
            .prepare(
                `UPDATE agent_runs
                 SET status = ?, outcome = ?, last_error = ?, finished_at = ?, updated_at = ?
                 WHERE id = ?`
            )
            .run(input.status, input.outcome, input.lastError ?? null, now, now, input.id);
        return this.require(input.id);
    }
}

function normalizeText(value: string, message: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(message);
    }
    return trimmed;
}

function optionalText(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed || undefined;
}

function toParams(record: AgentRunRecord): Record<string, string | number | null> {
    return {
        id: record.id,
        cardId: record.cardId,
        paseoAgentId: record.paseoAgentId,
        providerId: record.providerId,
        providerName: record.providerName,
        modeLabel: record.modeLabel ?? null,
        repoRoot: record.repoRoot,
        worktreeName: record.worktreeName,
        status: record.status,
        outcome: record.outcome,
        lastError: record.lastError ?? null,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
    };
}

function rowToAgentRun(row: AgentRunRow): AgentRunRecord {
    return {
        id: row.id,
        cardId: row.card_id,
        paseoAgentId: row.paseo_agent_id,
        providerId: row.provider_id,
        providerName: row.provider_name,
        modeLabel: row.mode_label ?? undefined,
        repoRoot: row.repo_root,
        worktreeName: row.worktree_name,
        status: row.status,
        outcome: row.outcome,
        lastError: row.last_error ?? undefined,
        startedAt: row.started_at,
        finishedAt: row.finished_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
