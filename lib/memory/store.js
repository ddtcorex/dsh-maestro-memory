/**
 * memory/store.ts — MaestroMemoryStore for five tracks (memory/user/daily/project/key)
 * with date/content query, unique replace/remove, archive-before-delete,
 * branch filter, summary/expand. Uses storage/layout + storage/atomic-store.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { readEntriesSync, appendEntryAtomicSync, writeEntriesAtomicSync, withLockSync, } from "../storage/atomic-store.js";
import { resolveMemoryRoot, globalMemoryPath, userMemoryPath, dailyPath, dailyDir, projectMemoryPath, projectKeyPath, globalArchivePath, userArchivePath, projectKeyArchivePath, projectArchivePath, maestroMetaDir, } from "../storage/layout.js";
import { parseEntryBranches, parseEntrySummary, autoSummary, extractEntryDate, SUMMARY_TAG_RE, } from "../storage/legacy-format.js";
import { desensitize } from "./sanitize.js";
function normalizeTarget(t) {
    if (t === 'global')
        return 'memory';
    return t;
}
function genId() {
    return randomUUID().replace(/-/g, '').slice(0, 8);
}
function todayStamp() {
    // Local calendar date (matching TodoStore.todayStamp) so daily memory and
    // daily todos land on the same "today" — UTC here drifted a day for
    // timezones east of UTC around midnight.
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}
function timeStamp() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}
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
export class MaestroMemoryStore {
    memoryDir;
    constructor(memoryDir = null) {
        this.memoryDir = memoryDir;
    }
    root() {
        return resolveMemoryRoot(this.memoryDir);
    }
    assertNotBlocked() {
        const r = this.root();
        if (isWriteBlockedSync(r)) {
            throw new Error(`write blocked: migration verify mismatch (see ${join(maestroMetaDir(r), 'write-block.json')})`);
        }
    }
    fileFor(target, cwd, date) {
        const r = this.root();
        const t = normalizeTarget(target);
        switch (t) {
            case 'memory':
                return globalMemoryPath(r);
            case 'user':
                return userMemoryPath(r);
            case 'daily': {
                const d = date ?? todayStamp();
                return dailyPath(r, d);
            }
            case 'project': {
                if (!cwd)
                    throw new Error('project track requires cwd');
                return projectMemoryPath(r, cwd);
            }
            case 'key': {
                if (!cwd)
                    throw new Error('key track requires cwd');
                return projectKeyPath(r, cwd);
            }
            default:
                throw new Error(`unknown target ${target}`);
        }
    }
    archiveFileFor(target, cwd) {
        const r = this.root();
        const t = normalizeTarget(target);
        if (t === 'memory')
            return globalArchivePath(r);
        if (t === 'user')
            return userArchivePath(r);
        if (t === 'key') {
            if (!cwd)
                throw new Error('key archive requires cwd');
            return projectKeyArchivePath(r, cwd);
        }
        if (t === 'project') {
            if (!cwd)
                throw new Error('project archive requires cwd');
            return projectArchivePath(r, cwd);
        }
        throw new Error(`archive only for memory/user/key/project (got ${target})`);
    }
    // -------------------------------------------------------------------------
    // Internal helpers: branch tag, summary tag, stamping
    // -------------------------------------------------------------------------
    applyBranchTag(entry, branches) {
        if (!branches)
            return entry;
        const list = branches
            .split(',')
            .map((b) => b.trim())
            .filter(Boolean);
        if (list.length === 0)
            return entry;
        // Insert [branch:...] after date prefix if present, else prepend
        const dateMatch = /^\[(\d{4}-\d{2}-\d{2}[^\]]*)\]\s*/.exec(entry);
        if (dateMatch) {
            const prefix = dateMatch[0];
            const rest = entry.slice(prefix.length);
            // remove existing branch tag to avoid duplication
            const cleaned = rest.replace(/^\[branch:[^\]]*\]\s*/, '');
            return `${prefix}[branch:${list.join(',')}] ${cleaned}`;
        }
        // No date, check for id prefix
        const idMatch = /^\[id:\s*[0-9a-f]{8}\]\s*/i.exec(entry);
        if (idMatch) {
            const idPrefix = idMatch[0];
            const rest = entry.slice(idPrefix.length);
            const date2 = /^\[(\d{4}-\d{2}-\d{2}[^\]]*)\]\s*/.exec(rest);
            if (date2) {
                return `${idPrefix}${date2[0]}[branch:${list.join(',')}] ${rest.slice(date2[0].length).replace(/^\[branch:[^\]]*\]\s*/, '')}`;
            }
            return `${idPrefix}[branch:${list.join(',')}] ${rest.replace(/^\[branch:[^\]]*\]\s*/, '')}`;
        }
        return `[branch:${list.join(',')}] ${entry.replace(/^\[branch:[^\]]*\]\s*/, '')}`;
    }
    applySummaryTag(entry, summary) {
        if (!summary)
            return entry;
        const sanitized = String(summary).replace(/[\n\r\t\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!sanitized)
            return entry;
        const tag = `[summary:${sanitized}] `;
        // Insert after header: [id] [date] [branch] [dsh-only] etc.
        // Simplify: find position after date/branch
        // Reuse logic: try to place after branch if present, else after date
        const idMatch = /^\[id:\s*[0-9a-f]{8}\]\s*/i.exec(entry);
        let offset = 0;
        let prefix = '';
        if (idMatch) {
            prefix += idMatch[0];
            offset += idMatch[0].length;
        }
        const dateMatch = /^\[(\d{4}-\d{2}-\d{2}[^\]]*)\]\s*/.exec(entry.slice(offset));
        if (dateMatch) {
            prefix += dateMatch[0];
            offset += dateMatch[0].length;
        }
        else {
            // daily time: [HH:MM]
            const timeMatch = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/.exec(entry.slice(offset));
            if (timeMatch) {
                prefix += timeMatch[0];
                offset += timeMatch[0].length;
            }
        }
        // branch
        const branchMatch = /^\[branch:[^\]]*\]\s*/.exec(entry.slice(offset));
        if (branchMatch) {
            prefix += branchMatch[0];
            offset += branchMatch[0].length;
        }
        // dsh-only
        const dshMatch = /^\[dsh-only\]\s*/.exec(entry.slice(offset));
        if (dshMatch) {
            prefix += dshMatch[0];
            offset += dshMatch[0].length;
        }
        // Insert summary before remaining body
        const rest = entry.slice(offset);
        // remove existing summary to avoid duplication
        const cleanedRest = rest.replace(/^\[summary:[^\]]*\]\s*/, '');
        return `${prefix}${tag}${cleanedRest}`;
    }
    ensureId(entry) {
        if (/^\[id:\s*[0-9a-f]{8}\]\s*/i.test(entry))
            return entry;
        return `[id:${genId()}] ${entry}`;
    }
    ensureDatePrefix(entry) {
        const t = String(entry).trim();
        if (/^\[(?:\d{4}-\d{2}-\d{2}|id:\s*[0-9a-f]{8}|branch:)/i.test(t))
            return t;
        // daily entries often have [HH:MM] — keep if present (but we still want date for non-daily)
        if (/^\[\d{1,2}:\d{2}(?::\d{2})?\]/.test(t))
            return t;
        return `[${todayStamp()} ${timeStamp()}] ${t}`;
    }
    ensureAutoSummary(entry, target) {
        if (target === 'daily')
            return entry;
        if (SUMMARY_TAG_RE.test(entry))
            return entry;
        const s = autoSummary(entry, 80).replace(/[\n\r\t\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!s)
            return entry;
        return `${entry.trimEnd()} [summary:${s}]`;
    }
    // -------------------------------------------------------------------------
    // Public API: add / list / replace / remove / archive / expand / snapshot
    // -------------------------------------------------------------------------
    /** List entries with optional query filters */
    list(target, cwd, opts = {}) {
        const t = normalizeTarget(target);
        if (opts.archived) {
            const af = this.archiveFileFor(t, cwd);
            let entries = readEntriesSync(af);
            return this.filterEntries(entries, opts);
        }
        // daily cross-file when since/until present; a single explicit date wins
        if (t === 'daily' && opts.date !== undefined) {
            let p;
            try {
                p = this.fileFor('daily', undefined, opts.date);
            }
            catch {
                // invalid date guards the tool's traversal surface; list returns empty
                return [];
            }
            return this.filterEntries(readEntriesSync(p), { ...opts, date: undefined });
        }
        if (t === 'daily' && (opts.since !== undefined || opts.until !== undefined)) {
            const dir = dailyDir(this.root());
            let days = [];
            try {
                days = readdirSync(dir)
                    .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
                    .map((n) => n.slice(0, 10))
                    .sort();
            }
            catch {
                days = [];
            }
            let rows = [];
            for (const day of days) {
                if (opts.since !== undefined && day < opts.since)
                    continue;
                if (opts.until !== undefined && day > opts.until)
                    continue;
                const p = dailyPath(this.root(), day);
                let entries = [];
                try {
                    entries = readEntriesSync(p);
                }
                catch {
                    continue;
                }
                for (const e of entries)
                    rows.push({ date: day, text: e });
            }
            // If no daily files matched but we still have today file that wasn't enumerated? Already covered via readdir.
            // Apply filter/recent/limit/branch (branch irrelevant for daily but keep)
            let texts = rows.map((r) => r.text);
            // Filter by content
            if (opts.filter) {
                const q = opts.filter.toLowerCase();
                texts = texts.filter((e) => e.toLowerCase().includes(q));
                rows = rows.filter((r) => r.text.toLowerCase().includes(q));
            }
            // Since/until already applied via file date, but also filter entries whose internal date extracted differs? Keep simple: already file-based.
            // Branch filter only for key; skip
            if (opts.recent)
                texts = [...texts].reverse();
            if (opts.limit !== undefined && Number.isFinite(opts.limit) && opts.limit > 0) {
                texts = texts.slice(0, Math.floor(opts.limit));
            }
            return texts;
        }
        const file = this.fileFor(t, cwd);
        let entries = readEntriesSync(file);
        // Branch filter for key (only when branch param provided and not empty)
        if (t === 'key' && opts.branch !== undefined && String(opts.branch).trim() !== '') {
            const b = String(opts.branch).trim();
            entries = entries.filter((e) => {
                const scope = parseEntryBranches(e);
                return scope === null || scope.includes(b);
            });
        }
        return this.filterEntries(entries, opts);
    }
    filterEntries(entries, opts) {
        let out = [...entries];
        if (opts.filter !== undefined && String(opts.filter).trim() !== '') {
            const q = String(opts.filter).toLowerCase();
            out = out.filter((e) => e.toLowerCase().includes(q));
        }
        if (opts.since !== undefined || opts.until !== undefined) {
            out = out.filter((e) => {
                const d = extractEntryDate(e);
                if (d === null)
                    return true; // undated survives date filters (per spec: not filtered out)
                if (opts.since !== undefined && d < opts.since)
                    return false;
                if (opts.until !== undefined && d > opts.until)
                    return false;
                return true;
            });
        }
        if (opts.recent)
            out = [...out].reverse();
        if (opts.limit !== undefined && Number.isFinite(opts.limit) && opts.limit > 0) {
            out = out.slice(0, Math.floor(opts.limit));
        }
        return out;
    }
    /** Add entry (with optional branches/summary for key) — hardened: auto date + auto summary + desensitize */
    add(target, entry, cwd, opts = {}) {
        try {
            this.assertNotBlocked();
        }
        catch (e) {
            return { ok: false, error: e?.message ?? String(e) };
        }
        const t = normalizeTarget(target);
        let content = String(entry ?? '').trim();
        if (!content)
            return { ok: false, error: 'empty content' };
        // Guard against idle-loop spam: reject trivial placeholder entries that carry
        // no new information (e.g. "Idle", "Idle — no change"). The snapshot
        // discipline now says to skip when idle, but keep a code-level guard as
        // defense-in-depth so a misbehaving model cannot flood daily/project.
        const trivialStripped = content.replace(/^\[.*?\]\s*/g, '').trim().toLowerCase();
        if (trivialStripped.startsWith('idle') ||
            trivialStripped.startsWith('no change') ||
            trivialStripped.startsWith('awaiting') ||
            trivialStripped.startsWith('waiting')) {
            // Idle/placeholder entries carry no new information; treat as duplicate/no-op
            // rather than error so the caller can proceed without retrying. Cap at 150
            // chars so legitimate long entries that merely mention "idle" are not blocked.
            if (trivialStripped.length < 150)
                return { ok: true, duplicate: true };
        }
        // Desensitize by default (opt-out via {desensitize:false} for tests/internal)
        const doDesensitize = opts.desensitize !== false;
        if (doDesensitize) {
            const s = desensitize(content);
            if (s === null)
                return { ok: false, error: 'content filtered (sensitive-only)' };
            content = s;
        }
        // Auto date prefix for all tracks (local calendar, preserves existing [id:/date/branch/time)
        content = this.ensureDatePrefix(content);
        // For key, handle branches and summary before id generation, then auto summary if still missing
        if (t === 'key') {
            if (opts.branches)
                content = this.applyBranchTag(content, opts.branches);
            if (opts.summary) {
                content = this.applySummaryTag(content, opts.summary);
            }
            content = this.ensureId(content);
            content = this.ensureAutoSummary(content, t);
        }
        else {
            content = this.ensureAutoSummary(content, t);
        }
        let file;
        try {
            file = this.fileFor(t, cwd, opts.date);
        }
        catch (e) {
            return { ok: false, error: e?.message ?? String(e) };
        }
        // Dedupe with stripped id+summary so summary difference doesn't create duplicate
        try {
            const existing = readEntriesSync(file);
            const stripForDedupe = (s) => s.replace(/\[summary:[^\]]*\]\s*/g, '').replace(/^\[id:\s*[0-9a-f]{8}\]\s*/i, '').trim();
            const probe = stripForDedupe(content);
            const isDup = existing.some((e) => stripForDedupe(e) === probe);
            if (isDup)
                return { ok: true, duplicate: true };
        }
        catch {
            // read failure → treat as no duplicate, let append handle it
        }
        const res = appendEntryAtomicSync(file, content);
        if (!res.ok)
            return { ok: false, error: res.error };
        if (res.duplicate)
            return { ok: true, duplicate: true };
        // Extract generated id if any
        const m = /^\[id:\s*([0-9a-f]{8})\]/i.exec(content);
        return { ok: true, id: m ? m[1].toLowerCase() : undefined };
    }
    /** Replace unique entry matching substring */
    replace(target, match, newContent, cwd, opts = {}) {
        try {
            this.assertNotBlocked();
        }
        catch (e) {
            return { ok: false, error: e?.message ?? String(e) };
        }
        const t = normalizeTarget(target);
        const oldText = String(match ?? '').trim();
        const newText = String(newContent ?? '').trim();
        if (!oldText)
            return { ok: false, error: 'empty match' };
        if (!newText)
            return { ok: false, error: 'empty new content' };
        let file;
        try {
            file = this.fileFor(t, cwd, opts.date);
        }
        catch (e) {
            return { ok: false, error: e?.message ?? String(e) };
        }
        // Read + modify + write inside the directory lock so a concurrent append by
        // another process is never clobbered by a stale read (cross-process safety).
        return withLockSync(dirname(file), () => {
            // Read current entries
            const entries = readEntriesSync(file);
            const matches = entries.filter((e) => e.includes(oldText));
            if (matches.length === 0)
                return { ok: false, error: `no match for "${oldText}"` };
            if (matches.length > 1)
                return { ok: false, error: `ambiguous match for "${oldText}" (${matches.length} hits)`, matches };
            // Preserve id if existing entry had one (for key)
            let replacement = newText;
            const oldEntry = matches[0];
            const oldId = /^\[id:\s*([0-9a-f]{8})\]\s*/i.exec(oldEntry)?.[1];
            if (oldId) {
                // If replacement doesn't already have id, prepend it
                if (!/^\[id:\s*[0-9a-f]{8}\]\s*/i.test(replacement)) {
                    replacement = `[id:${oldId.toLowerCase()}] ${replacement}`;
                }
            }
            replacement = this.ensureDatePrefix(replacement);
            replacement = this.ensureAutoSummary(replacement, t);
            const idx = entries.indexOf(oldEntry);
            const next = [...entries];
            next[idx] = replacement;
            const res = writeEntriesAtomicSync(file, next);
            if (!res.ok)
                return { ok: false, error: res.error };
            return { ok: true };
        });
    }
    /** Remove unique entry matching substring */
    remove(target, match, cwd, opts = {}) {
        try {
            this.assertNotBlocked();
        }
        catch (e) {
            return { ok: false, error: e?.message ?? String(e) };
        }
        const t = normalizeTarget(target);
        const oldText = String(match ?? '').trim();
        if (!oldText)
            return { ok: false, error: 'empty match' };
        let file;
        try {
            file = this.fileFor(t, cwd, opts.date);
        }
        catch (e) {
            return { ok: false, error: e?.message ?? String(e) };
        }
        return withLockSync(dirname(file), () => {
            const entries = readEntriesSync(file);
            // Use ID-immune exact? But remove is substring unique, not exact. Follow legacy: filter includes.
            const matches = entries.filter((e) => e.includes(oldText));
            if (matches.length === 0)
                return { ok: false, error: `no match for "${oldText}"` };
            if (matches.length > 1)
                return { ok: false, error: `ambiguous match for "${oldText}" (${matches.length} hits)`, matches };
            const idx = entries.indexOf(matches[0]);
            const next = [...entries];
            next.splice(idx, 1);
            const res = writeEntriesAtomicSync(file, next);
            if (!res.ok)
                return { ok: false, error: res.error };
            return { ok: true, removed: matches[0] };
        });
    }
    /** Archive-before-delete: move entry to archive then remove from main */
    archive(target, match, cwd) {
        try {
            this.assertNotBlocked();
        }
        catch (e) {
            return { ok: false, error: e?.message ?? String(e) };
        }
        const t = normalizeTarget(target);
        if (t !== 'memory' && t !== 'user' && t !== 'key' && t !== 'project') {
            return { ok: false, error: 'archive only for memory/user/key/project' };
        }
        const m = String(match ?? '').trim();
        if (!m)
            return { ok: false, error: 'empty match' };
        let mainFile;
        try {
            mainFile = this.fileFor(t, cwd);
        }
        catch (e) {
            return { ok: false, error: e?.message ?? String(e) };
        }
        return withLockSync(dirname(mainFile), () => {
            const entries = readEntriesSync(mainFile);
            const matches = entries.filter((e) => e.includes(m));
            if (matches.length === 0)
                return { ok: false, error: `no match for "${m}"` };
            if (matches.length > 1)
                return { ok: false, error: `ambiguous match for "${m}" (${matches.length} hits)` };
            const toArchive = matches[0];
            // Step 1: append to archive
            const archiveFile = this.archiveFileFor(t, cwd);
            const archRes = appendEntryAtomicSync(archiveFile, toArchive);
            if (!archRes.ok)
                return { ok: false, error: `archive append failed: ${archRes.error}` };
            // Step 2: remove from main only after archive succeeds
            const idx = entries.indexOf(toArchive);
            const next = [...entries];
            next.splice(idx, 1);
            const writeRes = writeEntriesAtomicSync(mainFile, next);
            if (!writeRes.ok) {
                // Archive already written, but main delete failed; report partial (archive succeeded)
                return { ok: false, error: `archive succeeded but remove failed: ${writeRes.error}` };
            }
            return { ok: true };
        });
    }
    /** List archive entries (with optional query) */
    listArchive(target, cwd, opts = {}) {
        const t = normalizeTarget(target);
        const af = this.archiveFileFor(t, cwd);
        let entries = readEntriesSync(af);
        return this.filterEntries(entries, opts);
    }
    /** Expand: load full entry by id for key (summary/expand) */
    expand(target, id, cwd) {
        const t = normalizeTarget(target);
        if (t !== 'key')
            return { ok: false, error: 'expand only for key' };
        const cleanId = String(id ?? '').trim().toLowerCase();
        if (!cleanId)
            return { ok: false, error: 'empty id' };
        if (!cwd)
            return { ok: false, error: 'key expand requires cwd' };
        const file = this.fileFor(t, cwd);
        const entries = readEntriesSync(file);
        // Branch filter: if current entries are branch-scoped, expand should respect branch? For simplicity, search all
        const found = entries.find((e) => e.toLowerCase().includes(`[id:${cleanId}]`) || e.toLowerCase().includes(cleanId));
        if (!found)
            return { ok: false, error: `no entry with id ${cleanId}` };
        return { ok: true, entry: found };
    }
    /** Get summary for display (explicit summary or auto) */
    summaryFor(entry) {
        const explicit = parseEntrySummary(entry);
        if (explicit !== null)
            return explicit;
        return autoSummary(entry);
    }
    // -------------------------------------------------------------------------
    // Legacy helpers for snapshot + simple lists
    // -------------------------------------------------------------------------
    listGlobal() {
        return this.list('memory');
    }
    listUser() {
        return this.list('user');
    }
    listKey(cwd, opts = {}) {
        return this.list('key', cwd, opts);
    }
    listDaily(cwd, date, opts = {}) {
        // For backward compat, daily list without date uses today
        if (date) {
            const p = dailyPath(this.root(), date);
            return this.filterEntries(readEntriesSync(p), opts);
        }
        return this.list('daily', undefined, opts);
    }
    listProject(cwd, opts = {}) {
        return this.list('project', cwd, opts);
    }
    addGlobal(entry) {
        return this.add('memory', entry);
    }
    addUser(entry) {
        return this.add('user', entry);
    }
    addKey(cwd, entry, opts = {}) {
        return this.add('key', entry, cwd, opts);
    }
    addDaily(entry, date) {
        const d = date ?? todayStamp();
        const file = dailyPath(this.root(), d);
        const res = appendEntryAtomicSync(file, entry);
        if (!res.ok)
            return { ok: false, error: res.error };
        return { ok: true, duplicate: res.duplicate };
    }
    addProject(cwd, entry) {
        return this.add('project', entry, cwd);
    }
    /** Bounded snapshot: memory + user + key (branch-filtered), excludes project/daily */
    snapshot(cwd, opts = {}) {
        const mem = this.list('memory');
        const user = this.list('user');
        const key = cwd ? this.list('key', cwd, opts.branch ? { branch: opts.branch } : {}) : [];
        const parts = [];
        if (mem.length)
            parts.push(`# Global Memory\n${mem.join('\n---\n')}`);
        if (user.length)
            parts.push(`# User Memory\n${user.join('\n---\n')}`);
        if (key.length)
            parts.push(`# Project Key Memory\n${key.join('\n---\n')}`);
        return parts.join('\n\n');
    }
    /** Snapshot that respects branch filter (same as above, explicit) */
    snapshotForBranch(cwd, branch) {
        return this.snapshot(cwd, { branch });
    }
}
// Re-export ArchiveStore for direct use (matches legacy)
export class MaestroArchiveStore {
    memoryDir;
    constructor(memoryDir = null) {
        this.memoryDir = memoryDir;
    }
    root() {
        return resolveMemoryRoot(this.memoryDir);
    }
    fileFor(target, cwd) {
        const r = this.root();
        const t = normalizeTarget(target);
        if (t === 'memory')
            return globalArchivePath(r);
        if (t === 'user')
            return userArchivePath(r);
        if (t === 'key') {
            if (!cwd)
                throw new Error('key archive requires cwd');
            return projectKeyArchivePath(r, cwd);
        }
        if (t === 'project') {
            if (!cwd)
                throw new Error('project archive requires cwd');
            return projectArchivePath(r, cwd);
        }
        throw new Error(`archive only for memory/user/key/project`);
    }
    entries(target, cwd) {
        return readEntriesSync(this.fileFor(target, cwd));
    }
    append(target, content, cwd) {
        const p = this.fileFor(target, cwd);
        const res = appendEntryAtomicSync(p, content);
        if (!res.ok)
            return { ok: false, error: res.error };
        return { ok: true };
    }
    remove(target, match, cwd) {
        const p = this.fileFor(target, cwd);
        const entries = readEntriesSync(p);
        const matches = entries.filter((e) => e.includes(match));
        if (matches.length === 0)
            return { ok: false, error: `no archive match for "${match}"` };
        if (matches.length > 1)
            return { ok: false, error: `ambiguous archive match` };
        const idx = entries.indexOf(matches[0]);
        const next = [...entries];
        next.splice(idx, 1);
        const res = writeEntriesAtomicSync(p, next);
        if (!res.ok)
            return { ok: false, error: res.error };
        return { ok: true };
    }
}
//# sourceMappingURL=store.js.map