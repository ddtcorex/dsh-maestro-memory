/**
 * memory/store.ts — MaestroMemoryStore for five tracks (memory/user/daily/project/key)
 * with date/content query, unique replace/remove, archive-before-delete,
 * branch filter, summary/expand. Uses storage/layout + storage/atomic-store.
 */
export type MemoryTarget = 'memory' | 'global' | 'user' | 'project' | 'key' | 'daily';
export type MemoryAction = 'add' | 'list' | 'replace' | 'remove' | 'archive' | 'expand';
export interface ListOpts {
    filter?: string;
    since?: string;
    until?: string;
    limit?: number;
    recent?: boolean;
    branch?: string;
    archived?: boolean;
    date?: string;
}
export declare class MaestroMemoryStore {
    private readonly memoryDir;
    constructor(memoryDir?: string | null);
    private root;
    private assertNotBlocked;
    private fileFor;
    private archiveFileFor;
    private applyBranchTag;
    private applySummaryTag;
    private ensureId;
    /** List entries with optional query filters */
    list(target: MemoryTarget, cwd?: string, opts?: ListOpts): string[];
    private filterEntries;
    /** Add entry (with optional branches/summary for key) */
    add(target: MemoryTarget, entry: string, cwd?: string, opts?: {
        branches?: string;
        summary?: string;
        date?: string;
    }): {
        ok: true;
        duplicate?: boolean;
        id?: string;
    } | {
        ok: false;
        error: string;
    };
    /** Replace unique entry matching substring */
    replace(target: MemoryTarget, match: string, newContent: string, cwd?: string): {
        ok: true;
    } | {
        ok: false;
        error: string;
        matches?: string[];
    };
    /** Remove unique entry matching substring */
    remove(target: MemoryTarget, match: string, cwd?: string): {
        ok: true;
        removed?: string;
    } | {
        ok: false;
        error: string;
        matches?: string[];
    };
    /** Archive-before-delete: move entry to archive then remove from main */
    archive(target: MemoryTarget, match: string, cwd?: string): {
        ok: true;
    } | {
        ok: false;
        error: string;
    };
    /** List archive entries (with optional query) */
    listArchive(target: MemoryTarget, cwd?: string, opts?: ListOpts): string[];
    /** Expand: load full entry by id for key (summary/expand) */
    expand(target: MemoryTarget, id: string, cwd?: string): {
        ok: true;
        entry: string;
    } | {
        ok: false;
        error: string;
    };
    /** Get summary for display (explicit summary or auto) */
    summaryFor(entry: string): string;
    listGlobal(): string[];
    listUser(): string[];
    listKey(cwd: string, opts?: ListOpts): string[];
    listDaily(cwd?: string, date?: string, opts?: ListOpts): string[];
    listProject(cwd: string, opts?: ListOpts): string[];
    addGlobal(entry: string): {
        ok: true;
        duplicate?: boolean;
    } | {
        ok: false;
        error: string;
    };
    addUser(entry: string): {
        ok: true;
        duplicate?: boolean;
    } | {
        ok: false;
        error: string;
    };
    addKey(cwd: string, entry: string, opts?: {
        branches?: string;
        summary?: string;
    }): {
        ok: true;
        duplicate?: boolean;
        id?: string;
    } | {
        ok: false;
        error: string;
    };
    addDaily(entry: string, date?: string): {
        ok: true;
        duplicate?: boolean;
    } | {
        ok: false;
        error: string;
    };
    addProject(cwd: string, entry: string): {
        ok: true;
        duplicate?: boolean;
    } | {
        ok: false;
        error: string;
    };
    /** Bounded snapshot: memory + user + key (branch-filtered), excludes project/daily */
    snapshot(cwd: string | null, opts?: {
        branch?: string;
    }): string;
    /** Snapshot that respects branch filter (same as above, explicit) */
    snapshotForBranch(cwd: string | null, branch?: string): string;
}
export declare class MaestroArchiveStore {
    private readonly memoryDir;
    constructor(memoryDir?: string | null);
    private root;
    fileFor(target: MemoryTarget, cwd?: string): string;
    entries(target: MemoryTarget, cwd?: string): string[];
    append(target: MemoryTarget, content: string, cwd?: string): {
        ok: true;
    } | {
        ok: false;
        error: string;
    };
    remove(target: MemoryTarget, match: string, cwd?: string): {
        ok: true;
    } | {
        ok: false;
        error: string;
    };
}
//# sourceMappingURL=store.d.ts.map