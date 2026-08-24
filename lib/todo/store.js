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
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveMemoryRoot, lifeTodoPath, workTodoPath, projectTodoPath, dailyTodoPath, maestroMetaDir } from "../storage/layout.js";
import { parseTodoEntry, stampTodoLine, ENTRY_DELIMITER, TODO_HEADER, TODO_TARGETS, TODO_STATUSES } from "../storage/legacy-format.js";
import { withLockSync } from "../storage/atomic-store.js";
function isWriteBlockedSync(root) {
    try {
        const p = join(maestroMetaDir(root), 'write-block.json');
        if (!existsSync(p))
            return false;
        const data = JSON.parse(readFileSync(p, 'utf8'));
        return data.blocked === true;
    }
    catch {
        return false;
    }
}
export const DEFAULT_VIEW_LIMIT = 8;
/** Local date YYYY-MM-DD (local time, not UTC) */
export function todayStamp() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}
function nowStamp() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${todayStamp()} ${hh}:${mm}`;
}
function newId() {
    return randomBytes(4).toString('hex');
}
export class TodoStore {
    memoryDir;
    constructor(memoryDir = null) {
        this.memoryDir = memoryDir;
    }
    root() {
        return resolveMemoryRoot(this.memoryDir);
    }
    /** Resolve one track's file path; project requires cwd, daily honors date */
    pathFor(target, cwd, date) {
        if (target === 'life')
            return lifeTodoPath(this.root());
        if (target === 'work')
            return workTodoPath(this.root());
        if (target === 'project') {
            if (!cwd)
                throw new Error('project todo requires cwd');
            return projectTodoPath(this.root(), cwd);
        }
        if (target === 'daily') {
            const d = date ?? todayStamp();
            return dailyTodoPath(this.root(), d);
        }
        throw new Error(`unknown target ${target}`);
    }
    /** Read raw text; missing -> '' */
    readText(target, cwd, date) {
        try {
            return readFileSync(this.pathFor(target, cwd, date), 'utf8');
        }
        catch (e) {
            if (e?.code === 'ENOENT')
                return '';
            throw e;
        }
    }
    /** Parse raw text into items (strip header comment) */
    parseAll(text) {
        const body = text
            .replace(/^<!--[\s\S]*?-->\s*/, '')
            .replace(/^\s*§\s*\n?/, '')
            .trim();
        if (body === '')
            return [];
        return body
            .split(ENTRY_DELIMITER)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
            .map((entry) => parseTodoEntry(entry))
            .filter((item) => item !== null)
            .map((item) => ({ ...item }));
    }
    /** All items of one track (daily: honors date, default today) */
    itemsOf(target, cwd, date) {
        const items = this.parseAll(this.readText(target, cwd, date));
        if (target === 'daily') {
            const day = date ?? todayStamp();
            for (const it of items)
                it.day = day;
        }
        return items;
    }
    /** All past daily items: every daily file before today, newest day first, each tagged day+past */
    pastItemsOf(today = todayStamp()) {
        let names = [];
        try {
            names = readdirSync(join(this.root(), 'daily'));
        }
        catch {
            return [];
        }
        const days = names
            .filter((n) => /^\d{4}-\d{2}-\d{2}\.todo\.md$/.test(n))
            .map((n) => n.slice(0, 10))
            .filter((day) => day < today)
            .sort()
            .reverse();
        const all = [];
        for (const day of days) {
            all.push(...this.itemsOf('daily', undefined, day));
        }
        // tag past
        for (const it of all)
            it.past = true;
        return all;
    }
    assertNotBlocked() {
        if (isWriteBlockedSync(this.root())) {
            throw new Error(`write blocked: migration verify mismatch (see ${join(maestroMetaDir(this.root()), 'write-block.json')})`);
        }
    }
    /** Atomically write one track's items (header + entries) under directory lock */
    write(target, cwd, items, date) {
        this.assertNotBlocked();
        const p = this.pathFor(target, cwd, date);
        const dir = dirname(p);
        mkdirSync(dir, { recursive: true });
        withLockSync(dir, () => {
            const body = items.map((it) => it.raw).join(ENTRY_DELIMITER);
            const text = `${TODO_HEADER}${body.length > 0 ? `\n§\n${body}\n` : ''}`;
            const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
            writeFileSync(tmp, text, 'utf8');
            renameSync(tmp, p);
        });
    }
    // -------------------------------------------------------------------------
    // Back-compat minimal API (M1)
    // -------------------------------------------------------------------------
    /** M1 compat: list parsed entries for one track */
    list(target, cwd, date) {
        return this.itemsOf(target, cwd, date);
    }
    /** M1 compat: add via {content,due,quadrant,cat} */
    add(target, input, cwd) {
        const res = this.addTodo(target, input.content, { quadrant: input.quadrant ?? null, due: input.due ?? null, cat: input.cat ?? null }, cwd);
        if (!res.ok)
            return { ok: false, error: res.message };
        return { ok: true, id: res.id };
    }
    /** M1 smartView compat: delegates to listTodos default view for single track */
    smartView(target, cwd) {
        const result = this.listTodos([target], {}, cwd);
        return result.items;
    }
    // -------------------------------------------------------------------------
    // Full API (M3)
    // -------------------------------------------------------------------------
    addTodo(target, content, meta = {}, cwd) {
        if (!TODO_TARGETS.includes(target)) {
            return { ok: false, message: `invalid target "${target}"`, target };
        }
        const text = String(content ?? '').trim();
        if (!text)
            return { ok: false, message: 'empty content', target };
        const id = newId();
        const raw = stampTodoLine({
            time: nowStamp(),
            id,
            quadrant: meta.quadrant ?? null,
            due: meta.due ?? null,
            status: 'pending',
            cat: meta.cat ?? null,
            doneAt: null,
        }, text);
        const items = this.itemsOf(target, cwd);
        items.push({ raw });
        try {
            this.write(target, cwd, items);
        }
        catch (e) {
            return { ok: false, message: e?.message ?? String(e), target };
        }
        return { ok: true, message: `added to ${target} (${items.length})`, id, target };
    }
    findById(target, id, cwd, date) {
        const targets = target !== undefined ? [target] : [...TODO_TARGETS];
        for (const t of targets) {
            let items;
            try {
                if (t === 'daily' && date === undefined) {
                    items = [...this.itemsOf('daily', cwd, undefined), ...this.pastItemsOf()];
                }
                else {
                    items = this.itemsOf(t, cwd, date);
                }
            }
            catch {
                continue;
            }
            const item = items.find((e) => e.id === id);
            if (item)
                return { target: t, item, items, day: item.day };
        }
        return null;
    }
    updateTodo(target, id, patch, cwd, date) {
        const found = this.findById(target, id, cwd, date);
        if (!found) {
            return { ok: false, message: target ? `not found: ${id} in ${target}` : `not found: ${id}`, target: target ?? '?' };
        }
        const { target: t, item, day } = found;
        const meta = parseTodoEntry(item.raw);
        const nextStatus = patch.status ?? meta.status;
        if (patch.status && !TODO_STATUSES.includes(patch.status)) {
            return { ok: false, message: `invalid status "${patch.status}"`, target: t };
        }
        if (patch.quadrant !== undefined && patch.quadrant !== null && !/^q[1-4]$/.test(patch.quadrant)) {
            return { ok: false, message: `invalid quadrant "${patch.quadrant}"`, target: t };
        }
        if (patch.due !== undefined && patch.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) {
            return { ok: false, message: `invalid due "${patch.due}"`, target: t };
        }
        const doneAt = nextStatus === 'done' ? (meta.doneAt ?? nowStamp()) : null;
        const raw = stampTodoLine({
            time: meta.time,
            id: meta.id,
            quadrant: patch.quadrant !== undefined ? patch.quadrant : meta.quadrant,
            due: patch.due !== undefined ? patch.due : meta.due,
            status: nextStatus,
            cat: patch.cat !== undefined ? patch.cat : meta.cat,
            doneAt,
        }, patch.content !== undefined ? patch.content : meta.text);
        // write back to correct file (daily may be past day)
        const current = this.itemsOf(t, cwd, day);
        const idx = current.findIndex((e) => e.id === id);
        if (idx === -1)
            return { ok: false, message: 'gone', target: t };
        const next = [...current];
        next[idx] = { raw };
        try {
            this.write(t, cwd, next, day);
        }
        catch (e) {
            return { ok: false, message: e?.message ?? String(e), target: t };
        }
        return { ok: true, message: `updated ${t}`, target: t };
    }
    doneTodo(target, id, cwd, date) {
        return this.updateTodo(target, id, { status: 'done' }, cwd, date);
    }
    removeTodo(target, id, cwd, date) {
        const found = this.findById(target, id, cwd, date);
        if (!found)
            return { ok: false, message: `not found: ${id}`, target: target ?? '?' };
        const { target: t, day } = found;
        const current = this.itemsOf(t, cwd, day);
        const next = current.filter((e) => e.id !== id);
        if (next.length === current.length)
            return { ok: false, message: 'gone', target: t };
        try {
            this.write(t, cwd, next, day);
        }
        catch (e) {
            return { ok: false, message: e?.message ?? String(e), target: t };
        }
        return { ok: true, message: `deleted ${t}`, target: t };
    }
    listTodos(targets, options = {}, cwd, today = todayStamp()) {
        const done = (it) => it.status === 'done' || it.status === 'cancelled';
        const isOverdue = (it) => it.due !== null && it.due < today && !done(it);
        const isToday = (it) => it.due === today && !done(it);
        const isPast = (it) => it.past === true;
        const isPastExpired = (it) => {
            if (!isPast(it) || done(it))
                return false;
            if (it.due === null)
                return true;
            return it.due < today;
        };
        const wantStatus = (it) => {
            if (options.status === undefined || options.status === 'all')
                return true;
            return it.status === options.status;
        };
        const wantQuadrant = (it) => {
            if (options.quadrant === undefined || options.quadrant === 'all')
                return true;
            return it.quadrant === options.quadrant;
        };
        const wantDue = (it) => {
            if (options.due === undefined || options.due === 'all')
                return true;
            if (options.due === 'overdue')
                return isOverdue(it);
            if (options.due === 'today')
                return isToday(it) || isOverdue(it);
            return true;
        };
        const wantCat = (it) => {
            if (options.cat === undefined)
                return true;
            return it.cat !== null && it.cat.toLowerCase().includes(String(options.cat).toLowerCase());
        };
        const all = [];
        const seen = new Set();
        for (const target of targets) {
            let items;
            try {
                items = this.itemsOf(target, cwd, options.date);
            }
            catch {
                continue;
            }
            for (const it of items) {
                if (!wantStatus(it) || !wantQuadrant(it) || !wantDue(it) || !wantCat(it))
                    continue;
                if (it.id && seen.has(it.id))
                    continue;
                if (it.id)
                    seen.add(it.id);
                all.push({ ...it, target });
            }
        }
        if (options.past === true && targets.includes('daily')) {
            for (const it of this.pastItemsOf(today)) {
                if (!wantStatus(it) || !wantQuadrant(it) || !wantDue(it) || !wantCat(it))
                    continue;
                if (it.id && seen.has(it.id))
                    continue;
                if (it.id)
                    seen.add(it.id);
                const marked = { ...it, target: 'daily', past: true };
                if (options.expired !== true && isPastExpired(marked))
                    continue;
                all.push(marked);
            }
        }
        const defaultView = options.all !== true &&
            options.past !== true &&
            options.status === undefined &&
            options.quadrant === undefined &&
            options.due === undefined &&
            options.cat === undefined;
        let selected = all;
        if (defaultView) {
            selected = all.filter((it) => {
                if (done(it))
                    return false;
                if (isOverdue(it) || isToday(it))
                    return true;
                if (it.target === 'project' && cwd)
                    return true;
                if ((it.target === 'life' || it.target === 'work') && (it.quadrant === 'q1' || it.quadrant === 'q2'))
                    return true;
                if (it.target === 'daily')
                    return true;
                return false;
            });
        }
        const rank = (it) => (isPast(it) ? 9 : isOverdue(it) ? 0 : isToday(it) ? 1 : it.quadrant === 'q1' ? 2 : it.quadrant === 'q2' ? 3 : it.quadrant === 'q3' ? 4 : it.quadrant === 'q4' ? 5 : 6);
        selected.sort((a, b) => {
            const ra = rank(a);
            const rb = rank(b);
            if (ra !== rb)
                return ra - rb;
            if (isPast(a) && isPast(b)) {
                const d = String(b.day ?? '').localeCompare(String(a.day ?? ''));
                if (d !== 0)
                    return d;
                return String(b.time).localeCompare(String(a.time));
            }
            const d = String(a.due ?? '').localeCompare(String(b.due ?? ''));
            if (d !== 0)
                return d;
            return String(a.time).localeCompare(String(b.time));
        });
        const explicit = options.all === true || options.past === true;
        const truncated = !explicit && selected.length > DEFAULT_VIEW_LIMIT;
        const hint = options.past === true && options.expired !== true
            ? 'Hint: unfinished expired leftovers for past daily todos are hidden by default; to view them, call list again with expired=true'
            : null;
        return {
            items: explicit ? selected : selected.slice(0, DEFAULT_VIEW_LIMIT),
            total: selected.length,
            truncated,
            defaultView,
            hint,
        };
    }
    formatList(result, today = todayStamp()) {
        const { items, total, truncated, defaultView, hint } = result;
        if (items.length === 0) {
            const h = hint ? `\n${hint}` : '';
            return defaultView
                ? `Todos (default view): no unfinished todos needing attention (overdue / due today / current project / important & urgent) — all clear 🎉${h}`
                : `Todos: no matching entries${h}`;
        }
        const head = defaultView
            ? `Todos (default view: overdue / due today / current project unfinished / important & urgent, up to ${DEFAULT_VIEW_LIMIT})`
            : `Todos (${total}${truncated ? `, showing first ${DEFAULT_VIEW_LIMIT}` : ''})`;
        const lines = items.map((it) => {
            const tags = [`[${it.target}]`];
            if (it.past)
                tags.push(`[past ${it.day}]`);
            if (it.quadrant)
                tags.push(`[${it.quadrant}]`);
            if (it.due !== null)
                tags.push(it.due < today ? `[overdue ${it.due}]` : `[${it.due}]`);
            if (it.status !== 'pending')
                tags.push(`[${it.status}]`);
            if (it.cat)
                tags.push(`[${it.cat}]`);
            const text = it.text.split('\n')[0];
            return `- ${tags.join(' ')} ${text} (id: ${it.id})`;
        });
        const h = hint ? `\n${hint}` : '';
        return `${head}\n${lines.join('\n')}\ntag semantics: q1-q4 = quadrants (important x urgent); due = deadline; status = state; operate by id (dtodo done/update/remove <id>, may include target=).${h}`;
    }
}
export function resolveQuadrant(args) {
    if (typeof args.quadrant === 'string' && /^q[1-4]$/.test(args.quadrant))
        return args.quadrant;
    const important = args.important === true;
    const urgent = args.urgent === true;
    if (important && urgent)
        return 'q1';
    if (important && !urgent)
        return 'q2';
    if (!important && urgent)
        return 'q3';
    return null;
}
//# sourceMappingURL=store.js.map