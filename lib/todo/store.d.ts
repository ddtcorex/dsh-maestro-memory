/**
 * todo/store.ts — TodoStore for M3-PR-A
 * Four tracks (life/work/project/daily), IDs, status/due/quadrant updates,
 * overdue/today/current-project smart view (limit 8), done timestamp,
 * historical daily lookup (past + expired).
 *
 * File format: HTML comment header + §-delimited entries, each entry:
 *   [YYYY-MM-DD HH:MM] [id:xxxxxxxx] [q1-q4] [due:YYYY-MM-DD] [status:...] [cat:...] [done:...]\ncontent
 * Tracks:
 *   life  TODOS-life.md
 *   work  TODOS-work.md
 *   project projects/<hash>/TODOS.md (cwd-isolated)
 *   daily daily/YYYY-MM-DD.todo.md (separate from daily log)
 */
import { TODO_TARGETS, TODO_STATUSES } from '../storage/legacy-format.ts';
export type TodoTarget = (typeof TODO_TARGETS)[number];
export type TodoStatus = (typeof TODO_STATUSES)[number];
export type TodoQuadrant = 'q1' | 'q2' | 'q3' | 'q4';
export declare const DEFAULT_VIEW_LIMIT = 8;
/** Local date YYYY-MM-DD (local time, not UTC) */
export declare function todayStamp(): string;
export interface TodoItem {
    id: string | null;
    time: string;
    quadrant: string | null;
    due: string | null;
    status: string;
    doneAt: string | null;
    cat: string | null;
    text: string;
    raw: string;
    target?: TodoTarget;
    day?: string;
    past?: boolean;
}
export interface TodoInput {
    content: string;
    due?: string | null;
    quadrant?: string | null;
    cat?: string | null;
    status?: string;
}
export declare class TodoStore {
    private readonly memoryDir;
    constructor(memoryDir?: string | null);
    private root;
    /** Resolve one track's file path; project requires cwd, daily honors date */
    private pathFor;
    /** Read raw text; missing -> '' */
    private readText;
    /** Parse raw text into items (strip header comment) */
    private parseAll;
    /** All items of one track (daily: honors date, default today) */
    itemsOf(target: TodoTarget, cwd?: string, date?: string): TodoItem[];
    /** All past daily items: every daily file before today, newest day first, each tagged day+past */
    pastItemsOf(today?: string): TodoItem[];
    private assertNotBlocked;
    /** Atomically write one track's items (header + entries) under directory lock */
    private write;
    /** M1 compat: list parsed entries for one track */
    list(target: TodoTarget, cwd?: string, date?: string): TodoItem[];
    /** M1 compat: add via {content,due,quadrant,cat} */
    add(target: TodoTarget, input: TodoInput, cwd?: string): {
        ok: true;
        id: string;
    } | {
        ok: false;
        error: string;
    };
    /** M1 smartView compat: delegates to listTodos default view for single track */
    smartView(target: TodoTarget, cwd?: string): TodoItem[];
    addTodo(target: TodoTarget, content: string, meta?: {
        quadrant?: string | null;
        due?: string | null;
        cat?: string | null;
    }, cwd?: string): {
        ok: true;
        message: string;
        id: string;
        target: string;
    } | {
        ok: false;
        message: string;
        target: string;
    };
    findById(target: TodoTarget | undefined, id: string, cwd?: string, date?: string): {
        target: TodoTarget;
        item: TodoItem;
        items: TodoItem[];
        day?: string;
    } | null;
    updateTodo(target: TodoTarget | undefined, id: string, patch: {
        status?: string;
        quadrant?: string | null;
        due?: string | null;
        cat?: string | null;
        content?: string;
    }, cwd?: string, date?: string): {
        ok: boolean;
        message: string;
        target: string;
    };
    doneTodo(target: TodoTarget | undefined, id: string, cwd?: string, date?: string): {
        ok: boolean;
        message: string;
        target: string;
    };
    removeTodo(target: TodoTarget | undefined, id: string, cwd?: string, date?: string): {
        ok: boolean;
        message: string;
        target: string;
    };
    listTodos(targets: TodoTarget[], options?: {
        status?: string;
        quadrant?: string;
        due?: string;
        cat?: string;
        date?: string;
        all?: boolean;
        past?: boolean;
        expired?: boolean;
    }, cwd?: string, today?: string): {
        items: TodoItem[];
        total: number;
        truncated: boolean;
        defaultView: boolean;
        hint: string | null;
    };
    formatList(result: {
        items: TodoItem[];
        total: number;
        truncated: boolean;
        defaultView: boolean;
        hint: string | null;
    }, today?: string): string;
}
export declare function resolveQuadrant(args: {
    quadrant?: string;
    important?: boolean;
    urgent?: boolean;
}): string | null;
//# sourceMappingURL=store.d.ts.map