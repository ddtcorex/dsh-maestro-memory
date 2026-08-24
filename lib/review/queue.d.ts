/**
 * review/queue.ts — SuggestionQueue for M2-PR-B confirmation queue
 * Durable JSONL queue SUGGESTIONS.jsonl, gated memory_suggest and explicit RPC decisions.
 * Handles append/dedupe/edited approval/reject/archive/malformed JSONL/recovery.
 */
export interface SuggestionEntry {
    time: string;
    target: string;
    content: string;
    reason: string;
    cwd?: string | null;
    sessionId?: string | null;
    hits?: number;
    firstSeen?: string;
    lastSeen?: string;
}
export declare function normalizeWhitespace(text: string): string;
/**
 * SuggestionQueue — durable JSONL queue with malformed recovery and dedupe.
 */
export declare class SuggestionQueue {
    private readonly file;
    constructor(file: string);
    static fromRoot(memoryDir: string | null, file?: string): SuggestionQueue;
    /** Read all suggestions; missing file -> [], malformed lines skipped. */
    read(): SuggestionEntry[];
    /** Atomically write full list (same-directory lock, temp+rename). */
    write(entries: SuggestionEntry[]): void;
    /** Append one suggestion with dedupe (same target+normalized content bumps hits). */
    append(entry: SuggestionEntry): {
        ok: true;
        queued: number;
        deduped?: boolean;
        hits?: number;
    };
    /** Mutate under lock; fn may edit entries in place. Writes back after fn. */
    mutate<T>(fn: (entries: SuggestionEntry[]) => T): T;
    /** Alias for read */
    list(): SuggestionEntry[];
    private readUnsafe;
    private writeUnsafe;
}
/** Enqueue helper with dedupe, used by memory_suggest tool */
export declare function enqueueSuggestion(queue: SuggestionQueue, target: string, content: string, reason: string, agent?: {
    id?: string;
    session?: {
        header?: {
            cwd?: string | null;
        };
    };
}): {
    ok: boolean;
    message?: string;
    queued: number;
    hits?: number;
};
/** Approve suggestions by 1-based indices, supports edited content and target override */
export declare function approveSuggestions(store: any, todoStore: any, queue: SuggestionQueue, indices: number[], agent?: any, edits?: Map<number, string>, targets?: Map<number, string>, options?: {
    isTodoEnabled?: () => boolean;
}): {
    lines: string[];
    remaining: number;
};
export declare function rejectSuggestions(queue: SuggestionQueue, indices: number[]): {
    removed: number;
    remaining: number;
};
export declare function archiveSuggestions(archive: any, queue: SuggestionQueue, indices: number[]): {
    lines: string[];
    remaining: number;
};
//# sourceMappingURL=queue.d.ts.map