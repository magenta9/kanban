import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { ICloudAccountStatus } from "@kanban/shared";

export interface CloudKitHelperClientOptions {
    helperPath: string;
    requestTimeoutMs?: number;
}

interface HelperRequest {
    id: string;
    command: string;
    payload: {
        containerIdentifier: string;
        zoneName: string;
        changes?: LocalSyncChange[];
    };
}

interface HelperResponse<Result> {
    id: string;
    ok: boolean;
    result?: Result;
    error?: string;
}

interface AccountStatusResult {
    accountStatus: ICloudAccountStatus;
}

interface EnsureZoneResult extends AccountStatusResult {
    zoneReady: boolean;
    zoneName: string;
}

interface SyncNowResult extends EnsureZoneResult {
    pushedChangeCount: number;
    pulledChangeCount: number;
    acknowledgedOutboxIds: string[];
    records: RemoteSyncRecord[];
}

export interface LocalSyncChange {
    outboxId: string;
    entityType: string;
    entityId: string;
    operation: "save" | "delete";
    fields?: Record<string, unknown>;
}

export interface RemoteSyncRecord {
    entityType: string;
    entityId: string;
    deleted: boolean;
    payloadJson: string;
    modifiedAtMillis: number;
}

interface PendingRequest {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
}

const defaultRequestTimeoutMs = 10_000;
const defaultContainerIdentifier = "iCloud.com.magenta9.kanban";
const defaultZoneName = "KanbanZone";

export class CloudKitHelperClient {
    private child: ChildProcessWithoutNullStreams | undefined;
    private lines: Interface | undefined;
    private readonly pending = new Map<string, PendingRequest>();

    constructor(private readonly options: CloudKitHelperClientOptions) { }

    async getAccountStatus(): Promise<AccountStatusResult> {
        if (!existsSync(this.options.helperPath)) {
            return { accountStatus: "unavailable" };
        }
        return await this.send<AccountStatusResult>("accountStatus");
    }

    async ensureZone(): Promise<EnsureZoneResult> {
        return await this.send<EnsureZoneResult>("ensureZone");
    }

    async syncNow(changes: LocalSyncChange[]): Promise<SyncNowResult> {
        return await this.send<SyncNowResult>("syncNow", changes);
    }

    dispose(): void {
        this.lines?.close();
        this.lines = undefined;
        this.child?.kill();
        this.child = undefined;
        for (const [id, request] of this.pending.entries()) {
            clearTimeout(request.timer);
            request.reject(new Error("CloudKit helper stopped."));
            this.pending.delete(id);
        }
    }

    private async send<Result>(command: string, changes?: LocalSyncChange[]): Promise<Result> {
        const child = this.ensureProcess();
        const id = randomUUID();
        const request: HelperRequest = {
            id,
            command,
            payload: {
                containerIdentifier: defaultContainerIdentifier,
                zoneName: defaultZoneName,
                changes
            }
        };

        return await new Promise<Result>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CloudKit helper request timed out: ${command}`));
            }, this.options.requestTimeoutMs ?? defaultRequestTimeoutMs);
            this.pending.set(id, {
                resolve: (value) => resolve(value as Result),
                reject,
                timer
            });
            child.stdin.write(`${JSON.stringify(request)}\n`);
        });
    }

    private ensureProcess(): ChildProcessWithoutNullStreams {
        if (this.child) return this.child;
        if (!existsSync(this.options.helperPath)) {
            throw new Error(`CloudKit helper not found: ${this.options.helperPath}`);
        }

        this.child = spawn(this.options.helperPath, [], {
            stdio: ["pipe", "pipe", "pipe"]
        });
        this.lines = createInterface({ input: this.child.stdout });
        this.lines.on("line", (line) => this.handleLine(line));
        this.child.stderr.on("data", (chunk: Buffer) => {
            const message = chunk.toString("utf8").trim();
            if (message) this.rejectAll(new Error(message));
        });
        this.child.once("exit", () => {
            this.child = undefined;
            this.lines?.close();
            this.lines = undefined;
            this.rejectAll(new Error("CloudKit helper exited."));
        });
        return this.child;
    }

    private handleLine(line: string): void {
        const response = JSON.parse(line) as HelperResponse<unknown>;
        const request = this.pending.get(response.id);
        if (!request) return;
        this.pending.delete(response.id);
        clearTimeout(request.timer);
        if (response.ok) {
            request.resolve(response.result);
        } else {
            request.reject(new Error(response.error ?? "CloudKit helper request failed."));
        }
    }

    private rejectAll(error: Error): void {
        for (const [id, request] of this.pending.entries()) {
            clearTimeout(request.timer);
            request.reject(error);
            this.pending.delete(id);
        }
    }
}

export function resolveCloudKitHelperPath(appPath: string, resourcesPath: string, isPackaged: boolean): string {
    return isPackaged ? join(resourcesPath, "KanbanCloudKitHelper") : join(appPath, "native/cloudkit-helper/dist/KanbanCloudKitHelper");
}