import type { MaestroMemoryStore, MemoryTarget } from './store.ts';
import { type FeedbackSentiment } from './feedback.ts';
export interface BatchEntryInput {
    target: MemoryTarget | string;
    content: string;
    /** Working directory for project/key tracks. */
    cwd?: string;
    /** Explicit day for daily track (YYYY-MM-DD). */
    date?: string;
    /** Branch scope csv for key add (e.g. 'main,dev'). */
    branches?: string;
    /** One-line summary for key add (progressive disclosure). */
    summary?: string;
    /** When set, appends the end-of-turn `[Feedback]` line to the stored content. */
    sentiment?: FeedbackSentiment;
    category?: string;
    quote?: string;
    note?: string;
}
export type BatchResult = {
    ok: true;
    ids: (string | undefined)[];
} | {
    ok: false;
    index: number;
    error: string;
};
/**
 * Add several entries sequentially through {@link MaestroMemoryStore.add}.
 *
 * Atomicity contract: storage-level writes stay per-file atomic (existing
 * appendEntryAtomicSync), and the batch wraps them with rollback-on-failure —
 * every entry successfully created earlier in this same call is removed again
 * before reporting the failure index. Removal targets the generated `[id:]`
 * token when the track issues ids (key), otherwise the trimmed content itself;
 * remove()'s unique-match guard turns any ambiguity into a reported rollback
 * failure instead of deleting a wrong entry. Entries detected as duplicates
 * are left untouched (they pre-date this call).
 *
 * Unknown targets are rejected up-front per entry so a typo never writes a
 * stray file mid-batch.
 */
export declare function applyBatch(store: MaestroMemoryStore, entries: BatchEntryInput[]): BatchResult;
//# sourceMappingURL=batch.d.ts.map