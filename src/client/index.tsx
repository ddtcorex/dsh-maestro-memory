/**
 * dsh-maestro-memory — client entry (M3-PR-A: Todos subtab + dtodo RPC)
 * Single conversation.view slot (id: maestro-memory, order 40) with internal tabs.
 */

import * as React from 'react'

export const inject = ['slots', 'locale', 'conversation', 'sessions', 'connection'] as const

const RPC_CHANNEL = '/dsh-maestro-memory'

function useRpc(ctx: any) {
  return React.useCallback(
    (endpoint: string, payload: any) => {
      const conn = (ctx as any).connection ?? (ctx as any).get?.('connection')
      if (!conn?.rpc?.call) return Promise.reject(new Error('RPC not available'))
      return conn.rpc.call(RPC_CHANNEL, endpoint, payload).then((result: any) => {
        if (result?.ok === true) return result.value
        const message = typeof result?.error?.message === 'string' ? result.error.message : 'RPC request failed'
        throw new Error(message)
      })
    },
    [ctx],
  )
}

function ReviewQueueView({ ctx }: { ctx: any }): React.ReactElement {
  const rpc = useRpc(ctx)
  const [entries, setEntries] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [edits, setEdits] = React.useState<Record<number, string>>({})
  const [msg, setMsg] = React.useState<string>('')

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res: any = await rpc('queue.list', {})
      setEntries(Array.isArray(res?.entries) ? res.entries : [])
    } catch (e: any) {
      setMsg(`load failed: ${e?.message ?? String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [rpc])

  React.useEffect(() => {
    load()
  }, [load])

  const decide = React.useCallback(
    async (action: 'approve' | 'reject' | 'archive', index: number) => {
      setMsg('')
      const payload: any = { action, indices: [index] }
      if (action === 'approve' && edits[index] !== undefined && edits[index].trim() !== '') {
        payload.edits = { [String(index)]: edits[index] }
      }
      try {
        const res: any = await rpc('queue.decide', payload)
        if (res?.ok) {
          setMsg(res.lines ? res.lines.join('; ') : `${action} ok`)
          await load()
        } else {
          setMsg(`failed: ${res?.error ?? 'unknown'}`)
        }
      } catch (e: any) {
        setMsg(`error: ${e?.message ?? String(e)}`)
      }
    },
    [rpc, edits, load],
  )

  if (loading) return React.createElement('div', null, 'Loading queue…')

  if (entries.length === 0) {
    return React.createElement(
      'div',
      null,
      React.createElement('div', { style: { opacity: 0.7, marginBottom: 8 } }, 'No pending suggestions'),
      msg ? React.createElement('div', { style: { fontSize: 12, color: '#666' } }, msg) : null,
      React.createElement('button', { onClick: load, style: { marginTop: 8 } }, 'Refresh'),
    )
  }

  return React.createElement(
    'div',
    null,
    React.createElement('div', { style: { marginBottom: 8, fontSize: 12, opacity: 0.7 } }, `${entries.length} pending`),
    ...entries.map((e: any, idx: number) => {
      const number = idx + 1
      return React.createElement(
        'div',
        {
          key: number,
          style: { border: '1px solid #ddd', borderRadius: 8, padding: 8, marginBottom: 8 },
        },
        React.createElement('div', { style: { fontWeight: 600 } }, `#${number} [${e.target}]`),
        React.createElement('div', { style: { margin: '4px 0', whiteSpace: 'pre-wrap' } }, e.content),
        e.reason ? React.createElement('div', { style: { fontSize: 12, opacity: 0.7 } }, `Reason: ${e.reason}`) : null,
        React.createElement('textarea', {
          value: edits[number] ?? '',
          placeholder: 'Edit content before approve (optional)',
          onChange: (ev: any) => setEdits((prev) => ({ ...prev, [number]: ev.target.value })),
          style: { width: '100%', minHeight: 40, marginTop: 4, fontSize: 12 },
        }),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: 8, marginTop: 8 } },
          React.createElement(
            'button',
            {
              onClick: () => decide('approve', number),
              'data-testid': `approve-${number}`,
              style: { background: '#2d7', color: '#fff', border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
            },
            'Approve',
          ),
          React.createElement(
            'button',
            {
              onClick: () => decide('reject', number),
              'data-testid': `reject-${number}`,
              style: { background: '#d33', color: '#fff', border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
            },
            'Reject',
          ),
          React.createElement(
            'button',
            {
              onClick: () => decide('archive', number),
              'data-testid': `archive-${number}`,
              style: { background: '#888', color: '#fff', border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer' },
            },
            'Archive',
          ),
        ),
      )
    }),
    msg ? React.createElement('div', { style: { marginTop: 8, fontSize: 12, color: '#333' } }, msg) : null,
    React.createElement('button', { onClick: load, style: { marginTop: 8 } }, 'Refresh'),
  )
}

function TodosView({ ctx }: { ctx: any }): React.ReactElement {
  const rpc = useRpc(ctx)
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [msg, setMsg] = React.useState<string>('')
  const [target, setTarget] = React.useState<string>('all')
  const [showAll, setShowAll] = React.useState(false)
  const [showPast, setShowPast] = React.useState(false)
  const [showExpired, setShowExpired] = React.useState(false)
  const [draftContent, setDraftContent] = React.useState('')
  const [draftTarget, setDraftTarget] = React.useState<string>('work')
  const [draftDue, setDraftDue] = React.useState('')
  const [draftQuadrant, setDraftQuadrant] = React.useState<string>('')
  const [draftCat, setDraftCat] = React.useState('')
  const [editId, setEditId] = React.useState<string | null>(null)
  const [editContent, setEditContent] = React.useState('')
  const [editDue, setEditDue] = React.useState('')
  const [editQuadrant, setEditQuadrant] = React.useState('')
  const [editStatus, setEditStatus] = React.useState('')
  const [editCat, setEditCat] = React.useState('')

  const load = React.useCallback(async () => {
    setLoading(true)
    setMsg('')
    try {
      const payload: any = {}
      if (target !== 'all') payload.target = target
      else payload.targets = undefined
      // Map target 'all' to no target => RPC defaults to all four
      const rpcPayload: any = {
        target: target !== 'all' ? target : undefined,
        targets: target === 'all' ? undefined : undefined,
        opts: {
          all: showAll,
          past: showPast,
          expired: showExpired,
        },
      }
      // For single target we need to pass correctly; todo.list expects target or targets
      const res: any = await rpc('todo.list', rpcPayload)
      const list = Array.isArray(res?.items) ? res.items : []
      setItems(list)
      if (res?.hint) setMsg(res.hint)
      else if (res?.text) {
        // fallback: text contains items but we already have items
      }
    } catch (e: any) {
      setMsg(`load failed: ${e?.message ?? String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [rpc, target, showAll, showPast, showExpired])

  React.useEffect(() => {
    load()
  }, [load])

  const addTodo = React.useCallback(async () => {
    const content = draftContent.trim()
    if (!content) {
      setMsg('content required')
      return
    }
    setMsg('')
    try {
      const res: any = await rpc('todo.mutate', {
        action: 'add',
        target: draftTarget,
        content,
        due: draftDue || undefined,
        quadrant: draftQuadrant || undefined,
        cat: draftCat || undefined,
      })
      if (res?.ok) {
        setDraftContent('')
        setDraftDue('')
        setDraftQuadrant('')
        setDraftCat('')
        setMsg(`added (id: ${res.id})`)
        await load()
      } else {
        setMsg(`add failed: ${res?.message ?? res?.error ?? 'unknown'}`)
      }
    } catch (e: any) {
      setMsg(`error: ${e?.message ?? String(e)}`)
    }
  }, [rpc, draftContent, draftTarget, draftDue, draftQuadrant, draftCat, load])

  const doneTodo = React.useCallback(
    async (item: any) => {
      try {
        const res: any = await rpc('todo.mutate', { action: 'done', target: item.target, id: item.id })
        if (res?.ok) {
          setMsg(res.message ?? 'done')
          await load()
        } else setMsg(`done failed: ${res?.message ?? res?.error}`)
      } catch (e: any) {
        setMsg(`error: ${e?.message ?? String(e)}`)
      }
    },
    [rpc, load],
  )

  const removeTodo = React.useCallback(
    async (item: any) => {
      try {
        const res: any = await rpc('todo.mutate', { action: 'remove', target: item.target, id: item.id })
        if (res?.ok) {
          setMsg(res.message ?? 'removed')
          await load()
        } else setMsg(`remove failed: ${res?.message ?? res?.error}`)
      } catch (e: any) {
        setMsg(`error: ${e?.message ?? String(e)}`)
      }
    },
    [rpc, load],
  )

  const startEdit = (item: any) => {
    setEditId(item.id)
    setEditContent(item.text ?? '')
    setEditDue(item.due ?? '')
    setEditQuadrant(item.quadrant ?? '')
    setEditStatus(item.status ?? 'pending')
    setEditCat(item.cat ?? '')
  }

  const saveEdit = React.useCallback(
    async (item: any) => {
      try {
        const patch: any = {}
        if (editContent !== item.text) patch.content = editContent
        if (editQuadrant !== (item.quadrant ?? '')) patch.quadrant = editQuadrant || null
        if (editDue !== (item.due ?? '')) patch.due = editDue || null
        if (editStatus !== item.status) patch.status = editStatus
        if (editCat !== (item.cat ?? '')) patch.cat = editCat || null
        const res: any = await rpc('todo.mutate', {
          action: 'update',
          target: item.target,
          id: item.id,
          ...patch,
        })
        if (res?.ok) {
          setEditId(null)
          setMsg(res.message ?? 'updated')
          await load()
        } else setMsg(`update failed: ${res?.message ?? res?.error}`)
      } catch (e: any) {
        setMsg(`error: ${e?.message ?? String(e)}`)
      }
    },
    [rpc, editContent, editDue, editQuadrant, editStatus, editCat, load],
  )

  return React.createElement(
    'div',
    null,
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } },
      (['all', 'life', 'work', 'project', 'daily'] as const).map((k) =>
        React.createElement(
          'button',
          {
            key: k,
            onClick: () => setTarget(k),
            'data-testid': `todo-target-${k}`,
            style: {
              fontWeight: target === k ? 700 : 400,
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: target === k ? '#eee' : '#fff',
              cursor: 'pointer',
              fontSize: 12,
            },
          },
          k,
        ),
      ),
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 12, marginBottom: 8, fontSize: 12, alignItems: 'center', flexWrap: 'wrap' } },
      React.createElement(
        'label',
        { style: { display: 'flex', gap: 4, alignItems: 'center' } },
        React.createElement('input', {
          type: 'checkbox',
          checked: showAll,
          onChange: (e: any) => setShowAll(e.target.checked),
          'data-testid': 'todo-all',
        }),
        'all (no limit)',
      ),
      React.createElement(
        'label',
        { style: { display: 'flex', gap: 4, alignItems: 'center' } },
        React.createElement('input', {
          type: 'checkbox',
          checked: showPast,
          onChange: (e: any) => setShowPast(e.target.checked),
          'data-testid': 'todo-past',
        }),
        'past',
      ),
      React.createElement(
        'label',
        { style: { display: 'flex', gap: 4, alignItems: 'center' } },
        React.createElement('input', {
          type: 'checkbox',
          checked: showExpired,
          onChange: (e: any) => setShowExpired(e.target.checked),
          'data-testid': 'todo-expired',
        }),
        'expired',
      ),
      React.createElement(
        'button',
        { onClick: load, style: { padding: '4px 8px', fontSize: 12 }, 'data-testid': 'todo-refresh' },
        'Refresh',
      ),
    ),
    React.createElement(
      'div',
      { style: { border: '1px solid #eee', borderRadius: 8, padding: 8, marginBottom: 12 } },
      React.createElement('div', { style: { fontWeight: 600, marginBottom: 6, fontSize: 13 } }, 'Add todo'),
      React.createElement('textarea', {
        value: draftContent,
        placeholder: 'Todo content',
        onChange: (e: any) => setDraftContent(e.target.value),
        style: { width: '100%', minHeight: 40, fontSize: 12, marginBottom: 6 },
        'data-testid': 'todo-add-content',
      }),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 } },
        React.createElement(
          'select',
          {
            value: draftTarget,
            onChange: (e: any) => setDraftTarget(e.target.value),
            style: { fontSize: 12, padding: '4px' },
            'data-testid': 'todo-add-target',
          },
          (['life', 'work', 'project', 'daily'] as const).map((t) => React.createElement('option', { key: t, value: t }, t)),
        ),
        React.createElement(
          'select',
          {
            value: draftQuadrant,
            onChange: (e: any) => setDraftQuadrant(e.target.value),
            style: { fontSize: 12, padding: '4px' },
            'data-testid': 'todo-add-quadrant',
          },
          React.createElement('option', { value: '' }, 'quadrant'),
          React.createElement('option', { value: 'q1' }, 'q1'),
          React.createElement('option', { value: 'q2' }, 'q2'),
          React.createElement('option', { value: 'q3' }, 'q3'),
          React.createElement('option', { value: 'q4' }, 'q4'),
        ),
        React.createElement('input', {
          value: draftDue,
          placeholder: 'due YYYY-MM-DD',
          onChange: (e: any) => setDraftDue(e.target.value),
          style: { fontSize: 12, padding: '4px', width: 120 },
          'data-testid': 'todo-add-due',
        }),
        React.createElement('input', {
          value: draftCat,
          placeholder: 'cat',
          onChange: (e: any) => setDraftCat(e.target.value),
          style: { fontSize: 12, padding: '4px', width: 80 },
          'data-testid': 'todo-add-cat',
        }),
      ),
      React.createElement(
        'button',
        {
          onClick: addTodo,
          style: { background: '#2d7', color: '#fff', border: 0, borderRadius: 4, padding: '6px 12px', cursor: 'pointer', fontSize: 12 },
          'data-testid': 'todo-add-btn',
        },
        'Add',
      ),
    ),
    msg ? React.createElement('div', { style: { fontSize: 12, color: '#333', marginBottom: 8, whiteSpace: 'pre-wrap' } }, msg) : null,
    loading
      ? React.createElement('div', null, 'Loading todos…')
      : items.length === 0
        ? React.createElement('div', { style: { opacity: 0.7, fontSize: 12 } }, 'No todos (smart view: overdue / due today / current project / Q1-Q2, max 8). Try "all" or "past".')
        : React.createElement(
            'div',
            null,
            React.createElement('div', { style: { fontSize: 12, opacity: 0.7, marginBottom: 6 } }, `${items.length} todos${!showAll && items.length === 8 ? ' (smart view limited to 8)' : ''}`),
            ...items.map((it: any) =>
              React.createElement(
                'div',
                { key: it.id, style: { border: '1px solid #ddd', borderRadius: 8, padding: 8, marginBottom: 8 } },
                React.createElement(
                  'div',
                  { style: { fontSize: 12, opacity: 0.7 } },
                  `[${it.target}]`,
                  it.quadrant ? ` [${it.quadrant}]` : '',
                  it.due ? ` [due:${it.due}]` : '',
                  it.status !== 'pending' ? ` [${it.status}]` : '',
                  it.cat ? ` [cat:${it.cat}]` : '',
                  it.doneAt ? ` [done:${it.doneAt}]` : '',
                  it.past ? ` [past ${it.day}]` : '',
                  ` id:${it.id}`,
                ),
                editId === it.id
                  ? React.createElement(
                      'div',
                      null,
                      React.createElement('textarea', {
                        value: editContent,
                        onChange: (e: any) => setEditContent(e.target.value),
                        style: { width: '100%', minHeight: 40, fontSize: 12, marginTop: 4 },
                        'data-testid': `todo-edit-content-${it.id}`,
                      }),
                      React.createElement(
                        'div',
                        { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
                        React.createElement(
                          'select',
                          {
                            value: editQuadrant,
                            onChange: (e: any) => setEditQuadrant(e.target.value),
                            style: { fontSize: 12 },
                            'data-testid': `todo-edit-quadrant-${it.id}`,
                          },
                          React.createElement('option', { value: '' }, 'no quadrant'),
                          React.createElement('option', { value: 'q1' }, 'q1'),
                          React.createElement('option', { value: 'q2' }, 'q2'),
                          React.createElement('option', { value: 'q3' }, 'q3'),
                          React.createElement('option', { value: 'q4' }, 'q4'),
                        ),
                        React.createElement('input', {
                          value: editDue,
                          placeholder: 'due YYYY-MM-DD',
                          onChange: (e: any) => setEditDue(e.target.value),
                          style: { fontSize: 12, width: 120 },
                          'data-testid': `todo-edit-due-${it.id}`,
                        }),
                        React.createElement(
                          'select',
                          {
                            value: editStatus,
                            onChange: (e: any) => setEditStatus(e.target.value),
                            style: { fontSize: 12 },
                            'data-testid': `todo-edit-status-${it.id}`,
                          },
                          (['pending', 'doing', 'done', 'blocked', 'cancelled'] as const).map((s) => React.createElement('option', { key: s, value: s }, s)),
                        ),
                        React.createElement('input', {
                          value: editCat,
                          placeholder: 'cat',
                          onChange: (e: any) => setEditCat(e.target.value),
                          style: { fontSize: 12, width: 80 },
                          'data-testid': `todo-edit-cat-${it.id}`,
                        }),
                      ),
                      React.createElement(
                        'div',
                        { style: { display: 'flex', gap: 8, marginTop: 8 } },
                        React.createElement(
                          'button',
                          {
                            onClick: () => saveEdit(it),
                            style: { background: '#2d7', color: '#fff', border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12 },
                            'data-testid': `todo-save-${it.id}`,
                          },
                          'Save',
                        ),
                        React.createElement(
                          'button',
                          {
                            onClick: () => setEditId(null),
                            style: { background: '#888', color: '#fff', border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12 },
                            'data-testid': `todo-cancel-${it.id}`,
                          },
                          'Cancel',
                        ),
                      ),
                    )
                  : React.createElement(
                      'div',
                      null,
                      React.createElement('div', { style: { margin: '4px 0', whiteSpace: 'pre-wrap', fontSize: 13 } }, it.text),
                      React.createElement(
                        'div',
                        { style: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' } },
                        React.createElement(
                          'button',
                          {
                            onClick: () => doneTodo(it),
                            style: { background: it.status === 'done' ? '#888' : '#2d7', color: '#fff', border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12 },
                            'data-testid': `todo-done-${it.id}`,
                          },
                          it.status === 'done' ? 'Undo' : 'Done',
                        ),
                        React.createElement(
                          'button',
                          {
                            onClick: () => startEdit(it),
                            style: { background: '#06c', color: '#fff', border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12 },
                            'data-testid': `todo-edit-${it.id}`,
                          },
                          'Edit',
                        ),
                        React.createElement(
                          'button',
                          {
                            onClick: () => removeTodo(it),
                            style: { background: '#d33', color: '#fff', border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12 },
                            'data-testid': `todo-remove-${it.id}`,
                          },
                          'Remove',
                        ),
                      ),
                    ),
              ),
            ),
          ),
  )
}

function SkillsView({ ctx }: { ctx: any }): React.ReactElement {
  const rpc = useRpc(ctx)
  const [entries, setEntries] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [msg, setMsg] = React.useState<string>('')

  const load = React.useCallback(async () => {
    setLoading(true)
    setMsg('')
    try {
      const res: any = await rpc('skills.list', {})
      if (res?.ok) {
        setEntries(Array.isArray(res.entries) ? res.entries : [])
        if (res.entries.length === 0) setMsg('No skills found (maestro-skills not installed or empty)')
      } else {
        setMsg(`load failed: ${res?.error ?? 'unknown'}`)
      }
    } catch (e: any) {
      setMsg(`error: ${e?.message ?? String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [rpc])

  React.useEffect(() => {
    load()
  }, [load])

  if (loading) return React.createElement('div', null, 'Loading skills…')

  return React.createElement(
    'div',
    null,
    React.createElement(
      'div',
      { style: { fontSize: 12, opacity: 0.7, marginBottom: 8 } },
      `${entries.length} skills (read-only browser, metadata/origin only — maestro-skills discovery unchanged)`,
    ),
    entries.length === 0
      ? React.createElement('div', { style: { opacity: 0.7, fontSize: 12 } }, msg || 'No skills')
      : React.createElement(
          'div',
          null,
          ...entries.map((e: any) =>
            React.createElement(
              'div',
              { key: e.name, style: { border: '1px solid #ddd', borderRadius: 8, padding: 8, marginBottom: 8 } },
              React.createElement('div', { style: { fontWeight: 600 } }, e.name),
              React.createElement('div', { style: { fontSize: 12, opacity: 0.7 } }, `[${e.origin}] ${e.path}`),
              React.createElement('div', { style: { margin: '4px 0', fontSize: 13, whiteSpace: 'pre-wrap' } }, e.description),
              e.metadata && Object.keys(e.metadata).length > 0
                ? React.createElement(
                    'div',
                    { style: { fontSize: 11, opacity: 0.6, marginTop: 4 } },
                    `metadata: ${Object.entries(e.metadata)
                      .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
                      .join(', ')}`,
                  )
                : null,
            ),
          ),
        ),
    msg ? React.createElement('div', { style: { marginTop: 8, fontSize: 12, color: '#333' } }, msg) : null,
    React.createElement('button', { onClick: load, style: { marginTop: 8, padding: '4px 8px', fontSize: 12 }, 'data-testid': 'skills-refresh' }, 'Refresh'),
    React.createElement('div', { style: { marginTop: 8, fontSize: 11, opacity: 0.6 } }, 'Read-only — model suggestions cannot change skills. Future edits, if approved, will require explicit user action + path containment.'),
  )
}

function MemoryView({ ctx }: { ctx: any }): React.ReactElement {
  const [tab, setTab] = React.useState<'memory' | 'review' | 'todos' | 'skills'>('review')
  return React.createElement(
    'div',
    { style: { padding: 16, fontFamily: 'system-ui, sans-serif' } },
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' } },
      (['memory', 'review', 'todos', 'skills'] as const).map((k) =>
        React.createElement(
          'button',
          {
            key: k,
            onClick: () => setTab(k),
            style: {
              fontWeight: tab === k ? 700 : 400,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: tab === k ? '#eee' : '#fff',
              cursor: 'pointer',
            },
            'data-testid': `tab-${k}`,
          },
          k,
        ),
      ),
    ),
    tab === 'memory'
      ? React.createElement('div', null, 'Memory tracks: memory / user / key / project / daily (use memory tool)')
      : tab === 'review'
        ? React.createElement(ReviewQueueView, { ctx })
        : tab === 'todos'
          ? React.createElement(TodosView, { ctx })
          : React.createElement(SkillsView, { ctx }),
  )
}

export function apply(ctx: any): void {
  ctx.effect(() => {
    const dispose = ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        {
          name: 'conversation.view',
          id: 'maestro-memory',
          order: 40,
          label: () => 'Memory',
        },
        () => React.createElement(MemoryView, { ctx }),
      ),
    )
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'maestro-memory: view')
}
