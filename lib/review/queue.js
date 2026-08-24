/**
 * review/queue.ts — SuggestionQueue for M2-PR-B confirmation queue
 * Durable JSONL queue SUGGESTIONS.jsonl, gated memory_suggest and explicit RPC decisions.
 * Handles append/dedupe/edited approval/reject/archive/malformed JSONL/recovery.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { withLockSync } from "../storage/atomic-store.js";
import { resolveMemoryRoot, suggestionsPath } from "../storage/layout.js";
function nowIso() {
    return new Date().toISOString();
}
export function normalizeWhitespace(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim();
}
/**
 * SuggestionQueue — durable JSONL queue with malformed recovery and dedupe.
 */
export class SuggestionQueue {
    file;
    constructor(file) {
        this.file = file;
    }
    static fromRoot(memoryDir, file) {
        const root = resolveMemoryRoot(memoryDir);
        return new SuggestionQueue(file ?? suggestionsPath(root));
    }
    /** Read all suggestions; missing file -> [], malformed lines skipped. */
    read() {
        try {
            const text = readFileSync(this.file, 'utf8');
            const lines = text.split('\n').filter((l) => l.trim().length > 0);
            const out = [];
            for (const line of lines) {
                try {
                    const obj = JSON.parse(line);
                    if (obj && typeof obj.target === 'string' && typeof obj.content === 'string') {
                        out.push(obj);
                    }
                }
                catch {
                    // skip malformed line (recovery: not crashing, next write cleans)
                    continue;
                }
            }
            return out;
        }
        catch (e) {
            if (e?.code === 'ENOENT')
                return [];
            throw e;
        }
    }
    /** Atomically write full list (same-directory lock, temp+rename). */
    write(entries) {
        const dir = dirname(this.file);
        mkdirSync(dir, { recursive: true });
        withLockSync(dir, () => {
            const tmp = join(dir, `.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
            const content = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
            writeFileSync(tmp, content, 'utf8');
            renameSync(tmp, this.file);
        });
    }
    /** Append one suggestion with dedupe (same target+normalized content bumps hits). */
    append(entry) {
        const dir = dirname(this.file);
        mkdirSync(dir, { recursive: true });
        return withLockSync(dir, () => {
            const entries = this.readUnsafe();
            const normalized = normalizeWhitespace(entry.content);
            const existing = entries.find((e) => e.target === entry.target && normalizeWhitespace(e.content) === normalized);
            if (existing) {
                existing.hits = (existing.hits ?? 1) + 1;
                existing.lastSeen = nowIso();
                if (entry.reason)
                    existing.reason = entry.reason;
                this.writeUnsafe(entries);
                return { ok: true, queued: entries.length, deduped: true, hits: existing.hits };
            }
            const toPush = {
                time: entry.time ?? nowIso(),
                target: entry.target,
                content: entry.content,
                reason: entry.reason,
                cwd: entry.cwd ?? null,
                sessionId: entry.sessionId ?? null,
                hits: 1,
                firstSeen: nowIso(),
                lastSeen: nowIso(),
            };
            entries.push(toPush);
            this.writeUnsafe(entries);
            return { ok: true, queued: entries.length };
        });
    }
    /** Mutate under lock; fn may edit entries in place. Writes back after fn. */
    mutate(fn) {
        const dir = dirname(this.file);
        mkdirSync(dir, { recursive: true });
        return withLockSync(dir, () => {
            const entries = this.readUnsafe();
            const result = fn(entries);
            this.writeUnsafe(entries);
            return result;
        });
    }
    /** Alias for read */
    list() {
        return this.read();
    }
    // internal read without lock (caller holds lock)
    readUnsafe() {
        try {
            const text = readFileSync(this.file, 'utf8');
            const lines = text.split('\n').filter((l) => l.trim().length > 0);
            const out = [];
            for (const line of lines) {
                try {
                    const obj = JSON.parse(line);
                    if (obj && typeof obj.target === 'string' && typeof obj.content === 'string')
                        out.push(obj);
                }
                catch {
                    continue;
                }
            }
            return out;
        }
        catch (e) {
            if (e?.code === 'ENOENT')
                return [];
            throw e;
        }
    }
    writeUnsafe(entries) {
        const dir = dirname(this.file);
        mkdirSync(dir, { recursive: true });
        const tmp = join(dir, `.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
        const content = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
        writeFileSync(tmp, content, 'utf8');
        renameSync(tmp, this.file);
    }
}
/** Enqueue helper with dedupe, used by memory_suggest tool */
export function enqueueSuggestion(queue, target, content, reason, agent) {
    const normalized = normalizeWhitespace(content);
    if (!normalized)
        return { ok: false, message: 'empty content', queued: queue.read().length };
    if (!reason?.trim())
        return { ok: false, message: 'empty reason', queued: queue.read().length };
    const res = queue.mutate((entries) => {
        const existing = entries.find((e) => e.target === target && normalizeWhitespace(e.content) === normalized);
        if (existing) {
            existing.hits = (existing.hits ?? 1) + 1;
            existing.lastSeen = nowIso();
            if (reason)
                existing.reason = reason;
            return { deduped: true, hits: existing.hits, queued: entries.length };
        }
        entries.push({
            time: nowIso(),
            sessionId: agent?.id ?? null,
            cwd: agent?.session?.header?.cwd ?? null,
            target,
            content,
            reason,
            hits: 1,
            firstSeen: nowIso(),
            lastSeen: nowIso(),
        });
        return { deduped: false, queued: entries.length };
    });
    if (res.deduped) {
        return { ok: true, message: `deduped (hits=${res.hits})`, queued: res.queued, hits: res.hits };
    }
    return { ok: true, queued: res.queued };
}
/** Approve suggestions by 1-based indices, supports edited content and target override */
export function approveSuggestions(store, todoStore, queue, indices, agent, edits, targets, options = {}) {
    const isTodoEnabled = options.isTodoEnabled ?? (() => true);
    return queue.mutate((entries) => {
        const kept = [];
        const lines = [];
        entries.forEach((entry, idx) => {
            const number = idx + 1;
            if (!indices.includes(number)) {
                kept.push(entry);
                return;
            }
            const isTodo = entry.target.startsWith('todo-');
            const target = isTodo ? entry.target : (targets?.get(number) ?? entry.target);
            const edited = edits?.get(number)?.trim();
            const content = edited ? edited : entry.content;
            if (!content?.trim()) {
                lines.push(`✗ #${number} [${target}] empty content, kept`);
                kept.push(entry);
                return;
            }
            if (isTodo && !isTodoEnabled()) {
                lines.push(`✗ #${number} [${target}] TODO_DISABLED: Todo feature is not enabled`);
                kept.push(entry);
                return;
            }
            let outcome;
            if (isTodo) {
                // todoStore may be minimal; try addTodo or add
                if (todoStore?.addTodo)
                    outcome = todoStore.addTodo(target.slice(5), content, {}, entry.cwd ?? agent?.session?.header?.cwd);
                else if (todoStore?.add)
                    outcome = todoStore.add(target.slice(5), { content }, entry.cwd ?? agent?.session?.header?.cwd);
                else
                    outcome = { ok: false, message: 'todo store not available' };
            }
            else {
                const cwdForStore = entry.cwd ?? agent?.session?.header?.cwd ?? null;
                try {
                    if (store?.add)
                        outcome = store.add(target, content, cwdForStore);
                    else
                        outcome = { ok: false, message: 'store not available' };
                }
                catch (e) {
                    outcome = { ok: false, message: e?.message ?? String(e) };
                }
            }
            if (outcome?.duplicate === true) {
                lines.push(`#${number} [${target}] duplicate skipped`);
            }
            else if (outcome?.ok) {
                lines.push(`#${number} [${target}] approved`);
            }
            else {
                lines.push(`✗ #${number} [${target}] ${outcome?.message ?? outcome?.error ?? 'failed'}`);
                kept.push(entry);
            }
        });
        entries.length = 0;
        entries.push(...kept);
        return { lines, remaining: kept.length };
    });
}
export function rejectSuggestions(queue, indices) {
    return queue.mutate((entries) => {
        const kept = [];
        let removed = 0;
        entries.forEach((entry, idx) => {
            if (indices.includes(idx + 1))
                removed += 1;
            else
                kept.push(entry);
        });
        entries.length = 0;
        entries.push(...kept);
        return { removed, remaining: kept.length };
    });
}
export function archiveSuggestions(archive, queue, indices) {
    return queue.mutate((entries) => {
        const kept = [];
        const lines = [];
        entries.forEach((entry, idx) => {
            const number = idx + 1;
            if (!indices.includes(number)) {
                kept.push(entry);
                return;
            }
            const originTag = entry.target.startsWith('todo-') ? `\n(original track: ${entry.target})` : '';
            const stamp = new Date().toISOString().slice(0, 10);
            const stamped = `[${stamp}] ${entry.content}${originTag}${entry.reason ? `\n(archive reason: ${entry.reason})` : ''}`;
            // archive may be MaestroMemoryStore or ArchiveStore
            let outcome;
            try {
                if (archive?.append) {
                    // ArchiveStore path: needs cwd for key
                    if (entry.target === 'key' || entry.target.startsWith('todo-'))
                        outcome = archive.append(entry.target, stamped, entry.cwd ?? undefined);
                    else
                        outcome = archive.append(entry.target, stamped);
                }
                else if (archive?.archive) {
                    outcome = archive.archive(entry.target, entry.content, entry.cwd);
                }
                else {
                    outcome = { ok: false, message: 'archive not available' };
                }
            }
            catch (e) {
                outcome = { ok: false, message: e?.message ?? String(e) };
            }
            // MaestroMemoryStore archive via atomic store uses raw string; treat any truthy ok
            const ok = outcome?.ok === true || outcome === undefined;
            if (ok) {
                lines.push(`#${number} [${entry.target}] archived`);
            }
            else {
                lines.push(`✗ #${number} [${entry.target}] ${outcome?.message ?? outcome?.error ?? 'archive failed'}`);
                kept.push(entry);
            }
        });
        entries.length = 0;
        entries.push(...kept);
        return { lines, remaining: kept.length };
    });
}
//# sourceMappingURL=queue.js.map