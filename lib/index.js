/**
 * dsh-maestro-memory — host entry (M2-PR-B: confirmation queue, gated memory_suggest, RPC decide, Review UI)
 */
import { MaestroMemoryStore } from "./memory/store.js";
import { TodoStore, resolveQuadrant } from "./todo/store.js";
import { TODO_TARGETS, TODO_STATUSES } from "./storage/legacy-format.js";
import { SuggestionQueue, enqueueSuggestion, approveSuggestions, rejectSuggestions } from "./review/queue.js";
import { resolveMemoryRoot, suggestionsPath, globalArchivePath, userArchivePath, projectKeyArchivePath, todoArchivePath } from "./storage/layout.js";
import { appendEntryAtomicSync } from "./storage/atomic-store.js";
import * as migration from "./migration/service.js";
export const inject = ['tools', 'systemPrompt', 'workspaceRegistry', 'connection'];
export const DEFAULTS = {
    memoryDir: null,
    snapshotOrder: 500,
};
export function apply(ctx, config = {}) {
    const order = config.snapshotOrder ?? DEFAULTS.snapshotOrder;
    const store = new MaestroMemoryStore(config.memoryDir ?? null);
    const todoStore = new TodoStore(config.memoryDir ?? null);
    const root = resolveMemoryRoot(config.memoryDir ?? null);
    const queue = new SuggestionQueue(suggestionsPath(root));
    ctx.effect(() => {
        const dispose = ctx.systemPrompt.context({
            name: 'memory:snapshot',
            order,
            text: (promptCtx) => {
                const cwd = promptCtx?.agent?.session?.header?.cwd ?? null;
                const branch = promptCtx?.agent?.session?.header?.branch ?? undefined;
                return store.snapshot(cwd, branch ? { branch } : {});
            },
        });
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: snapshot');
    ctx.effect(() => {
        const tool = {
            name: 'memory',
            description: 'Maestro memory (M2: five tracks, query, replace/remove, archive, branch, summary/expand)',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['add', 'list', 'replace', 'remove', 'archive', 'expand'],
                        description: 'Memory action',
                    },
                    target: {
                        type: 'string',
                        enum: ['memory', 'user', 'project', 'key', 'daily'],
                        description: 'Memory track (daily=YYYY-MM-DD file, project=per-cwd log, key=per-cwd long-term)',
                    },
                    content: { type: 'string', description: 'Entry content (add) or new content (replace)' },
                    match: { type: 'string', description: 'Unique substring identifying entry (replace/remove/archive)' },
                    filter: { type: 'string', description: 'Content substring filter (list)' },
                    since: { type: 'string', description: 'Start date YYYY-MM-DD (list)' },
                    until: { type: 'string', description: 'End date YYYY-MM-DD (list)' },
                    limit: { type: 'integer', description: 'Max entries (list)' },
                    recent: { type: 'boolean', description: 'Newest first (list)' },
                    branch: { type: 'string', description: 'Branch filter for key (list)' },
                    branches: { type: 'string', description: 'Branch scope csv for key add, e.g. main,dev (empty=all)' },
                    summary: { type: 'string', description: 'One-line summary for key add (progressive disclosure)' },
                    id: { type: 'string', description: 'Entry id for expand (key)' },
                    archived: { type: 'boolean', description: 'Query archive files (list)' },
                    cwd: { type: 'string', description: 'Working directory for project/key tracks' },
                    date: { type: 'string', description: 'Date YYYY-MM-DD for daily track' },
                },
                required: ['action', 'target'],
            },
            execute: async (args, exec) => {
                const target = args.target;
                const action = args.action;
                const cwd = args.cwd ?? exec?.agent?.session?.header?.cwd;
                try {
                    switch (action) {
                        case 'add': {
                            const res = store.add(target, args.content ?? '', cwd, {
                                branches: args.branches,
                                summary: args.summary,
                            });
                            if (!res.ok)
                                return { content: [{ type: 'text', text: `add failed: ${res.error}` }] };
                            return { content: [{ type: 'text', text: res.duplicate ? 'duplicate' : `added to ${target}` }] };
                        }
                        case 'list': {
                            const entries = store.list(target, cwd, {
                                filter: args.filter,
                                since: args.since,
                                until: args.until,
                                limit: args.limit,
                                recent: args.recent,
                                branch: args.branch,
                                archived: args.archived,
                            });
                            const text = entries.length ? entries.join('\n---\n') : '(no entries)';
                            return { content: [{ type: 'text', text }] };
                        }
                        case 'replace': {
                            const res = store.replace(target, args.match ?? '', args.content ?? '', cwd);
                            if (!res.ok)
                                return { content: [{ type: 'text', text: `replace failed: ${res.error}` }] };
                            return { content: [{ type: 'text', text: 'replaced' }] };
                        }
                        case 'remove': {
                            const res = store.remove(target, args.match ?? '', cwd);
                            if (!res.ok)
                                return { content: [{ type: 'text', text: `remove failed: ${res.error}` }] };
                            return { content: [{ type: 'text', text: 'removed' }] };
                        }
                        case 'archive': {
                            const res = store.archive(target, args.match ?? '', cwd);
                            if (!res.ok)
                                return { content: [{ type: 'text', text: `archive failed: ${res.error}` }] };
                            return { content: [{ type: 'text', text: 'archived' }] };
                        }
                        case 'expand': {
                            const res = store.expand(target, args.id ?? '', cwd);
                            if (!res.ok)
                                return { content: [{ type: 'text', text: `expand failed: ${res.error}` }] };
                            return { content: [{ type: 'text', text: res.entry }] };
                        }
                        default:
                            return { content: [{ type: 'text', text: `unknown action ${action}` }] };
                    }
                }
                catch (e) {
                    return { content: [{ type: 'text', text: `error: ${e?.message ?? String(e)}` }] };
                }
            },
        };
        const dispose = ctx.tools.register(tool);
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: tool');
    // Gated memory_suggest tool — model proposals go to queue, never directly to memory
    ctx.effect(() => {
        const tool = {
            name: 'memory_suggest',
            description: 'Propose memory/todo for confirmation queue (gated, requires user approve). Targets: memory/user/key/todo-*',
            parameters: {
                type: 'object',
                properties: {
                    target: {
                        type: 'string',
                        enum: ['memory', 'user', 'key', 'todo-life', 'todo-work', 'todo-project', 'todo-daily'],
                        description: 'Suggestion target',
                    },
                    content: { type: 'string', description: 'Suggested content' },
                    reason: { type: 'string', description: 'Why it is worth remembering' },
                },
                required: ['target', 'content', 'reason'],
            },
            execute: async (args, exec) => {
                const target = String(args.target ?? '').trim();
                const content = String(args.content ?? '').trim();
                const reason = String(args.reason ?? '').trim();
                const valid = ['memory', 'user', 'key', 'todo-life', 'todo-work', 'todo-project', 'todo-daily'];
                if (!valid.includes(target))
                    return { content: [{ type: 'text', text: `invalid target ${target}` }] };
                if (!content)
                    return { content: [{ type: 'text', text: 'empty content' }] };
                if (!reason)
                    return { content: [{ type: 'text', text: 'empty reason' }] };
                const agent = exec?.agent;
                const res = enqueueSuggestion(queue, target, content, reason, agent);
                if (!res.ok)
                    return { content: [{ type: 'text', text: res.message ?? 'failed' }] };
                const msg = res.hits ? `queued (deduped hits=${res.hits})` : `queued (${res.queued})`;
                return { content: [{ type: 'text', text: msg }] };
            },
        };
        const dispose = ctx.tools.register(tool);
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: suggest-tool');
    // dtodo compatibility tool (four tracks, IDs, status/due/quadrant, smart view, historical lookup)
    ctx.effect(() => {
        const tool = {
            name: 'dtodo',
            description: 'Todos: life/work/project/daily with IDs, status/due/quadrant, smart view (overdue/today/project/Q1-Q2, limit 8), historical daily lookup',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['add', 'list', 'done', 'update', 'remove'], description: 'Todo action' },
                    target: { type: 'string', enum: [...TODO_TARGETS], description: 'Todo track (life/work/project/daily)' },
                    content: { type: 'string', description: 'Todo content (add/update)' },
                    id: { type: 'string', description: 'Todo id (done/update/remove)' },
                    due: { type: 'string', description: 'Due date YYYY-MM-DD' },
                    quadrant: { type: 'string', enum: ['q1', 'q2', 'q3', 'q4'], description: 'Quadrant q1-q4' },
                    important: { type: 'boolean', description: 'Important (maps to quadrant)' },
                    urgent: { type: 'boolean', description: 'Urgent (maps to quadrant)' },
                    cat: { type: 'string', description: 'Category' },
                    status: { type: 'string', enum: [...TODO_STATUSES], description: 'Status for update' },
                    all: { type: 'boolean', description: 'List all (no smart-view limit)' },
                    past: { type: 'boolean', description: 'Include past daily todos' },
                    expired: { type: 'boolean', description: 'Include expired past daily todos (needs past=true)' },
                    cwd: { type: 'string', description: 'Working directory for project track' },
                    date: { type: 'string', description: 'Date YYYY-MM-DD for daily track' },
                },
                required: ['action'],
            },
            execute: async (args, exec) => {
                const action = args.action;
                const cwd = args.cwd ?? exec?.agent?.session?.header?.cwd;
                const dateArg = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
                try {
                    if (action === 'add') {
                        const target = (args.target ?? (cwd ? 'project' : 'work'));
                        if (!TODO_TARGETS.includes(target))
                            return { content: [{ type: 'text', text: `invalid target ${target}` }] };
                        const due = typeof args.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.due) ? args.due : undefined;
                        const cat = typeof args.cat === 'string' && args.cat.trim() !== '' ? args.cat.trim() : undefined;
                        const quadrant = resolveQuadrant({ quadrant: args.quadrant, important: args.important, urgent: args.urgent });
                        const res = todoStore.addTodo(target, String(args.content ?? ''), { quadrant, due, cat }, cwd);
                        if (!res.ok)
                            return { content: [{ type: 'text', text: res.message }] };
                        return { content: [{ type: 'text', text: `${res.message} (id: ${res.id})` }] };
                    }
                    if (action === 'list') {
                        const targets = args.target !== undefined ? [args.target] : [...TODO_TARGETS];
                        const projectCwd = typeof args.cwd === 'string' && args.cwd.trim() !== '' ? args.cwd.trim() : cwd;
                        const result = todoStore.listTodos(targets, {
                            status: args.status,
                            quadrant: args.quadrant,
                            due: args.due,
                            cat: args.cat,
                            all: args.all === true,
                            past: args.past === true,
                            expired: args.expired === true,
                            date: dateArg(args.date),
                        }, projectCwd, dateArg(args.date));
                        const text = todoStore.formatList(result, dateArg(args.date));
                        return { content: [{ type: 'text', text }] };
                    }
                    if (action === 'done') {
                        const id = String(args.id ?? '').trim();
                        if (!id)
                            return { content: [{ type: 'text', text: 'id required' }] };
                        const res = todoStore.doneTodo(args.target, id, cwd, dateArg(args.date));
                        return { content: [{ type: 'text', text: res.message }] };
                    }
                    if (action === 'remove') {
                        const id = String(args.id ?? '').trim();
                        if (!id)
                            return { content: [{ type: 'text', text: 'id required' }] };
                        const res = todoStore.removeTodo(args.target, id, cwd, dateArg(args.date));
                        return { content: [{ type: 'text', text: res.message }] };
                    }
                    if (action === 'update') {
                        const id = String(args.id ?? '').trim();
                        if (!id)
                            return { content: [{ type: 'text', text: 'id required' }] };
                        const patch = {};
                        if (args.status !== undefined)
                            patch.status = args.status;
                        if (args.quadrant !== undefined)
                            patch.quadrant = /^q[1-4]$/.test(args.quadrant) ? args.quadrant : undefined;
                        else if (args.important !== undefined || args.urgent !== undefined) {
                            const q = resolveQuadrant({ important: args.important, urgent: args.urgent });
                            if (q)
                                patch.quadrant = q;
                        }
                        if (args.due !== undefined)
                            patch.due = /^\d{4}-\d{2}-\d{2}$/.test(args.due) ? args.due : null;
                        if (args.cat !== undefined)
                            patch.cat = args.cat === '' ? null : args.cat;
                        if (args.content !== undefined)
                            patch.content = String(args.content);
                        const res = todoStore.updateTodo(args.target, id, patch, cwd, dateArg(args.date));
                        return { content: [{ type: 'text', text: res.message }] };
                    }
                    return { content: [{ type: 'text', text: `unknown action ${action}` }] };
                }
                catch (e) {
                    return { content: [{ type: 'text', text: `error: ${e?.message ?? String(e)}` }] };
                }
            },
        };
        const dispose = ctx.tools.register(tool);
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: dtodo-tool');
    // RPC channel for Review queue — explicit user-click decisions
    ctx.effect(() => {
        const channel = '/dsh-maestro-memory';
        const handler = async (endpoint, payload) => {
            switch (endpoint) {
                case 'queue.list': {
                    const entries = queue.read();
                    return { ok: true, entries };
                }
                case 'queue.decide': {
                    const action = payload?.action;
                    const indices = Array.isArray(payload?.indices) ? payload.indices.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1) : [];
                    if (indices.length === 0)
                        return { ok: false, error: 'indices required' };
                    if (action === 'approve') {
                        const editsRaw = payload?.edits;
                        const targetsRaw = payload?.targets;
                        const edits = editsRaw ? new Map(Object.entries(editsRaw).map(([k, v]) => [Number(k), String(v)])) : undefined;
                        const targets = targetsRaw ? new Map(Object.entries(targetsRaw).map(([k, v]) => [Number(k), String(v)])) : undefined;
                        const agent = payload?.cwd ? { session: { header: { cwd: payload.cwd } } } : undefined;
                        const res = approveSuggestions(store, todoStore, queue, indices, agent, edits, targets);
                        return { ok: true, ...res };
                    }
                    if (action === 'reject') {
                        const res = rejectSuggestions(queue, indices);
                        return { ok: true, ...res };
                    }
                    if (action === 'archive') {
                        const res = queue.mutate((entries) => {
                            const kept = [];
                            const lines = [];
                            entries.forEach((entry, idx) => {
                                const number = idx + 1;
                                if (!indices.includes(number)) {
                                    kept.push(entry);
                                    return;
                                }
                                try {
                                    const stamp = new Date().toISOString().slice(0, 10);
                                    const originTag = entry.target.startsWith('todo-') ? `\n(original track: ${entry.target})` : '';
                                    const stamped = `[${stamp}] ${entry.content}${originTag}${entry.reason ? `\n(archive reason: ${entry.reason})` : ''}`;
                                    let archiveFile = null;
                                    if (entry.target === 'memory')
                                        archiveFile = globalArchivePath(root);
                                    else if (entry.target === 'user')
                                        archiveFile = userArchivePath(root);
                                    else if (entry.target === 'key' && entry.cwd)
                                        archiveFile = projectKeyArchivePath(root, entry.cwd);
                                    else if (entry.target.startsWith('todo-'))
                                        archiveFile = todoArchivePath(root);
                                    if (archiveFile)
                                        appendEntryAtomicSync(archiveFile, stamped);
                                    lines.push(`#${number} [${entry.target}] archived`);
                                }
                                catch (e) {
                                    lines.push(`✗ #${number} [${entry.target}] ${e?.message ?? String(e)}`);
                                    kept.push(entry);
                                }
                            });
                            entries.length = 0;
                            entries.push(...kept);
                            return { lines, remaining: kept.length };
                        });
                        return { ok: true, ...res };
                    }
                    return { ok: false, error: `unknown action ${action}` };
                }
                case 'memory.list': {
                    const target = payload?.target;
                    const cwd = payload?.cwd;
                    const entries = store.list(target, cwd, payload?.opts);
                    return { ok: true, entries };
                }
                case 'memory.mutate': {
                    // future: not needed for PR-B
                    return { ok: false, error: 'not implemented' };
                }
                case 'todo.list': {
                    const targets = payload?.targets ?? (payload?.target ? [payload.target] : [...TODO_TARGETS]);
                    const cwd = payload?.cwd;
                    const opts = payload?.opts ?? payload ?? {};
                    const result = todoStore.listTodos(targets, {
                        status: opts.status,
                        quadrant: opts.quadrant,
                        due: opts.due,
                        cat: opts.cat,
                        all: opts.all === true,
                        past: opts.past === true,
                        expired: opts.expired === true,
                        date: opts.date,
                    }, cwd, opts.date);
                    return { ok: true, ...result, text: todoStore.formatList(result, opts.date) };
                }
                case 'todo.mutate': {
                    const action = payload?.action;
                    const target = payload?.target;
                    const cwd = payload?.cwd;
                    const date = payload?.date;
                    if (action === 'add') {
                        const quadrant = resolveQuadrant({ quadrant: payload?.quadrant, important: payload?.important, urgent: payload?.urgent });
                        const res = todoStore.addTodo(target ?? (cwd ? 'project' : 'work'), String(payload?.content ?? ''), { quadrant, due: payload?.due, cat: payload?.cat }, cwd);
                        return { ...res };
                    }
                    if (action === 'done') {
                        const res = todoStore.doneTodo(target, String(payload?.id ?? ''), cwd, date);
                        return { ...res };
                    }
                    if (action === 'remove') {
                        const res = todoStore.removeTodo(target, String(payload?.id ?? ''), cwd, date);
                        return { ...res };
                    }
                    if (action === 'update') {
                        const patch = {};
                        if (payload?.status !== undefined)
                            patch.status = payload.status;
                        if (payload?.quadrant !== undefined)
                            patch.quadrant = payload.quadrant;
                        if (payload?.due !== undefined)
                            patch.due = payload.due;
                        if (payload?.cat !== undefined)
                            patch.cat = payload.cat;
                        if (payload?.content !== undefined)
                            patch.content = payload.content;
                        const res = todoStore.updateTodo(target, String(payload?.id ?? ''), patch, cwd, date);
                        return { ...res };
                    }
                    return { ok: false, error: `unknown todo action ${action}` };
                }
                case 'status': {
                    return { ok: true, queue: queue.read().length, blocked: migration.isWriteBlocked(root) };
                }
                case 'migration.inspect': {
                    const insp = await migration.inspect(root);
                    return { ...insp };
                }
                case 'migration.dryRun': {
                    const res = await migration.dryRun(root);
                    return { ...res };
                }
                case 'migration.run': {
                    // RPC run requires explicit apply flag in payload to enforce CLI's --apply semantics
                    if (payload?.apply !== true) {
                        return { ok: false, error: 'migration requires explicit apply=true (read-only by default)' };
                    }
                    const res = await migration.run(root);
                    return { ...res };
                }
                case 'migration.verify': {
                    const res = await migration.verify(root, payload?.runId);
                    return { ...res };
                }
                default:
                    return { ok: false, error: `unknown endpoint ${endpoint}` };
            }
        };
        // ctx.connection may be undefined in tests; guard
        const conn = ctx.connection ?? (ctx.get && ctx.get('connection'));
        if (!conn?.rpc?.handle)
            return () => { };
        const dispose = conn.rpc.handle(channel, handler);
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: rpc');
}
//# sourceMappingURL=index.js.map