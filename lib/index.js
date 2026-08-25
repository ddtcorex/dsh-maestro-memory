/**
 * dsh-maestro-memory — host entry (M2-PR-B: confirmation queue, gated memory_suggest, RPC decide, Review UI)
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { MaestroMemoryStore } from "./memory/store.js";
import { applyBatch } from "./memory/batch.js";
import { buildFeedbackLine } from "./memory/feedback.js";
import { TodoStore, resolveQuadrant } from "./todo/store.js";
import { TODO_TARGETS, TODO_STATUSES } from "./storage/legacy-format.js";
import { SuggestionQueue, enqueueSuggestion, approveSuggestions, rejectSuggestions } from "./review/queue.js";
import { resolveMemoryRoot, suggestionsPath, globalArchivePath, userArchivePath, projectKeyArchivePath, todoArchivePath } from "./storage/layout.js";
import { appendEntryAtomicSync } from "./storage/atomic-store.js";
import * as migration from "./migration/service.js";
import { SyncService } from "./sync/service.js";
import { RealGitAdapter } from "./sync/git.js";
import { listSkillsSync, resolveDefaultMaestroSkillsDir } from "./skills-browser.js";
import { renderSnapshot } from "./prompt/snapshot.js";
export const inject = ['tools', 'systemPrompt', 'connection'];
export const DEFAULTS = {
    memoryDir: null,
    snapshotOrder: 500,
};
const CONTENT_OUTPUT = {
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: { content: { type: 'array', required: true } },
    },
    render: (_args, value) => value.content,
};
export function apply(ctx, config = {}) {
    const order = config.snapshotOrder ?? DEFAULTS.snapshotOrder;
    const store = new MaestroMemoryStore(config.memoryDir ?? null);
    const todoStore = new TodoStore(config.memoryDir ?? null);
    const root = resolveMemoryRoot(config.memoryDir ?? null);
    const queue = new SuggestionQueue(suggestionsPath(root));
    const syncService = new SyncService(config.memoryDir ?? null, new RealGitAdapter());
    ctx.effect(() => {
        const dispose = ctx.systemPrompt.context({
            name: 'memory:snapshot',
            order,
            text: (promptCtx) => {
                const cwd = promptCtx?.agent?.session?.header?.cwd ?? null;
                const branch = promptCtx?.agent?.session?.header?.branch ?? undefined;
                const sessionId = promptCtx?.agent?.session?.header?.sessionId
                    ?? promptCtx?.agent?.session?.id
                    ?? undefined;
                const sessionName = promptCtx?.agent?.session?.header?.sessionName
                    ?? promptCtx?.agent?.session?.name
                    ?? undefined;
                return renderSnapshot(store, { cwd, branch, sessionId, sessionName });
            },
        });
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: snapshot');
    ctx.effect(() => {
        const tool = defineTool({
            name: 'memory',
            description: 'Maestro memory (M2: five tracks, query, replace/remove, archive, branch, summary/expand)',
            parameters: {
                action: { type: 'string', required: true, enum: ['add', 'list', 'replace', 'remove', 'archive', 'expand'], description: 'Memory action' },
                target: { type: 'string', description: 'Memory track (daily=YYYY-MM-DD file, project=per-cwd log, key=per-cwd long-term); optional only when entries[] is used' },
                entries: { type: 'array', description: 'Batch add: array of {target,content,cwd?,date?,branches?,summary?} — sequential through store.add with rollback on first failure' },
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
                sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'], description: 'Attach [Feedback] line on add when set (single add or entries[])' },
                category: { type: 'string', description: 'Feedback category (requires sentiment)' },
                quote: { type: 'string', description: 'Feedback quote (requires sentiment)' },
                note: { type: 'string', description: 'Feedback note (requires sentiment)' },
                id: { type: 'string', description: 'Entry id for expand (key)' },
                archived: { type: 'boolean', description: 'Query archive files (list)' },
                cwd: { type: 'string', description: 'Working directory for project/key tracks' },
                date: { type: 'string', description: 'Date YYYY-MM-DD for daily track (add/list/replace/remove)' },
            },
            output: CONTENT_OUTPUT,
            execute: async (args, exec) => {
                const target = args.target;
                const action = args.action;
                const cwd = args.cwd ?? exec?.agent?.session?.header?.cwd;
                try {
                    switch (action) {
                        case 'add': {
                            // Batch path: entries[] takes precedence over the single target/content form.
                            if (Array.isArray(args.entries)) {
                                if (!args.target && !args.content) {
                                    // Inject the session cwd as per-entry fallback, mirroring the
                                    // single-add path — otherwise project/key entries without an
                                    // explicit cwd fail deep inside the store mid-batch.
                                    const batchEntries = args.entries.map((entry) => ({ ...entry, cwd: entry.cwd ?? cwd }));
                                    const batchRes = applyBatch(store, batchEntries);
                                    if (!batchRes.ok) {
                                        return { content: [{ type: 'text', text: `batch failed at [${batchRes.index}]: ${batchRes.error}` }] };
                                    }
                                    return { content: [{ type: 'text', text: `added ${batchRes.ids.length} ${batchRes.ids.length === 1 ? 'entry' : 'entries'} (batch)` }] };
                                }
                            }
                            else if (!target) {
                                return { content: [{ type: 'text', text: 'add failed: target is required for single add (or pass entries[])' }] };
                            }
                            let entryText = args.content ?? '';
                            if (args.sentiment !== undefined) {
                                entryText = `${entryText.trimEnd()} ${buildFeedbackLine({
                                    sentiment: args.sentiment,
                                    category: args.category,
                                    quote: args.quote,
                                    note: args.note,
                                })}`;
                            }
                            const res = store.add(target, entryText, cwd, {
                                branches: args.branches,
                                summary: args.summary,
                                // daily add targets a specific day when the caller passes date
                                date: args.date,
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
                                date: args.date,
                            });
                            const text = entries.length ? entries.join('\n---\n') : '(no entries)';
                            return { content: [{ type: 'text', text }] };
                        }
                        case 'replace': {
                            const res = store.replace(target, args.match ?? '', args.content ?? '', cwd, { date: args.date });
                            if (!res.ok)
                                return { content: [{ type: 'text', text: `replace failed: ${res.error}` }] };
                            return { content: [{ type: 'text', text: 'replaced' }] };
                        }
                        case 'remove': {
                            const res = store.remove(target, args.match ?? '', cwd, { date: args.date });
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
        });
        const dispose = ctx.tools.register(tool);
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: tool');
    // Gated memory_suggest tool — model proposals go to queue, never directly to memory
    ctx.effect(() => {
        const tool = defineTool({
            name: 'memory_suggest',
            description: 'Propose memory/todo for confirmation queue (gated, requires user approve). Targets: memory/user/key/todo-*',
            parameters: {
                target: { type: 'string', required: true, enum: ['memory', 'user', 'key', 'todo-life', 'todo-work', 'todo-project', 'todo-daily'] },
                content: { type: 'string', required: true },
                reason: { type: 'string', required: true },
            },
            output: CONTENT_OUTPUT,
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
        });
        const dispose = ctx.tools.register(tool);
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: suggest-tool');
    // dtodo compatibility tool (four tracks, IDs, status/due/quadrant, smart view, historical lookup)
    ctx.effect(() => {
        const tool = defineTool({
            name: 'dtodo',
            description: 'Todos: life/work/project/daily with IDs, status/due/quadrant, smart view (overdue/today/project/Q1-Q2, limit 8), historical daily lookup',
            parameters: {
                action: { type: 'string', required: true, enum: ['add', 'list', 'done', 'update', 'remove'] },
                target: { type: 'string', enum: [...TODO_TARGETS] },
                content: { type: 'string' },
                id: { type: 'string' },
                due: { type: 'string' },
                quadrant: { type: 'string', enum: ['q1', 'q2', 'q3', 'q4'] },
                important: { type: 'boolean' },
                urgent: { type: 'boolean' },
                cat: { type: 'string' },
                status: { type: 'string', enum: [...TODO_STATUSES] },
                all: { type: 'boolean' },
                past: { type: 'boolean' },
                expired: { type: 'boolean' },
                cwd: { type: 'string' },
                date: { type: 'string' },
            },
            output: CONTENT_OUTPUT,
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
        });
        const dispose = ctx.tools.register(tool);
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: dtodo-tool');
    // RPC channel for Review queue — explicit user-click decisions
    ctx.effect(() => {
        const channel = '/dsh-maestro-memory';
        const rpcDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
        const legacyHandler = async (endpoint, payload) => {
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
                                    // No archivable target (e.g. key without cwd): DO NOT silently drop the suggestion.
                                    if (!archiveFile) {
                                        lines.push(`✗ #${number} [${entry.target}] cannot archive (missing cwd or unsupported target)`);
                                        kept.push(entry);
                                        return;
                                    }
                                    const appended = appendEntryAtomicSync(archiveFile, stamped);
                                    if (!appended.ok) {
                                        lines.push(`✗ #${number} [${entry.target}] archive failed: ${appended.error}`);
                                        kept.push(entry);
                                        return;
                                    }
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
                    const entries = store.list(target, cwd, { ...(payload?.opts ?? {}), date: payload?.date });
                    return { ok: true, entries };
                }
                case 'memory.mutate': {
                    const action = payload?.action;
                    const target = payload?.target;
                    const cwd = payload?.cwd;
                    const content = payload?.content;
                    const match = payload?.match;
                    const id = payload?.id;
                    const opts = payload?.opts ?? {};
                    try {
                        if (action === 'list') {
                            return { ok: true, entries: store.list(target, cwd, { ...opts, date: payload?.date }) };
                        }
                        if (action === 'add') {
                            return store.add(target, content ?? '', cwd, { branches: payload?.branches, summary: payload?.summary, date: payload?.date });
                        }
                        if (action === 'replace') {
                            return store.replace(target, match ?? '', content ?? '', cwd, { date: payload?.date });
                        }
                        if (action === 'remove') {
                            return store.remove(target, match ?? '', cwd, { date: payload?.date });
                        }
                        if (action === 'archive') {
                            return store.archive(target, match ?? '', cwd);
                        }
                        if (action === 'expand') {
                            return store.expand(target, id ?? '', cwd);
                        }
                        return { ok: false, error: `unknown memory action ${action}` };
                    }
                    catch (e) {
                        return { ok: false, error: e?.message ?? String(e) };
                    }
                }
                case 'todo.list': {
                    const targets = payload?.targets ?? (payload?.target ? [payload.target] : [...TODO_TARGETS]);
                    const cwd = payload?.cwd;
                    const opts = payload?.opts ?? payload ?? {};
                    const date = rpcDate(opts.date);
                    const result = todoStore.listTodos(targets, {
                        status: opts.status,
                        quadrant: opts.quadrant,
                        due: opts.due,
                        cat: opts.cat,
                        all: opts.all === true,
                        past: opts.past === true,
                        expired: opts.expired === true,
                        date,
                    }, cwd, date);
                    return { ok: true, ...result, text: todoStore.formatList(result, date) };
                }
                case 'todo.mutate': {
                    const action = payload?.action;
                    const target = payload?.target;
                    const cwd = payload?.cwd;
                    const date = rpcDate(payload?.date);
                    if (action === 'add') {
                        const due = typeof payload?.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.due) ? payload.due : undefined;
                        const quadrant = resolveQuadrant({ quadrant: payload?.quadrant, important: payload?.important, urgent: payload?.urgent });
                        const res = todoStore.addTodo(target ?? (cwd ? 'project' : 'work'), String(payload?.content ?? ''), { quadrant, due, cat: payload?.cat }, cwd);
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
                case 'sync.enable': {
                    const cwd = String(payload?.cwd ?? '').trim();
                    const remoteUrl = String(payload?.remoteUrl ?? payload?.remote ?? '').trim();
                    const branch = payload?.branch ? String(payload.branch).trim() : undefined;
                    if (!cwd)
                        return { ok: false, error: 'cwd required' };
                    if (!remoteUrl)
                        return { ok: false, error: 'remoteUrl required' };
                    const res = syncService.enable(cwd, remoteUrl, branch);
                    return { ...res };
                }
                case 'sync.disable': {
                    const cwd = String(payload?.cwd ?? '').trim();
                    if (!cwd)
                        return { ok: false, error: 'cwd required' };
                    const res = syncService.disable(cwd);
                    return { ...res };
                }
                case 'sync.status': {
                    const cwd = String(payload?.cwd ?? '').trim();
                    if (!cwd)
                        return { ok: false, error: 'cwd required' };
                    const reveal = payload?.reveal === true;
                    // explicit fetch on status when requested
                    if (payload?.fetch === true) {
                        const fetchRes = await syncService.fetch(cwd);
                        if (!fetchRes.ok)
                            return { ok: false, error: fetchRes.error };
                        const st = syncService.status(cwd, reveal);
                        return { ok: true, ...st, fetched: true, conflicts: fetchRes.conflicts };
                    }
                    const st = syncService.status(cwd, reveal);
                    return { ok: true, ...st };
                }
                case 'sync.fetch': {
                    const cwd = String(payload?.cwd ?? '').trim();
                    if (!cwd)
                        return { ok: false, error: 'cwd required' };
                    const res = await syncService.fetch(cwd);
                    return { ...res };
                }
                case 'sync.push': {
                    const cwd = String(payload?.cwd ?? '').trim();
                    if (!cwd)
                        return { ok: false, error: 'cwd required' };
                    const res = await syncService.push(cwd, payload?.message ? String(payload.message) : undefined);
                    return { ...res };
                }
                case 'sync.pull': {
                    const cwd = String(payload?.cwd ?? '').trim();
                    if (!cwd)
                        return { ok: false, error: 'cwd required' };
                    const res = await syncService.pull(cwd);
                    return { ...res };
                }
                case 'sync.resolve': {
                    const cwd = String(payload?.cwd ?? '').trim();
                    const id = String(payload?.id ?? '').trim();
                    const choice = String(payload?.choice ?? '').trim();
                    if (!cwd)
                        return { ok: false, error: 'cwd required' };
                    if (!id)
                        return { ok: false, error: 'id required' };
                    const res = syncService.resolve(cwd, id, choice);
                    return { ...res };
                }
                case 'sync.listConflicts': {
                    const cwd = String(payload?.cwd ?? '').trim();
                    if (!cwd)
                        return { ok: false, error: 'cwd required' };
                    const conflicts = syncService.listConflicts(cwd);
                    return { ok: true, conflicts };
                }
                case 'skills.list': {
                    // M6 read-first: list metadata/origin only, no mutation, no body content.
                    // Constrained to the resolved default maestro-skills checkout — the RPC
                    // must NOT honor an arbitrary client-supplied dir/roots (that would let a
                    // payload read any directory). The client sends {} and relies on the default.
                    try {
                        const def = resolveDefaultMaestroSkillsDir();
                        if (def) {
                            const entries = listSkillsSync(def, 'maestro-skills');
                            return { ok: true, entries };
                        }
                        return { ok: true, entries: [] };
                    }
                    catch (e) {
                        return { ok: false, error: e?.message ?? String(e) };
                    }
                }
                default:
                    return { ok: false, error: `unknown endpoint ${endpoint}` };
            }
        };
        const handler = async (endpoint, payload, _signal) => ({
            ok: true,
            value: await legacyHandler(endpoint, payload),
        });
        // ctx.connection may be undefined in tests; guard
        const conn = ctx.connection ?? (ctx.get && ctx.get('connection'));
        if (!conn?.rpc?.handle)
            return () => { };
        const dispose = conn.rpc.handle(channel, handler, { authority: 'loopback' });
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: rpc');
}
//# sourceMappingURL=index.js.map