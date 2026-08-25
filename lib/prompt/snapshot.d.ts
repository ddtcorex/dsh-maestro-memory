import type { MaestroMemoryStore } from '../memory/store.ts';
export interface SnapshotContext {
    cwd: string | null;
    branch?: string;
    sessionId?: string;
    sessionName?: string;
}
/** Default per-section byte budgets for the snapshot prompt. */
export declare const SNAPSHOT_SECTION_CAPS: {
    readonly memory: 2048;
    readonly user: 4096;
    readonly key: 6144;
};
export type SnapshotSectionKey = keyof typeof SNAPSHOT_SECTION_CAPS;
export interface SnapshotRenderOpts {
    /** Partial override of {@link SNAPSHOT_SECTION_CAPS}; unspecified sections keep defaults. */
    caps?: Partial<Record<SnapshotSectionKey, number>>;
}
/**
 * Bounded snapshot renderer — contract từ README § System Prompt Snapshot:
 * Header (sessionId/sessionName) + USER + global MEMORY + current-project KEY
 * (branch-filtered) + end-of-turn discipline note.
 * daily và project KHÔNG inject.
 */
export declare function renderSnapshot(store: MaestroMemoryStore, ctx: SnapshotContext, opts?: SnapshotRenderOpts): string;
//# sourceMappingURL=snapshot.d.ts.map