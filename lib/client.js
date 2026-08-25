window.__ModuleLoader__.load({ id: "@ddtcorex/dsh-maestro-memory", factory: (require) => {
var __modules = {};
__modules["index.js"] = function (require, module, exports) {
"use strict";
/**
 * dsh-maestro-memory — client entry (M3-PR-A: Todos subtab + dtodo RPC)
 * Single conversation.view slot (id: maestro-memory, order 40) with internal tabs.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = void 0;
exports.apply = apply;
const React = __importStar(require("react"));
exports.inject = ['slots', 'sessions', 'connection'];
const RPC_CHANNEL = '/dsh-maestro-memory';
// Theme-aware style values. DSH exposes these as CSS custom properties that
// flip for light/dark (see Theme.listTokens). The previous hard-coded light
// hex values made the view unreadable on the dark theme: an inherited white
// label on white `#fff`/`#eee` buttons (white-on-white), plus bright `#ccc`/
// `#ddd` borders and dark `#333`/`#666` text that disappeared against the
// dark base. Using the --dsw-alias-* tokens keeps it readable in both themes.
const STYLE = {
    text: 'var(--dsw-alias-label-primary)',
    textSec: 'var(--dsw-alias-label-secondary)',
    borderL1: '1px solid var(--dsw-alias-border-l1)',
    borderL2: '1px solid var(--dsw-alias-border-l2)',
    surface: 'var(--dsw-alias-bg-layer-1)',
    // Active tab/target highlight — a filled overlay that reads as "selected" in
    // both themes (lighter over dark, grayish over light). Avoids bg-layer-2,
    // which collapses to white on the light theme.
    active: 'var(--dsw-alias-interactive-bg-active)',
    success: 'var(--dsw-alias-state-success-primary)',
    error: 'var(--dsw-alias-state-error-primary)',
    // Brand accent keeps white text (it's readable in both themes; the DSH
    // --dsw-alias-brand-primary token resolves to white here, which would make
    // white text invisible, so we don't use the token for a solid button fill).
    brand: '#06c',
    // Neutral secondary chip (Archive / Cancel / Undo): theme surface + primary label.
    neutral: 'var(--dsw-alias-bg-layer-2)',
    onAccent: '#fff', // white text on colored accents — readable in both themes
};
// Scoped design tokens for the view so it reads like a first-class DSH panel.
// Hover/focus/transition states are impossible with inline styles alone, so we
// attach a small <style> scoped to the .dshmem container. All colors come from
// the --dsw-alias-* theme tokens and flip with the DSH light/dark theme.
// Typography is deliberately NOT declared here: the container inherits the DSH
// text styles from the host tree (label-primary color, 16px/28px body text),
// and every child resolves its font through normal CSS inheritance — no more
// per-element `font: 13px system-ui` stamps that fight the host theme.
const MEM_CSS = `
.dshmem { color: var(--dsw-alias-label-primary); }
.dshmem button { cursor: pointer; transition: color .12s ease, background .12s ease, border-color .12s ease; }
.dshmem button:hover { color: var(--dsw-alias-label-primary); }
.dshmem button:active { transform: translateY(.5px); }
.dshmem button:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-active); outline-offset: 1px; }
.dshmem input, .dshmem textarea, .dshmem select { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 5px 8px; }
.dshmem input:focus, .dshmem textarea:focus, .dshmem select:focus { outline: none; border-color: var(--dsw-alias-border-l2); }
.dshmem textarea { resize: vertical; }
.dshmem .card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 10px; }
.dshmem .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dshmem .muted { color: var(--dsw-alias-label-secondary); }

/* Top-level view navigation — an underline tab bar (mirrors the DSH
 * Chat/Trajectory/Memory header tabs above it), NOT boxed chips, so it reads
 * as navigation and stays distinct from the memory-track filters below. */
.dshmem .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l1); margin-bottom: 14px; }
.dshmem .tab { appearance: none; background: transparent; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 7px 12px; border-radius: 0; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dshmem .tab:hover { color: var(--dsw-alias-label-primary); }
.dshmem .tab-active { color: var(--dsw-alias-label-primary); font-weight: 700; border-bottom-color: #06c; }

/* Memory-track / date filters + actions — one consistent control height so
 * nothing reflows or misaligns when a field appears/disappears. */
.dshmem .tracklabel { text-transform: uppercase; letter-spacing: .04em; color: var(--dsw-alias-label-secondary); }
.dshmem .control { height: 28px; display: inline-flex; align-items: center; gap: 6px; line-height: 1; }
.dshmem .pill { border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); padding: 0 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.dshmem .pill:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dshmem .pill-active { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); font-weight: 600; border-color: var(--dsw-alias-border-l2); }
.dshmem .ghost { border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); padding: 0 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.dshmem .ghost:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dshmem .cwd { box-sizing: border-box; height: 28px; flex: 1; min-width: 180px; padding: 0 10px; }
.dshmem .cwd:disabled { opacity: .5; cursor: not-allowed; }
.dshmem .cwd:disabled::placeholder { color: var(--dsw-alias-label-secondary); }
.dshmem .tabbadge { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 5px; margin-left: 6px; border-radius: 999px; background: var(--dsw-alias-state-error-primary, #d9534f); color: #fff; font-size: 11px; font-weight: 700; line-height: 1; vertical-align: middle; }
`;
// Global CSS for the top-level header tab badge (injected into <head> by the
// boot-time effect). Reuses DSH theme tokens so it flips with light/dark; a
// soft blink draws attention to pending reviews without being obnoxious.
const HEADER_BADGE_CSS = `
.dshmem-header-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 5px; margin-left: 6px; border-radius: 999px; background: var(--dsw-alias-state-error-primary, #d9534f); color: #fff; font-size: 11px; font-weight: 700; line-height: 1; vertical-align: middle; animation: dshmem-blink 1.2s ease-in-out infinite; }
@keyframes dshmem-blink { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
`;
// Best-effort current-session cwd, derived from the injected `sessions` feed
// (never `ctx.conversation` — that face is not injectable here, and touching a
// non-injected service throws `cannot get property ... without inject`).
// `ctx.sessions.list.getSnapshot()` returns `{ current, byId }`, and each row
// carries the session's canonical `cwd`. Undefined on a fresh page / no session.
function sessionCwd(ctx) {
    try {
        const snap = ctx?.sessions?.list?.getSnapshot?.();
        const id = snap?.current;
        if (!id)
            return '';
        return snap?.byId?.[id]?.cwd ?? '';
    }
    catch {
        return '';
    }
}
function useRpc(ctx) {
    return React.useCallback((endpoint, payload) => {
        const conn = ctx.connection ?? ctx.get?.('connection');
        if (!conn?.rpc?.call)
            return Promise.reject(new Error('RPC not available'));
        return conn.rpc.call(RPC_CHANNEL, endpoint, payload).then((result) => {
            if (result?.ok === true)
                return result.value;
            const message = typeof result?.error?.message === 'string' ? result.error.message : 'RPC request failed';
            throw new Error(message);
        });
    }, [ctx]);
}
function ReviewQueueView({ ctx, onPendingChange }) {
    const rpc = useRpc(ctx);
    const [entries, setEntries] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [edits, setEdits] = React.useState({});
    const [msg, setMsg] = React.useState('');
    const load = React.useCallback(async () => {
        setLoading(true);
        try {
            const res = await rpc('queue.list', {});
            const list = Array.isArray(res?.entries) ? res.entries : [];
            setEntries(list);
            onPendingChange?.(list.length);
        }
        catch (e) {
            setMsg(`load failed: ${e?.message ?? String(e)}`);
        }
        finally {
            setLoading(false);
        }
    }, [rpc, onPendingChange]);
    React.useEffect(() => {
        load();
    }, [load]);
    const decide = React.useCallback(async (action, index) => {
        setMsg('');
        const payload = { action, indices: [index] };
        if (action === 'approve' && edits[index] !== undefined && edits[index].trim() !== '') {
            payload.edits = { [String(index)]: edits[index] };
        }
        try {
            const res = await rpc('queue.decide', payload);
            if (res?.ok) {
                setMsg(res.lines ? res.lines.join('; ') : `${action} ok`);
                await load();
            }
            else {
                setMsg(`failed: ${res?.error ?? 'unknown'}`);
            }
        }
        catch (e) {
            setMsg(`error: ${e?.message ?? String(e)}`);
        }
    }, [rpc, edits, load]);
    if (loading)
        return React.createElement('div', null, 'Loading queue…');
    if (entries.length === 0) {
        return React.createElement('div', null, React.createElement('div', { style: { opacity: 0.7, marginBottom: 8 } }, 'No pending suggestions'), msg ? React.createElement('div', { style: { color: STYLE.textSec } }, msg) : null, React.createElement('button', { onClick: load, style: { marginTop: 8 } }, 'Refresh'));
    }
    return React.createElement('div', null, React.createElement('div', { style: { marginBottom: 8, opacity: 0.7 } }, `${entries.length} pending`), ...entries.map((e, idx) => {
        const number = idx + 1;
        return React.createElement('div', {
            key: number,
            style: { border: STYLE.borderL1, borderRadius: 8, padding: 8, marginBottom: 8 },
        }, React.createElement('div', { style: { fontWeight: 600 } }, `#${number} [${e.target}]`), React.createElement('div', { style: { margin: '4px 0', whiteSpace: 'pre-wrap' } }, e.content), e.reason ? React.createElement('div', { style: { opacity: 0.7 } }, `Reason: ${e.reason}`) : null, React.createElement('textarea', {
            value: edits[number] ?? '',
            placeholder: 'Edit content before approve (optional)',
            onChange: (ev) => setEdits((prev) => ({ ...prev, [number]: ev.target.value })),
            style: { width: '100%', minHeight: 40, marginTop: 4 },
        }), React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 8 } }, React.createElement('button', {
            onClick: () => decide('approve', number),
            'data-testid': `approve-${number}`,
            style: { background: STYLE.success, color: STYLE.onAccent, border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
        }, 'Approve'), React.createElement('button', {
            onClick: () => decide('reject', number),
            'data-testid': `reject-${number}`,
            style: { background: STYLE.error, color: STYLE.onAccent, border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
        }, 'Reject'), React.createElement('button', {
            onClick: () => decide('archive', number),
            'data-testid': `archive-${number}`,
            style: { background: STYLE.neutral, color: STYLE.text, border: STYLE.borderL1, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
        }, 'Archive')));
    }), msg ? React.createElement('div', { style: { marginTop: 8, color: STYLE.text } }, msg) : null, React.createElement('button', { onClick: load, style: { marginTop: 8 } }, 'Refresh'));
}
function TodosView({ ctx }) {
    const rpc = useRpc(ctx);
    const [items, setItems] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [msg, setMsg] = React.useState('');
    const [target, setTarget] = React.useState('all');
    const [showAll, setShowAll] = React.useState(false);
    const [showPast, setShowPast] = React.useState(false);
    const [showExpired, setShowExpired] = React.useState(false);
    const [draftContent, setDraftContent] = React.useState('');
    const [draftTarget, setDraftTarget] = React.useState('work');
    const [draftDue, setDraftDue] = React.useState('');
    const [draftQuadrant, setDraftQuadrant] = React.useState('');
    const [draftCat, setDraftCat] = React.useState('');
    const [editId, setEditId] = React.useState(null);
    const [editContent, setEditContent] = React.useState('');
    const [editDue, setEditDue] = React.useState('');
    const [editQuadrant, setEditQuadrant] = React.useState('');
    const [editStatus, setEditStatus] = React.useState('');
    const [editCat, setEditCat] = React.useState('');
    const load = React.useCallback(async () => {
        setLoading(true);
        setMsg('');
        try {
            const rpcPayload = {
                target: target !== 'all' ? target : undefined,
                opts: {
                    all: showAll,
                    past: showPast,
                    expired: showExpired,
                },
            };
            // For single target we need to pass correctly; todo.list expects target or targets
            const res = await rpc('todo.list', rpcPayload);
            const list = Array.isArray(res?.items) ? res.items : [];
            setItems(list);
            if (res?.hint)
                setMsg(res.hint);
            else if (res?.text) {
                // fallback: text contains items but we already have items
            }
        }
        catch (e) {
            setMsg(`load failed: ${e?.message ?? String(e)}`);
        }
        finally {
            setLoading(false);
        }
    }, [rpc, target, showAll, showPast, showExpired]);
    React.useEffect(() => {
        load();
    }, [load]);
    const addTodo = React.useCallback(async () => {
        const content = draftContent.trim();
        if (!content) {
            setMsg('content required');
            return;
        }
        setMsg('');
        try {
            const res = await rpc('todo.mutate', {
                action: 'add',
                target: draftTarget,
                content,
                due: draftDue || undefined,
                quadrant: draftQuadrant || undefined,
                cat: draftCat || undefined,
            });
            if (res?.ok) {
                setDraftContent('');
                setDraftDue('');
                setDraftQuadrant('');
                setDraftCat('');
                setMsg(`added (id: ${res.id})`);
                await load();
            }
            else {
                setMsg(`add failed: ${res?.message ?? res?.error ?? 'unknown'}`);
            }
        }
        catch (e) {
            setMsg(`error: ${e?.message ?? String(e)}`);
        }
    }, [rpc, draftContent, draftTarget, draftDue, draftQuadrant, draftCat, load]);
    const doneTodo = React.useCallback(async (item) => {
        try {
            const res = await rpc('todo.mutate', { action: 'done', target: item.target, id: item.id });
            if (res?.ok) {
                setMsg(res.message ?? 'done');
                await load();
            }
            else
                setMsg(`done failed: ${res?.message ?? res?.error}`);
        }
        catch (e) {
            setMsg(`error: ${e?.message ?? String(e)}`);
        }
    }, [rpc, load]);
    const undoTodo = React.useCallback(async (item) => {
        try {
            // Re-open a done todo: set status back to pending (only if currently done).
            const res = await rpc('todo.mutate', { action: 'update', target: item.target, id: item.id, status: 'pending' });
            if (res?.ok) {
                setMsg(res.message ?? 'undone');
                await load();
            }
            else
                setMsg(`undo failed: ${res?.message ?? res?.error}`);
        }
        catch (e) {
            setMsg(`error: ${e?.message ?? String(e)}`);
        }
    }, [rpc, load]);
    const removeTodo = React.useCallback(async (item) => {
        try {
            const res = await rpc('todo.mutate', { action: 'remove', target: item.target, id: item.id });
            if (res?.ok) {
                setMsg(res.message ?? 'removed');
                await load();
            }
            else
                setMsg(`remove failed: ${res?.message ?? res?.error}`);
        }
        catch (e) {
            setMsg(`error: ${e?.message ?? String(e)}`);
        }
    }, [rpc, load]);
    const startEdit = (item) => {
        setEditId(item.id);
        setEditContent(item.text ?? '');
        setEditDue(item.due ?? '');
        setEditQuadrant(item.quadrant ?? '');
        setEditStatus(item.status ?? 'pending');
        setEditCat(item.cat ?? '');
    };
    const saveEdit = React.useCallback(async (item) => {
        try {
            const patch = {};
            if (editContent !== item.text)
                patch.content = editContent;
            if (editQuadrant !== (item.quadrant ?? ''))
                patch.quadrant = editQuadrant || null;
            if (editDue !== (item.due ?? ''))
                patch.due = editDue || null;
            if (editStatus !== item.status)
                patch.status = editStatus;
            if (editCat !== (item.cat ?? ''))
                patch.cat = editCat || null;
            const res = await rpc('todo.mutate', {
                action: 'update',
                target: item.target,
                id: item.id,
                ...patch,
            });
            if (res?.ok) {
                setEditId(null);
                setMsg(res.message ?? 'updated');
                await load();
            }
            else
                setMsg(`update failed: ${res?.message ?? res?.error}`);
        }
        catch (e) {
            setMsg(`error: ${e?.message ?? String(e)}`);
        }
    }, [rpc, editContent, editDue, editQuadrant, editStatus, editCat, load]);
    return React.createElement('div', null, React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } }, ['all', 'life', 'work', 'project', 'daily'].map((k) => React.createElement('button', {
        key: k,
        onClick: () => setTarget(k),
        'data-testid': `todo-target-${k}`,
        style: {
            fontWeight: target === k ? 700 : 400,
            padding: '4px 8px',
            borderRadius: 6,
            border: target === k ? STYLE.borderL2 : STYLE.borderL1,
            background: target === k ? STYLE.active : STYLE.surface,
            color: STYLE.text,
            cursor: 'pointer',
        },
    }, k))), React.createElement('div', { style: { display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' } }, React.createElement('label', { style: { display: 'flex', gap: 4, alignItems: 'center' } }, React.createElement('input', {
        type: 'checkbox',
        checked: showAll,
        onChange: (e) => setShowAll(e.target.checked),
        'data-testid': 'todo-all',
    }), 'all (no limit)'), React.createElement('label', { style: { display: 'flex', gap: 4, alignItems: 'center' } }, React.createElement('input', {
        type: 'checkbox',
        checked: showPast,
        onChange: (e) => setShowPast(e.target.checked),
        'data-testid': 'todo-past',
    }), 'past'), React.createElement('label', { style: { display: 'flex', gap: 4, alignItems: 'center' } }, React.createElement('input', {
        type: 'checkbox',
        checked: showExpired,
        onChange: (e) => setShowExpired(e.target.checked),
        'data-testid': 'todo-expired',
    }), 'expired'), React.createElement('button', { onClick: load, style: { padding: '4px 8px' }, 'data-testid': 'todo-refresh' }, 'Refresh')), React.createElement('div', { style: { border: STYLE.borderL1, borderRadius: 8, padding: 8, marginBottom: 12 } }, React.createElement('div', { style: { fontWeight: 600, marginBottom: 6 } }, 'Add todo'), React.createElement('textarea', {
        value: draftContent,
        placeholder: 'Todo content',
        onChange: (e) => setDraftContent(e.target.value),
        style: { width: '100%', minHeight: 40, marginBottom: 6 },
        'data-testid': 'todo-add-content',
    }), React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 } }, React.createElement('select', {
        value: draftTarget,
        onChange: (e) => setDraftTarget(e.target.value),
        style: { padding: '4px' },
        'data-testid': 'todo-add-target',
    }, ['life', 'work', 'project', 'daily'].map((t) => React.createElement('option', { key: t, value: t }, t))), React.createElement('select', {
        value: draftQuadrant,
        onChange: (e) => setDraftQuadrant(e.target.value),
        style: { padding: '4px' },
        'data-testid': 'todo-add-quadrant',
    }, React.createElement('option', { value: '' }, 'quadrant'), React.createElement('option', { value: 'q1' }, 'q1'), React.createElement('option', { value: 'q2' }, 'q2'), React.createElement('option', { value: 'q3' }, 'q3'), React.createElement('option', { value: 'q4' }, 'q4')), React.createElement('input', {
        value: draftDue,
        placeholder: 'due YYYY-MM-DD',
        onChange: (e) => setDraftDue(e.target.value),
        style: { padding: '4px', width: 120 },
        'data-testid': 'todo-add-due',
    }), React.createElement('input', {
        value: draftCat,
        placeholder: 'cat',
        onChange: (e) => setDraftCat(e.target.value),
        style: { padding: '4px', width: 80 },
        'data-testid': 'todo-add-cat',
    })), React.createElement('button', {
        onClick: addTodo,
        style: { background: STYLE.success, color: STYLE.onAccent, border: 0, borderRadius: 4, padding: '6px 12px', cursor: 'pointer' },
        'data-testid': 'todo-add-btn',
    }, 'Add')), msg ? React.createElement('div', { style: { color: STYLE.text, marginBottom: 8, whiteSpace: 'pre-wrap' } }, msg) : null, loading
        ? React.createElement('div', null, 'Loading todos…')
        : items.length === 0
            ? React.createElement('div', { style: { opacity: 0.7 } }, 'No todos (smart view: overdue / due today / current project / Q1-Q2, max 8). Try "all" or "past".')
            : React.createElement('div', null, React.createElement('div', { style: { opacity: 0.7, marginBottom: 6 } }, `${items.length} todos${!showAll && items.length === 8 ? ' (smart view limited to 8)' : ''}`), ...items.map((it) => React.createElement('div', { key: it.id, style: { border: STYLE.borderL1, borderRadius: 8, padding: 8, marginBottom: 8 } }, React.createElement('div', { style: { opacity: 0.7 } }, `[${it.target}]`, it.quadrant ? ` [${it.quadrant}]` : '', it.due ? ` [due:${it.due}]` : '', it.status !== 'pending' ? ` [${it.status}]` : '', it.cat ? ` [cat:${it.cat}]` : '', it.doneAt ? ` [done:${it.doneAt}]` : '', it.past ? ` [past ${it.day}]` : '', ` id:${it.id}`), editId === it.id
                ? React.createElement('div', null, React.createElement('textarea', {
                    value: editContent,
                    onChange: (e) => setEditContent(e.target.value),
                    style: { width: '100%', minHeight: 40, marginTop: 4 },
                    'data-testid': `todo-edit-content-${it.id}`,
                }), React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } }, React.createElement('select', {
                    value: editQuadrant,
                    onChange: (e) => setEditQuadrant(e.target.value),
                    'data-testid': `todo-edit-quadrant-${it.id}`,
                }, React.createElement('option', { value: '' }, 'no quadrant'), React.createElement('option', { value: 'q1' }, 'q1'), React.createElement('option', { value: 'q2' }, 'q2'), React.createElement('option', { value: 'q3' }, 'q3'), React.createElement('option', { value: 'q4' }, 'q4')), React.createElement('input', {
                    value: editDue,
                    placeholder: 'due YYYY-MM-DD',
                    onChange: (e) => setEditDue(e.target.value),
                    style: { width: 120 },
                    'data-testid': `todo-edit-due-${it.id}`,
                }), React.createElement('select', {
                    value: editStatus,
                    onChange: (e) => setEditStatus(e.target.value),
                    'data-testid': `todo-edit-status-${it.id}`,
                }, ['pending', 'doing', 'done', 'blocked', 'cancelled'].map((s) => React.createElement('option', { key: s, value: s }, s))), React.createElement('input', {
                    value: editCat,
                    placeholder: 'cat',
                    onChange: (e) => setEditCat(e.target.value),
                    style: { width: 80 },
                    'data-testid': `todo-edit-cat-${it.id}`,
                })), React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 8 } }, React.createElement('button', {
                    onClick: () => saveEdit(it),
                    style: { background: STYLE.success, color: STYLE.onAccent, border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
                    'data-testid': `todo-save-${it.id}`,
                }, 'Save'), React.createElement('button', {
                    onClick: () => setEditId(null),
                    style: { background: STYLE.neutral, color: STYLE.text, border: STYLE.borderL1, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
                    'data-testid': `todo-cancel-${it.id}`,
                }, 'Cancel')))
                : React.createElement('div', null, React.createElement('div', { style: { margin: '4px 0', whiteSpace: 'pre-wrap' } }, it.text), React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' } }, React.createElement('button', {
                    onClick: () => (it.status === 'done' ? undoTodo(it) : doneTodo(it)),
                    style: { background: it.status === 'done' ? STYLE.neutral : STYLE.success, color: it.status === 'done' ? STYLE.text : STYLE.onAccent, border: it.status === 'done' ? STYLE.borderL1 : 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
                    'data-testid': `todo-done-${it.id}`,
                }, it.status === 'done' ? 'Undo' : 'Done'), React.createElement('button', {
                    onClick: () => startEdit(it),
                    style: { background: STYLE.brand, color: STYLE.onAccent, border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
                    'data-testid': `todo-edit-${it.id}`,
                }, 'Edit'), React.createElement('button', {
                    onClick: () => removeTodo(it),
                    style: { background: STYLE.error, color: STYLE.onAccent, border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
                    'data-testid': `todo-remove-${it.id}`,
                }, 'Remove')))))));
}
function SkillsView({ ctx }) {
    const rpc = useRpc(ctx);
    const [entries, setEntries] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [msg, setMsg] = React.useState('');
    const load = React.useCallback(async () => {
        setLoading(true);
        setMsg('');
        try {
            const res = await rpc('skills.list', {});
            if (res?.ok) {
                setEntries(Array.isArray(res.entries) ? res.entries : []);
                if (res.entries.length === 0)
                    setMsg('No skills found (maestro-skills not installed or empty)');
            }
            else {
                setMsg(`load failed: ${res?.error ?? 'unknown'}`);
            }
        }
        catch (e) {
            setMsg(`error: ${e?.message ?? String(e)}`);
        }
        finally {
            setLoading(false);
        }
    }, [rpc]);
    React.useEffect(() => {
        load();
    }, [load]);
    if (loading)
        return React.createElement('div', null, 'Loading skills…');
    return React.createElement('div', null, React.createElement('div', { style: { opacity: 0.7, marginBottom: 8 } }, `${entries.length} skills (read-only browser, metadata/origin only — maestro-skills discovery unchanged)`), entries.length === 0
        ? React.createElement('div', { style: { opacity: 0.7 } }, msg || 'No skills')
        : React.createElement('div', null, ...entries.map((e) => React.createElement('div', { key: e.name, style: { border: STYLE.borderL1, borderRadius: 8, padding: 8, marginBottom: 8 } }, React.createElement('div', { style: { fontWeight: 600 } }, e.name), React.createElement('div', { style: { opacity: 0.7 } }, `[${e.origin}] ${e.path}`), React.createElement('div', { style: { margin: '4px 0', whiteSpace: 'pre-wrap' } }, e.description), e.metadata && Object.keys(e.metadata).length > 0
            ? React.createElement('div', { style: { opacity: 0.6, marginTop: 4 } }, `metadata: ${Object.entries(e.metadata)
                .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
                .join(', ')}`)
            : null))), msg ? React.createElement('div', { style: { marginTop: 8, color: STYLE.text } }, msg) : null, React.createElement('button', { onClick: load, style: { marginTop: 8, padding: '4px 8px' }, 'data-testid': 'skills-refresh' }, 'Refresh'), React.createElement('div', { style: { marginTop: 8, opacity: 0.6 } }, 'Read-only — model suggestions cannot change skills. Future edits, if approved, will require explicit user action + path containment.'));
}
function MemoryListView({ ctx }) {
    const rpc = useRpc(ctx);
    const [track, setTrack] = React.useState('key');
    const [cwd, setCwd] = React.useState(() => sessionCwd(ctx));
    const [entries, setEntries] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [msg, setMsg] = React.useState('');
    const needsCwd = track === 'key' || track === 'project';
    const load = React.useCallback(async () => {
        setLoading(true);
        setMsg('');
        try {
            if (needsCwd && !cwd.trim()) {
                setEntries([]);
                setMsg('cwd required for the key/project track');
                setLoading(false);
                return;
            }
            const res = await rpc('memory.list', { target: track, cwd: needsCwd ? cwd.trim() : undefined });
            setEntries(Array.isArray(res?.entries) ? res.entries : []);
        }
        catch (e) {
            setMsg(`load failed: ${e?.message ?? String(e)}`);
        }
        finally {
            setLoading(false);
        }
    }, [rpc, track, cwd, needsCwd]);
    React.useEffect(() => {
        load();
    }, [load]);
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, React.createElement('div', { className: 'row', style: { alignItems: 'center', gap: 6 } }, React.createElement('span', { className: 'tracklabel' }, 'Track'), ['memory', 'user', 'key', 'project', 'daily'].map((k) => React.createElement('button', {
        key: k,
        onClick: () => setTrack(k),
        'aria-pressed': track === k,
        className: track === k ? 'control pill pill-active' : 'control pill',
        'data-testid': `mem-track-${k}`,
    }, k))), React.createElement('div', { className: 'row', style: { alignItems: 'center' } }, React.createElement('input', {
        value: cwd,
        disabled: !needsCwd,
        placeholder: needsCwd ? 'cwd (for key/project)' : 'cwd is not used for this track',
        onChange: (e) => setCwd(e.target.value),
        'data-testid': 'mem-cwd',
        className: 'cwd',
    }), React.createElement('button', { onClick: load, className: 'control ghost', 'data-testid': 'mem-refresh' }, 'Refresh')), msg ? React.createElement('div', { className: 'muted' }, msg) : null, loading
        ? React.createElement('div', null, 'Loading memory…')
        : entries.length === 0
            ? React.createElement('div', { className: 'muted' }, '(no entries)')
            : React.createElement('div', null, React.createElement('div', { className: 'muted', style: { marginBottom: 6 } }, `${entries.length} entries`), ...entries.map((e, idx) => React.createElement('div', { key: idx, className: 'card', style: { marginBottom: 8 } }, React.createElement('div', { style: { whiteSpace: 'pre-wrap' } }, e)))));
}
function MemoryView({ ctx }) {
    const rpc = useRpc(ctx);
    const [tab, setTab] = React.useState('memory');
    const [pending, setPending] = React.useState(0);
    const refreshPending = React.useCallback(async () => {
        try {
            const res = await rpc('status', {});
            setPending(typeof res?.queue === 'number' ? res.queue : 0);
        }
        catch {
            setPending(0);
        }
    }, [rpc]);
    React.useEffect(() => {
        refreshPending();
    }, [refreshPending, tab]);
    return React.createElement('div', { className: 'dshmem', style: { padding: 16, color: STYLE.text, display: 'flex', flexDirection: 'column' } }, React.createElement('style', null, MEM_CSS), React.createElement('div', { className: 'tabs', role: 'tablist' }, ['memory', 'review', 'todos', 'skills'].map((k) => React.createElement('button', {
        key: k,
        role: 'tab',
        'aria-selected': tab === k,
        onClick: () => setTab(k),
        className: tab === k ? 'tab tab-active' : 'tab',
        'data-testid': `tab-${k}`,
    }, k, k === 'review' && pending > 0
        ? React.createElement('span', { className: 'tabbadge', 'data-testid': 'tab-badge-review' }, String(pending))
        : null))), tab === 'memory'
        ? React.createElement(MemoryListView, { ctx })
        : tab === 'review'
            ? React.createElement(ReviewQueueView, { ctx, onPendingChange: setPending })
            : tab === 'todos'
                ? React.createElement(TodosView, { ctx })
                : React.createElement(SkillsView, { ctx }));
}
function apply(ctx) {
    ctx.effect(() => {
        const dispose = ctx.slots.inject('conversation.view', () => ctx.slots.register({
            name: 'conversation.view',
            id: 'maestro-memory',
            order: 40,
            label: () => 'Memory',
        }, () => React.createElement(MemoryView, { ctx })));
        return () => {
            if (typeof dispose === 'function')
                dispose();
        };
    }, 'maestro-memory: view');
    // Top-level header tab badge: pending-suggestion count, with a soft blink,
    // injected into the DSH shell header tab labeled "Memory". DSH projects
    // 'conversation.view' tabs as plain string labels (ViewTab.label), so there is
    // no React slot to render into — the plugin reaches the shell DOM directly
    // (same technique as the mobile nav plugin).
    ctx.effect(() => {
        const conn = ctx.connection ?? ctx.get?.('connection');
        if (!conn?.rpc?.call)
            return () => { };
        const BADGE_ATTR = 'data-dshmem-header-badge';
        const VIEW_ATTR = 'data-dshmem-memory-tab';
        const findMemoryTab = () => {
            const tabs = document.querySelectorAll('button[role="tab"]');
            for (const tab of Array.from(tabs)) {
                if (tab.getAttribute(VIEW_ATTR) === '1')
                    return tab;
            }
            for (const tab of Array.from(tabs)) {
                if (tab.closest('.dshmem'))
                    continue;
                if ((tab.textContent ?? '').trim() === 'Memory') {
                    tab.setAttribute(VIEW_ATTR, '1');
                    return tab;
                }
            }
            return null;
        };
        const renderBadge = (count) => {
            const tab = findMemoryTab();
            if (!tab)
                return;
            const existing = tab.querySelector(`[${BADGE_ATTR}]`);
            if (count <= 0) {
                if (existing)
                    existing.remove();
                return;
            }
            if (existing && existing.textContent === String(count))
                return;
            if (existing)
                existing.remove();
            const badge = document.createElement('span');
            badge.setAttribute(BADGE_ATTR, '');
            badge.className = 'dshmem-header-badge';
            badge.textContent = String(count);
            tab.appendChild(badge);
        };
        let styleEl = document.getElementById('dshmem-header-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'dshmem-header-style';
            styleEl.textContent = HEADER_BADGE_CSS;
            document.head.appendChild(styleEl);
        }
        let disposed = false;
        let lastCount = 0;
        const refresh = async () => {
            if (disposed)
                return;
            try {
                const result = await conn.rpc.call(RPC_CHANNEL, 'status', {});
                const value = result?.ok === true ? result.value : null;
                lastCount = typeof value?.queue === 'number' ? value.queue : 0;
                renderBadge(lastCount);
            }
            catch {
                lastCount = 0;
                renderBadge(0);
            }
        };
        void refresh();
        const timer = window.setInterval(() => {
            void refresh();
        }, 8000);
        const observer = new MutationObserver(() => {
            if (disposed)
                return;
            const tab = findMemoryTab();
            if (!tab)
                return;
            const hasBadge = tab.querySelector(`[${BADGE_ATTR}]`);
            if (lastCount > 0 && !hasBadge)
                renderBadge(lastCount);
            else if (lastCount <= 0 && hasBadge)
                renderBadge(0);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => {
            disposed = true;
            window.clearInterval(timer);
            observer.disconnect();
            styleEl?.remove();
            const tab = findMemoryTab();
            if (tab)
                tab.querySelector(`[${BADGE_ATTR}]`)?.remove();
        };
    }, 'maestro-memory: header-badge');
}
};
var __cache = {};
function __localRequire(id) {
  if (id.charCodeAt(0) !== 46) return require(id);
  id = id.slice(2);
  var cached = __cache[id];
  if (cached) return cached.exports;
  var module = { exports: {} };
  __cache[id] = module;
  __modules[id](__localRequire, module, module.exports);
  return module.exports;
}
var module = { exports: {} };
__modules["index.js"](__localRequire, module, module.exports);
return module.exports; } });
