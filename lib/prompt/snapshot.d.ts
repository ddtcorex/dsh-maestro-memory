import type { MaestroMemoryStore } from '../memory/store.ts';
export interface SnapshotContext {
    cwd: string | null;
    branch?: string;
    sessionId?: string;
    sessionName?: string;
}
/**
 * Bounded snapshot renderer — contract từ README § System Prompt Snapshot:
 * Header (sessionId/sessionName) + USER + global MEMORY + current-project KEY
 * (branch-filtered) + end-of-turn discipline note.
 * daily và project KHÔNG inject.
 */
export declare function renderSnapshot(store: MaestroMemoryStore, ctx: SnapshotContext): string;
//# sourceMappingURL=snapshot.d.ts.map