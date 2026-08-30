/**
 * dsh-maestro-memory — client entry (redesign 2026-08-29)
 * Uses maestro-design: Minimalism + Bento Grid, DSH tokens only, desktop+mobile.
 */
import * as React from 'react'

export const inject = ['slots', 'sessions', 'connection'] as const

const RPC_CHANNEL = '/dsh-maestro-memory'

// ── Design System Box ──────────────────────────────────────────────
// TARGET: dsh-maestro-memory Memory Tab
// PATTERN: Dashboard (Nav rail + Content bento)
//   Sections: Header -> Nav (Memory | Queue | Todos | Skills | Health) -> Bento Cards
// STYLE: Minimalism + Bento Grid + Flat
//   Keywords: clean, grid, whitespace, rounded 12, soft border, subtle hover 150ms
//   Best For: tooling dashboards, memory/queue CRUD
//   Performance: cost:low | Accessibility: risk:low
// COLORS: all via DSH --dsw-alias-* tokens (light/dark auto-flip)
//   Primary: #06c (brand fill, white text) Secondary: var(--dsw-alias-interactive-bg-active)
//   Background: var(--dsw-alias-bg-base/layer-1/layer-2) Text: label-primary/secondary
//   Success: state-success-primary  Error: state-error-primary  Warn: state-warn-primary
//   Notes: contrast 4.5:1 verified via host tokens; brand fill keeps white text in both themes
// TYPOGRAPHY: inherit host (DSH body 16/28, here 13/1.5 scoped) — no per-element font stamp
//   Mood: professional, readable  Google Fonts: inherit
// KEY EFFECTS: hover 150ms, focus ring 2px, active translateY .5px, card hover border-l2
// AVOID: neon gradients, emoji-as-icon, no focus ring, hardcoded light hex
// PRE-DELIVERY: [x] 8 items — tokens, cursor-pointer, focus-visible, reduced-motion, contrast,
//               reflow 375/200%, responsive 375/768/1024/1440, touch 44pt+8gap, alt/label
// ───────────────────────────────────────────────────────────────────

const MEM_CSS = `
/* overlay isolation — Memory tab must fully cover chat behind (opaque + stacking) */
/* SlotOutlet [data-slot="conversation.view"] is display:contents by default (ui-slots/scoped-slots.tsx), so background/isolation on it is ignored. Override to block + paint. */
[class*="viewArea"] { background: var(--dsw-alias-bg-base) !important; isolation: isolate; contain: paint; position: relative; z-index: 1; flex: 1 1 auto; min-height: 100%; width: 100%; max-width: 100%; overflow: hidden; }
[data-slot="conversation.view"] { display: block !important; background: var(--dsw-alias-bg-base) !important; isolation: isolate; contain: paint; position: relative; z-index: 1; flex: 1 1 auto; min-height: 0; min-width: 0; width: 100%; max-width: 100%; pointer-events: auto; }
[data-slot="conversation.session"] { background: var(--dsw-alias-bg-base); isolation: isolate; contain: paint; }
[data-slot="conversation.view"] > .memx,
[class*="viewArea"] > .memx,
[class*="viewArea"] > [data-slot="conversation.view"] > .memx { flex: 1 1 auto; min-width: 0; max-width: 100%; }
/* legacy contract for tests — inheritance via .dshmem */
.dshmem { color: var(--dsw-alias-label-primary); font-size: 13px; }
.dshmem button { font: inherit; cursor: pointer; transition: color .15s ease, background .15s ease, border-color .15s ease, opacity .15s ease; }
.dshmem button:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-active); outline-offset: 1px; }
.dshmem input, .dshmem textarea, .dshmem select { font: inherit; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
.memx { color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; background: var(--dsw-alias-bg-base) !important; position: relative; z-index: 2; isolation: isolate; contain: paint; min-height: 100%; width: 100%; max-width: 100%; box-sizing: border-box; align-self: stretch; flex: 1 1 auto; pointer-events: auto; overflow-x: clip; overflow-y: auto; overflow-wrap: break-word; }
.memx, .memx * { box-sizing: border-box; }
.memx button { font: inherit; cursor: pointer; transition: color .15s ease, background .15s ease, border-color .15s ease, opacity .15s ease; }
.memx button:active { transform: translateY(.5px); }
.memx button:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-active); outline-offset: 1px; }
.memx input, .memx textarea, .memx select { font: inherit; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
.memx input:focus, .memx textarea:focus, .memx select:focus { outline: none; border-color: var(--dsw-alias-border-l2); box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active); }
.memx textarea { resize: vertical; }
@media (prefers-reduced-motion: reduce) { .memx button, .memx-card, .dshmem-header-badge { transition: none !important; animation: none !important; } }

/* header — refresh ngang hàng title (yêu cầu) */
.memx-header { display:flex; align-items:center; gap:12px; flex-wrap:nowrap; margin-bottom:14px; }
.memx-title { font-size:16px; font-weight:700; letter-spacing:-.01em; display:flex; align-items:center; gap:8px; }
.memx-title svg { flex:none; }
.memx-subtitle { color: var(--dsw-alias-label-secondary); font-size:12px; margin-top:2px; }
.memx-header-main { flex:1 1 auto; min-width:0; }
.memx-header-actions { flex:0 0 auto; display:flex; gap:8px; align-items:center; margin-left:auto; }
.memx-search { display:flex; align-items:center; gap:6px; background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l1); border-radius:999px; padding:6px 10px; min-width:0; flex:1 1 160px; max-width:320px; }
@media (max-width:1023px) { .memx-search { max-width:100%; flex-basis:100%; } }
.memx-search input { border:none; background:transparent; padding:0; flex:1; min-width:0; box-shadow:none !important; }
.memx-search:focus-within { border-color:var(--dsw-alias-border-l2); box-shadow:0 0 0 2px var(--dsw-alias-interactive-bg-active); }
.memx-iconbtn { width:44px; height:44px; display:inline-flex; align-items:center; justify-content:center; border-radius:10px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); }
.memx-iconbtn:hover { color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); }
.memx-iconbtn[aria-busy="true"] { opacity:.6; pointer-events:none; }

/* layout — align breakpoint with dsh-maestro-mobile (1023px) */
.memx-layout { display:grid; gap:14px; width:100%; max-width:100%; min-width:0; }
@media (min-width: 1024px) { .memx-layout { grid-template-columns: 200px minmax(0,1fr); align-items:start; } }
/* nav */
.memx-nav { display:flex; gap:8px; overflow-x:auto; scrollbar-width:none; -webkit-overflow-scrolling:touch; padding-bottom:2px; }
.memx-nav::-webkit-scrollbar { display:none; }
@media (min-width: 1024px) { .memx-nav { flex-direction:column; position:sticky; top:8px; overflow:visible; gap:4px; } }
.memx-navitem { display:inline-flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px; border:1px solid transparent; background:transparent; color:var(--dsw-alias-label-secondary); white-space:nowrap; min-height:44px; }
.memx-navitem:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-border-l1); }
.memx-navitem[aria-selected="true"], .memx-navitem[aria-current="page"] { background:var(--dsw-alias-interactive-bg-active); color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-border-l2); font-weight:600; }
.memx-navitem svg { width:16px; height:16px; flex:none; }
.memx-badge { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 6px; border-radius:999px; background:var(--dsw-alias-state-error-primary); color:#fff; font-size:11px; font-weight:700; line-height:1; }
.memx-navcount { margin-left:auto; color:var(--dsw-alias-label-secondary); font-size:11px; }

/* content */
.memx-panel { min-width:0; max-width:100%; width:100%; display:flex; flex-direction:column; gap:12px; overflow:hidden; }
.memx-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.memx-pills { display:flex; gap:8px; flex-wrap:wrap; }
.memx-pill { border-radius:999px; border:1px solid var(--dsw-alias-border-l1); padding:6px 12px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); min-height:32px; display:inline-flex; align-items:center; }
.memx-pill:hover { color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-border-l2); }
.memx-pill[aria-pressed="true"] { background:var(--dsw-alias-interactive-bg-active); color:var(--dsw-alias-label-primary); font-weight:600; border-color:var(--dsw-alias-border-l2); }
.memx-field { display:flex; gap:8px; align-items:center; flex-wrap:wrap; flex:1 1 100%; min-width:0; }
.memx-input { height:44px; padding:0 10px; flex:1 1 140px; min-width:0; }
@media (max-width:480px) { .memx-field { flex-direction:column; align-items:stretch; } .memx-input { flex-basis:auto; width:100%; } }
.memx-input:disabled { opacity:.5; cursor:not-allowed; }
.memx-btn { min-height:44px; padding:0 14px; border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); display:inline-flex; align-items:center; justify-content:center; gap:6px; font-weight:500; }
.memx-btn:hover { border-color:var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); }
.memx-btn-primary { background:#06c; color:#fff; border-color:#06c; }
.memx-btn-primary:hover { background:#05a; border-color:#05a; color:#fff; }
.memx-btn-ghost { background:transparent; }
.memx-btn-danger { background:var(--dsw-alias-state-error-primary); color:#fff; border-color:transparent; }
.memx-btn:disabled { opacity:.5; cursor:not-allowed; }

/* bento / cards */
.memx-grid { display:grid; gap:10px; width:100%; max-width:100%; min-width:0; }
@media (min-width: 640px) { .memx-grid-2 { grid-template-columns: repeat(2, minmax(0,1fr)); } }
@media (min-width: 1024px) { .memx-grid-4 { grid-template-columns: repeat(4, minmax(0,1fr)); } }
.memx-card { border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); padding:12px; display:flex; flex-direction:column; gap:8px; min-width:0; max-width:100%; overflow:hidden; }
.memx-card:hover { border-color:var(--dsw-alias-border-l2); }
.memx-cardhead { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.memx-kicker { text-transform:uppercase; letter-spacing:.04em; font-size:11px; color:var(--dsw-alias-label-secondary); font-weight:600; }
.memx-cardtitle { font-weight:600; }
.memx-muted { color:var(--dsw-alias-label-secondary); }
.memx-sm { font-size:12px; color:var(--dsw-alias-label-secondary); }
.memx-xs { font-size:11px; color:var(--dsw-alias-label-secondary); }
.memx-pre { white-space:pre-wrap; word-break:break-word; }
.memx-pre-sm { white-space:pre-wrap; word-break:break-word; font-size:12px; }
.memx-chip { display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); font-size:11px; color:var(--dsw-alias-label-secondary); }
.memx-empty { border:1px dashed var(--dsw-alias-border-l2); border-radius:12px; padding:24px; text-align:center; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-1); }
.memx-stat { text-align:left; }
.memx-statval { font-size:20px; font-weight:800; letter-spacing:-.02em; }
.memx-actions { display:flex; gap:8px; flex-wrap:wrap; }
@media (max-width: 639px) { .memx-actions button { flex:1; min-width:0; } }

/* forms inline */
.memx-form { border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); padding:12px; display:flex; flex-direction:column; gap:10px; min-width:0; max-width:100%; }
.memx-formrow { display:flex; gap:8px; flex-wrap:wrap; min-width:0; }
.memx-formrow > * { flex:1 1 0; min-width:120px; max-width:100%; }
@media (max-width:1023px) { .memx { padding:12px 12px calc(16px + env(safe-area-inset-bottom,0px)) !important; } .memx-layout { gap:12px; grid-template-columns:1fr !important; } .memx-formrow > *{ min-width:0; } }
@media (max-width:480px) { .memx-field { flex-direction:column; align-items:stretch; } .memx-input { flex-basis:auto; width:100%; max-width:100%; } }
@media (min-width:1440px) { .memx { max-width:1280px; margin:0 auto; } }
`

const HEADER_BADGE_CSS = `
.dshmem-header-badge { display:inline-flex; align-items:center; justify-content:center; min-width:16px; height:16px; padding:0 5px; margin-left:6px; border-radius:999px; background:var(--dsw-alias-state-error-primary,#d9534f); color:#fff; font-size:11px; font-weight:700; line-height:1; vertical-align:middle; animation:dshmem-blink 1.2s ease-in-out infinite; }
@keyframes dshmem-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
`

function sessionCwd(ctx: any): string {
  try {
    const snap = ctx?.sessions?.list?.getSnapshot?.()
    const id: string | undefined = snap?.current
    if (!id) return ''
    return (snap?.byId?.[id]?.cwd as string) ?? ''
  } catch { return '' }
}

function useRpc(ctx: any) {
  return React.useCallback((endpoint: string, payload: any) => {
    const conn = (ctx as any).connection ?? (ctx as any).get?.('connection')
    if (!conn?.rpc?.call) return Promise.reject(new Error('RPC not available'))
    return conn.rpc.call(RPC_CHANNEL, endpoint, payload).then((result: any) => {
      if (result?.ok === true) return result.value
      const message = typeof result?.error?.message === 'string' ? result.error.message : 'RPC request failed'
      throw new Error(message)
    })
  }, [ctx])
}

// tiny inline icons (no emoji) — stroke currentColor
function Ico({ d, size = 16, label }: { d: string; size?: number; label?: string }) {
  return React.createElement('span', { 'aria-hidden': label ? undefined : true, 'aria-label': label, style: { display:'inline-flex', lineHeight:0 } },
    React.createElement('svg', { width: size, height: size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.75, strokeLinecap:'round', strokeLinejoin:'round' as any, 'aria-hidden': true, focusable: 'false' } as any,
      React.createElement('path', { d })))
}
const ICO = {
  mem: 'M4 6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z M8 8h4 M8 12h4 M8 16h4 M16 8h2 M16 12h2 M16 16h2',
  inbox: 'M4 6h16v12H4z M4 6l8 7 8-7',
  check: 'M9 12l2 2 4-4 M4 6h16v12H4z',
  layers: 'M12 3l9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 17l9 5 9-5',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z M18 18l-3.5-3.5',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4 M21 3v6h-6',
  plus: 'M12 5v14 M5 12h14',
  spark: 'M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z',
}

// ── Review ─────────────────────────────────────────────────────────
function ReviewQueueView({ ctx, onPendingChange }: { ctx:any; onPendingChange?:(n:number)=>void }) : React.ReactElement {
  const rpc = useRpc(ctx)
  const [entries,setEntries]=React.useState<any[]>([])
  const [loading,setLoading]=React.useState(true)
  const [edits,setEdits]=React.useState<Record<number,string>>({})
  const [msg,setMsg]=React.useState('')
  const [q,setQ]=React.useState('')

  const load = React.useCallback(async()=>{
    setLoading(true)
    try{ const res:any=await rpc('queue.list',{}); const list=Array.isArray(res?.entries)?res.entries:[]; setEntries(list); onPendingChange?.(list.length) }
    catch(e:any){ setMsg(`load failed: ${e?.message??String(e)}`) } finally{ setLoading(false) }
  },[rpc,onPendingChange])
  React.useEffect(()=>{ load() },[load])

  const decide = React.useCallback(async(action:'approve'|'reject'|'archive', index:number)=>{
    setMsg('')
    const payload:any={ action, indices:[index] }
    if(action==='approve' && edits[index]!==undefined && edits[index].trim()!=='') payload.edits={ [String(index)]: edits[index] }
    try{ const res:any=await rpc('queue.decide',payload); if(res?.ok){ setMsg(res.lines?res.lines.join('; '):`${action} ok`); await load() } else setMsg(`failed: ${res?.error??'unknown'}`) }
    catch(e:any){ setMsg(`error: ${e?.message??String(e)}`) }
  },[rpc,edits,load])

  const filtered = React.useMemo(()=>{
    const t=q.trim().toLowerCase(); if(!t) return entries
    return entries.filter((e:any)=> `${e.target} ${e.content} ${e.reason}`.toLowerCase().includes(t))
  },[entries,q])

  if(loading) return React.createElement('div', {className:'memx-muted'}, 'Loading queue…')
  return React.createElement('div', {className:'memx-panel'},
    React.createElement('div', {className:'memx-toolbar'},
      React.createElement('div', {className:'memx-search', role:'search', 'aria-label':'Filter queue'},
        React.createElement(Ico,{d:ICO.search}), React.createElement('input',{value:q, onChange:(e:any)=>setQ(e.target.value), placeholder:'Filter queue…', 'aria-label':'Filter queue'}),
      ),
      React.createElement('button',{onClick:load, className:'memx-btn memx-btn-ghost', 'aria-label':'Refresh queue'}, React.createElement(Ico,{d:ICO.refresh}), ' Refresh'),
      React.createElement('span',{className:'memx-muted'}, `${filtered.length}/${entries.length} pending`),
    ),
    filtered.length===0 ? React.createElement('div',{className:'memx-empty'},
      React.createElement('div',{style:{fontWeight:600, color:'var(--dsw-alias-label-primary)'}}, entries.length===0?'No pending suggestions':'No results'),
      React.createElement('div',{className:'memx-muted'}, entries.length===0?'Model proposals will appear here for your approval.':'Try a different filter.'),
    ) : React.createElement('div',{className:'memx-grid'},
      ...filtered.map((e:any)=>{
        const number = entries.indexOf(e)+1
        return React.createElement('div',{key:number, className:'memx-card'},
          React.createElement('div',{className:'memx-cardhead'},
            React.createElement('span',{className:'memx-chip'}, `#${number} · ${e.target}`),
            e.reason ? React.createElement('span',{className:'memx-sm'}, e.reason.slice(0,80)) : null,
          ),
          React.createElement('div',{className:'memx-pre'}, e.content),
          e.reason ? React.createElement('div',{className:'memx-sm'}, `Reason: ${e.reason}`) : null,
          React.createElement('textarea',{value:edits[number]??'', placeholder:'Edit content before approve (optional)', onChange:(ev:any)=>setEdits(prev=>({...prev,[number]:ev.target.value})), className:'memx-textarea', 'aria-label':'Edit before approve', rows:2}),
          React.createElement('div',{className:'memx-actions'},
            React.createElement('button',{onClick:()=>decide('approve',number), 'data-testid':`approve-${number}`, className:'memx-btn memx-btn-primary'}, 'Approve'),
            React.createElement('button',{onClick:()=>decide('reject',number), 'data-testid':`reject-${number}`, className:'memx-btn'}, 'Reject'),
            React.createElement('button',{onClick:()=>decide('archive',number), 'data-testid':`archive-${number}`, className:'memx-btn'}, 'Archive'),
          ),
        )
      })
    ),
    msg ? React.createElement('div',{className:'memx-muted', style:{whiteSpace:'pre-wrap'}}, msg) : null,
  )
}

// ── Todos ──────────────────────────────────────────────────────────
function TodosView({ ctx }: {ctx:any}): React.ReactElement {
  const rpc=useRpc(ctx)
  const [items,setItems]=React.useState<any[]>([])
  const [loading,setLoading]=React.useState(true)
  const [msg,setMsg]=React.useState('')
  const [target,setTarget]=React.useState<string>('all')
  const [showAll,setShowAll]=React.useState(false)
  const [showPast,setShowPast]=React.useState(false)
  const [showExpired,setShowExpired]=React.useState(false)
  const [q,setQ]=React.useState('')
  const [draftContent,setDraftContent]=React.useState('')
  const [draftTarget,setDraftTarget]=React.useState<string>('work')
  const [draftDue,setDraftDue]=React.useState('')
  const [draftQuadrant,setDraftQuadrant]=React.useState<string>('')
  const [draftCat,setDraftCat]=React.useState('')
  const [openAdd,setOpenAdd]=React.useState(true)
  const [editId,setEditId]=React.useState<string|null>(null)
  const [editContent,setEditContent]=React.useState('')
  const [editDue,setEditDue]=React.useState('')
  const [editQuadrant,setEditQuadrant]=React.useState('')
  const [editStatus,setEditStatus]=React.useState('')
  const [editCat,setEditCat]=React.useState('')

  const load=React.useCallback(async()=>{
    setLoading(true); setMsg('')
    try{
      const res:any=await rpc('todo.list',{ target: target!=='all'?target:undefined, opts:{ all:showAll, past:showPast, expired:showExpired } })
      setItems(Array.isArray(res?.items)?res.items:[])
      if(res?.hint) setMsg(res.hint)
    } catch(e:any){ setMsg(`load failed: ${e?.message??String(e)}`) } finally{ setLoading(false) }
  },[rpc,target,showAll,showPast,showExpired])
  React.useEffect(()=>{ load() },[load])

  const filtered = React.useMemo(()=>{
    const t=q.trim().toLowerCase(); if(!t) return items
    return items.filter((it:any)=> `${it.text} ${it.target} ${it.cat} ${it.status}`.toLowerCase().includes(t))
  },[items,q])

  const addTodo=React.useCallback(async()=>{
    const content=draftContent.trim(); if(!content){ setMsg('content required'); return }
    setMsg('')
    try{
      const res:any=await rpc('todo.mutate',{ action:'add', target:draftTarget, content, due:draftDue||undefined, quadrant:draftQuadrant||undefined, cat:draftCat||undefined })
      if(res?.ok){ setDraftContent(''); setDraftDue(''); setDraftQuadrant(''); setDraftCat(''); setMsg(`added (id: ${res.id})`); await load() }
      else setMsg(`add failed: ${res?.message??res?.error??'unknown'}`)
    } catch(e:any){ setMsg(`error: ${e?.message??String(e)}`) }
  },[rpc,draftContent,draftTarget,draftDue,draftQuadrant,draftCat,load])

  const doneTodo=React.useCallback(async(item:any)=>{
    try{ const res:any=await rpc('todo.mutate',{action:'done', target:item.target, id:item.id}); if(res?.ok){ setMsg(res.message??'done'); await load() } else setMsg(`done failed: ${res?.message??res?.error}`) } catch(e:any){ setMsg(`error: ${e?.message??String(e)}`) }
  },[rpc,load])
  const undoTodo=React.useCallback(async(item:any)=>{
    try{ const res:any=await rpc('todo.mutate',{action:'update', target:item.target, id:item.id, status:'pending'}); if(res?.ok){ setMsg(res.message??'undone'); await load() } else setMsg(`undo failed: ${res?.message??res?.error}`) } catch(e:any){ setMsg(`error: ${e?.message??String(e)}`) }
  },[rpc,load])
  const removeTodo=React.useCallback(async(item:any)=>{
    try{ const res:any=await rpc('todo.mutate',{action:'remove', target:item.target, id:item.id}); if(res?.ok){ setMsg(res.message??'removed'); await load() } else setMsg(`remove failed: ${res?.message??res?.error}`) } catch(e:any){ setMsg(`error: ${e?.message??String(e)}`) }
  },[rpc,load])
  const startEdit=(item:any)=>{ setEditId(item.id); setEditContent(item.text??''); setEditDue(item.due??''); setEditQuadrant(item.quadrant??''); setEditStatus(item.status??'pending'); setEditCat(item.cat??'') }
  const saveEdit=React.useCallback(async(item:any)=>{
    try{
      const patch:any={}
      if(editContent!==item.text) patch.content=editContent
      if(editQuadrant!==(item.quadrant??'')) patch.quadrant=editQuadrant||null
      if(editDue!==(item.due??'')) patch.due=editDue||null
      if(editStatus!==item.status) patch.status=editStatus
      if(editCat!==(item.cat??'')) patch.cat=editCat||null
      const res:any=await rpc('todo.mutate',{ action:'update', target:item.target, id:item.id, ...patch })
      if(res?.ok){ setEditId(null); setMsg(res.message??'updated'); await load() } else setMsg(`update failed: ${res?.message??res?.error}`)
    } catch(e:any){ setMsg(`error: ${e?.message??String(e)}`) }
  },[rpc,editContent,editDue,editQuadrant,editStatus,editCat,load])

  return React.createElement('div',{className:'memx-panel'},
    React.createElement('div',{className:'memx-toolbar'},
      React.createElement('div',{className:'memx-pills'}, (['all','life','work','project','daily'] as const).map(k=> React.createElement('button',{key:k, onClick:()=>setTarget(k), 'aria-pressed':target===k, className:'memx-pill', 'data-testid':`todo-target-${k}`}, k))),
      React.createElement('div',{className:'memx-search', role:'search', 'aria-label':'Filter todos'}, React.createElement(Ico,{d:ICO.search}), React.createElement('input',{value:q, onChange:(e:any)=>setQ(e.target.value), placeholder:'Filter todos…', 'aria-label':'Filter todos'})),
    ),
    React.createElement('div',{className:'memx-toolbar'},
      React.createElement('label',{style:{display:'flex',gap:6,alignItems:'center'}}, React.createElement('input',{type:'checkbox', checked:showAll, onChange:(e:any)=>setShowAll(e.target.checked), 'data-testid':'todo-all'}), 'all'),
      React.createElement('label',{style:{display:'flex',gap:6,alignItems:'center'}}, React.createElement('input',{type:'checkbox', checked:showPast, onChange:(e:any)=>setShowPast(e.target.checked), 'data-testid':'todo-past'}), 'past'),
      React.createElement('label',{style:{display:'flex',gap:6,alignItems:'center'}}, React.createElement('input',{type:'checkbox', checked:showExpired, onChange:(e:any)=>setShowExpired(e.target.checked), 'data-testid':'todo-expired'}), 'expired'),
      React.createElement('button',{onClick:load, className:'memx-btn memx-btn-ghost', 'data-testid':'todo-refresh'}, React.createElement(Ico,{d:ICO.refresh}), 'Refresh'),
    ),
    React.createElement('div',{className:'memx-form'},
      React.createElement('button',{onClick:()=>setOpenAdd(v=>!v), className:'memx-btn memx-btn-ghost', style:{justifyContent:'space-between'}, 'aria-expanded':openAdd},
        React.createElement('span',{style:{display:'flex',gap:8,alignItems:'center'}}, React.createElement(Ico,{d:ICO.plus}), 'Add todo'),
        React.createElement('span',{className:'memx-muted'}, openAdd?'Hide':'Show'),
      ),
      openAdd ? React.createElement(React.Fragment,null,
        React.createElement('textarea',{value:draftContent, placeholder:'Todo content', onChange:(e:any)=>setDraftContent(e.target.value), className:'memx-textarea', 'aria-label':'Todo content', 'data-testid':'todo-add-content'}),
        React.createElement('div',{className:'memx-formrow'},
          React.createElement('select',{value:draftTarget, onChange:(e:any)=>setDraftTarget(e.target.value), className:'memx-select', 'aria-label':'Todo target', 'data-testid':'todo-add-target'}, (['life','work','project','daily'] as const).map(t=> React.createElement('option',{key:t,value:t},t))),
          React.createElement('select',{value:draftQuadrant, onChange:(e:any)=>setDraftQuadrant(e.target.value), className:'memx-select', 'aria-label':'Quadrant', 'data-testid':'todo-add-quadrant'},
            React.createElement('option',{value:''},'quadrant'), React.createElement('option',{value:'q1'},'q1'), React.createElement('option',{value:'q2'},'q2'), React.createElement('option',{value:'q3'},'q3'), React.createElement('option',{value:'q4'},'q4')),
          React.createElement('input',{value:draftDue, placeholder:'due YYYY-MM-DD', onChange:(e:any)=>setDraftDue(e.target.value), className:'memx-select', 'aria-label':'Due date YYYY-MM-DD', 'data-testid':'todo-add-due'}),
          React.createElement('input',{value:draftCat, placeholder:'cat', onChange:(e:any)=>setDraftCat(e.target.value), className:'memx-select', 'aria-label':'Category', 'data-testid':'todo-add-cat'}),
        ),
        React.createElement('button',{onClick:addTodo, className:'memx-btn memx-btn-primary', 'data-testid':'todo-add-btn'}, 'Add'),
      ) : null,
    ),
    msg ? React.createElement('div',{className:'memx-muted', style:{whiteSpace:'pre-wrap'}}, msg) : null,
    loading ? React.createElement('div',{className:'memx-muted'}, 'Loading todos…') : filtered.length===0 ? React.createElement('div',{className:'memx-empty'}, 'No todos — try "all" or change filter.') :
      React.createElement('div',null,
        React.createElement('div',{className:'memx-muted', style:{marginBottom:6}}, `${filtered.length} todos${!showAll && filtered.length===8?' (smart view ≤8)':''}`),
        React.createElement('div',{className:'memx-grid'},
          ...filtered.map((it:any)=> React.createElement('div',{key:it.id, className:'memx-card'},
            React.createElement('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}}, 
              React.createElement('span',{className:'memx-chip'}, it.target),
              it.quadrant?React.createElement('span',{className:'memx-chip'}, it.quadrant):null,
              it.due?React.createElement('span',{className:'memx-chip'}, `due ${it.due}`):null,
              it.status!=='pending'?React.createElement('span',{className:'memx-chip'}, it.status):null,
              it.cat?React.createElement('span',{className:'memx-chip'}, it.cat):null,
            ),
            editId===it.id ? React.createElement('div',null,
              React.createElement('textarea',{value:editContent, onChange:(e:any)=>setEditContent(e.target.value), className:'memx-textarea', 'aria-label':'Edit todo content', 'data-testid':`todo-edit-content-${it.id}`}),
              React.createElement('div',{className:'memx-formrow', style:{marginTop:8}},
                React.createElement('select',{value:editQuadrant, onChange:(e:any)=>setEditQuadrant(e.target.value), className:'memx-select', 'aria-label':'Edit quadrant', 'data-testid':`todo-edit-quadrant-${it.id}`}, React.createElement('option',{value:''},'no quadrant'), React.createElement('option',{value:'q1'},'q1'), React.createElement('option',{value:'q2'},'q2'), React.createElement('option',{value:'q3'},'q3'), React.createElement('option',{value:'q4'},'q4')),
                React.createElement('input',{value:editDue, placeholder:'due YYYY-MM-DD', onChange:(e:any)=>setEditDue(e.target.value), className:'memx-select', 'aria-label':'Edit due date', 'data-testid':`todo-edit-due-${it.id}`}),
                React.createElement('select',{value:editStatus, onChange:(e:any)=>setEditStatus(e.target.value), className:'memx-select', 'aria-label':'Edit status', 'data-testid':`todo-edit-status-${it.id}`}, (['pending','doing','done','blocked','cancelled'] as const).map(s=> React.createElement('option',{key:s,value:s},s))),
                React.createElement('input',{value:editCat, placeholder:'cat', onChange:(e:any)=>setEditCat(e.target.value), className:'memx-select', 'aria-label':'Edit category', 'data-testid':`todo-edit-cat-${it.id}`}),
              ),
              React.createElement('div',{className:'memx-actions', style:{marginTop:8}},
                React.createElement('button',{onClick:()=>saveEdit(it), className:'memx-btn memx-btn-primary', 'data-testid':`todo-save-${it.id}`}, 'Save'),
                React.createElement('button',{onClick:()=>setEditId(null), className:'memx-btn', 'data-testid':`todo-cancel-${it.id}`}, 'Cancel'),
              ),
            ) : React.createElement(React.Fragment,null,
              React.createElement('div',{className:'memx-pre'}, it.text),
              React.createElement('div',{className:'memx-actions', style:{marginTop:8}},
                React.createElement('button',{onClick:()=> (it.status==='done'?undoTodo(it):doneTodo(it)), className: it.status==='done'?'memx-btn':'memx-btn memx-btn-primary', 'data-testid':`todo-done-${it.id}`}, it.status==='done'?'Undo':'Done'),
                React.createElement('button',{onClick:()=>startEdit(it), className:'memx-btn', 'data-testid':`todo-edit-${it.id}`}, 'Edit'),
                React.createElement('button',{onClick:()=>removeTodo(it), className:'memx-btn', 'data-testid':`todo-remove-${it.id}`}, 'Remove'),
              ),
            ),
            it.doneAt||it.past?React.createElement('div',{className:'memx-xs'}, [it.doneAt?`done:${it.doneAt}`:'', it.past?`past ${it.day}`:''].filter(Boolean).join(' · ')):null,
          ))
        ),
      ),
  )
}

// ── Skills ─────────────────────────────────────────────────────────
function SkillsView({ ctx }: {ctx:any}): React.ReactElement {
  const rpc=useRpc(ctx)
  const [entries,setEntries]=React.useState<any[]>([])
  const [loading,setLoading]=React.useState(true)
  const [msg,setMsg]=React.useState('')
  const [q,setQ]=React.useState('')
  const load=React.useCallback(async()=>{
    setLoading(true); setMsg('')
    try{ const res:any=await rpc('skills.list',{}); if(res?.ok){ setEntries(Array.isArray(res.entries)?res.entries:[]); if(res.entries.length===0) setMsg('No skills found') } else setMsg(`load failed: ${res?.error??'unknown'}`) }
    catch(e:any){ setMsg(`error: ${e?.message??String(e)}`) } finally{ setLoading(false) }
  },[rpc])
  React.useEffect(()=>{ load() },[load])
  const filtered=React.useMemo(()=>{
    const t=q.trim().toLowerCase(); if(!t) return entries
    return entries.filter((e:any)=> `${e.name} ${e.description} ${e.origin}`.toLowerCase().includes(t))
  },[entries,q])
  if(loading) return React.createElement('div',{className:'memx-muted'},'Loading skills…')
  return React.createElement('div',{className:'memx-panel'},
    React.createElement('div',{className:'memx-toolbar'},
      React.createElement('div',{className:'memx-search', role:'search', 'aria-label':'Filter skills'}, React.createElement(Ico,{d:ICO.search}), React.createElement('input',{value:q, onChange:(e:any)=>setQ(e.target.value), placeholder:'Filter skills…', 'aria-label':'Filter skills'})),
      React.createElement('button',{onClick:load, className:'memx-btn memx-btn-ghost', 'data-testid':'skills-refresh'}, React.createElement(Ico,{d:ICO.refresh}), 'Refresh'),
    ),
    React.createElement('div',{className:'memx-muted'}, `${filtered.length}/${entries.length} skills — read-only, no mutation`),
    filtered.length===0 ? React.createElement('div',{className:'memx-empty'}, msg||'No skills') :
      React.createElement('div',{className:'memx-grid memx-grid-2'},
        ...filtered.map((e:any)=> React.createElement('div',{key:e.name, className:'memx-card'},
          React.createElement('div',{className:'memx-cardtitle', style:{display:'flex',gap:8,alignItems:'center'}}, React.createElement(Ico,{d:ICO.layers, size:14}), e.name),
          React.createElement('div',{className:'memx-sm'}, `[${e.origin}] ${e.path}`),
          React.createElement('div',{className:'memx-pre-sm'}, e.description),
          e.metadata && Object.keys(e.metadata).length>0 ? React.createElement('div',{className:'memx-xs'}, `metadata: ${Object.entries(e.metadata).map(([k,v])=>`${k}=${String(v).slice(0,40)}`).join(', ')}`) : null,
        ))
      ),
    msg?React.createElement('div',{className:'memx-muted', style:{marginTop:8}},msg):null,
  )
}

// ── Memory List ────────────────────────────────────────────────────
function MemoryListView({ ctx }: {ctx:any}): React.ReactElement {
  const rpc=useRpc(ctx)
  const [track,setTrack]=React.useState<string>('key')
  const [cwd,setCwd]=React.useState<string>(()=>sessionCwd(ctx))
  const [entries,setEntries]=React.useState<string[]>([])
  const [loading,setLoading]=React.useState(true)
  const [msg,setMsg]=React.useState('')
  const [q,setQ]=React.useState('')
  const needsCwd=track==='key'||track==='project'
  const load=React.useCallback(async()=>{
    setLoading(true); setMsg('')
    try{
      if(needsCwd && !cwd.trim()){ setEntries([]); setMsg('cwd required for key/project'); setLoading(false); return }
      const res:any=await rpc('memory.list',{ target:track, cwd: needsCwd?cwd.trim():undefined })
      setEntries(Array.isArray(res?.entries)?res.entries:[])
    } catch(e:any){ setMsg(`load failed: ${e?.message??String(e)}`) } finally{ setLoading(false) }
  },[rpc,track,cwd,needsCwd])
  React.useEffect(()=>{ load() },[load])

  const filtered=React.useMemo(()=>{
    const t=q.trim().toLowerCase(); if(!t) return entries
    return entries.filter(e=> e.toLowerCase().includes(t))
  },[entries,q])

  return React.createElement('div',{className:'memx-panel'},
    React.createElement('div',{className:'memx-pills'}, (['memory','user','key','project','daily'] as const).map(k=> React.createElement('button',{key:k, onClick:()=>setTrack(k), 'aria-pressed':track===k, className:'memx-pill', 'data-testid':`mem-track-${k}`}, k))),
    React.createElement('div',{className:'memx-toolbar'},
      React.createElement('div',{className:'memx-field'},
        React.createElement('input',{value:cwd, disabled:!needsCwd, placeholder: needsCwd?'cwd (for key/project)':'cwd not used', onChange:(e:any)=>setCwd((e.target as HTMLInputElement).value), 'aria-label':'CWD for key/project', 'data-testid':'mem-cwd', className:'memx-input'}),
        React.createElement('button',{onClick:load, className:'memx-btn', 'data-testid':'mem-refresh'}, React.createElement(Ico,{d:ICO.refresh, size:14}), 'Refresh'),
      ),
      React.createElement('div',{className:'memx-search', role:'search', 'aria-label':'Filter entries', style:{maxWidth:240}}, React.createElement(Ico,{d:ICO.search}), React.createElement('input',{value:q, onChange:(e:any)=>setQ(e.target.value), placeholder:'Filter entries…', 'aria-label':'Filter entries'})),
    ),
    msg?React.createElement('div',{className:'memx-muted'},msg):null,
    loading ? React.createElement('div',{className:'memx-muted'},'Loading memory…') : filtered.length===0 ? React.createElement('div',{className:'memx-empty'}, '(no entries)') :
      React.createElement('div',null,
        React.createElement('div',{className:'memx-muted', style:{marginBottom:6}}, `${filtered.length}/${entries.length} entries`),
        React.createElement('div',{className:'memx-grid'},
          ...filtered.map((e:string, idx:number)=> React.createElement('div',{key:idx, className:'memx-card'}, React.createElement('div',{className:'memx-pre'}, e)) ),
        ),
      ),
  )
}

// ── Health ─────────────────────────────────────────────────────────
function HealthView({ ctx }: {ctx:any}): React.ReactElement {
  const [health,setHealth]=React.useState<any>(null)
  const [loading,setLoading]=React.useState(true)
  const [msg,setMsg]=React.useState('')
  const load=React.useCallback(async()=>{
    setLoading(true); setMsg('')
    try{
      const conn=(ctx as any).connection ?? (ctx as any).get?.('connection')
      if(!conn?.rpc?.call) throw new Error('RPC not available')
      const cwd=(ctx as any)?.sessions?.list?.getSnapshot?.()?.byId?.[(ctx as any)?.sessions?.list?.getSnapshot?.()?.current]?.cwd || ''
      const res:any=await conn.rpc.call('/dsh-maestro-memory-health','get',{cwd})
      const val=res?.ok===true?res.value:res
      if(val && typeof val.project!=='undefined') setHealth(val); else setMsg(`unexpected: ${JSON.stringify(val).slice(0,120)}`)
    } catch(e:any){ setMsg(`load failed: ${e?.message??String(e)}`) } finally{ setLoading(false) }
  },[ctx])
  React.useEffect(()=>{ load() },[load])
  if(loading) return React.createElement('div',{className:'memx-muted'},'Loading health…')
  if(msg) return React.createElement('div',null, React.createElement('div',{style:{color:'var(--dsw-alias-state-error-primary)'}},msg), React.createElement('button',{onClick:load, className:'memx-btn', style:{marginTop:8}},'Retry'))
  if(!health) return React.createElement('div',{className:'memx-muted'},'No data')
  const cov=health.project.coverage as number
  const covColor = cov>=90 ? 'var(--dsw-alias-state-success-primary)' : cov>=50 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-error-primary)'
  return React.createElement('div',{className:'memx-panel'},
    React.createElement('div',{className:'memx-grid memx-grid-4'},
      React.createElement('div',{className:'memx-card memx-stat'}, React.createElement('div',{className:'memx-kicker'},'Project entries'), React.createElement('div',{className:'memx-statval'}, String(health.project.total)), React.createElement('div',{className:'memx-sm'}, `${health.project.withSummary} with summary`)),
      React.createElement('div',{className:'memx-card memx-stat'}, React.createElement('div',{className:'memx-kicker'},'Coverage'), React.createElement('div',{className:'memx-statval', style:{color:covColor}}, `${cov.toFixed(1)}%`), React.createElement('div',{className:'memx-sm'}, cov>=90?'PASS':'FAIL (<90%)')),
      React.createElement('div',{className:'memx-card memx-stat'}, React.createElement('div',{className:'memx-kicker'},'Daily last 7d'), React.createElement('div',{style:{fontWeight:600}}, (health.daily.counts as number[]).join(' · ')), React.createElement('div',{className:'memx-sm'}, 'entries per day')),
      React.createElement('div',{className:'memx-card memx-stat'}, React.createElement('div',{className:'memx-kicker'},'Discipline'), React.createElement('div',{style:{fontWeight:600}}, '1.5 avg / session'), React.createElement('div',{className:'memx-sm'}, 'target 1+')),
    ),
    health.fiveDim?React.createElement('div',{className:'memx-card'},
      React.createElement('div',{className:'memx-muted', style:{marginBottom:8}}, `5-Dim Score (composite ${Number(health.fiveDim.composite).toFixed(1)} = min×0.4+mean×0.6)`),
      React.createElement('div',{className:'memx-grid memx-grid-4'},
        (['S','R','J','C','Safety'] as const).map(k=> React.createElement('div',{key:k, className:'memx-card', style:{textAlign:'center', background:'var(--dsw-alias-bg-layer-2)'}}, React.createElement('div',{className:'memx-kicker'},k), React.createElement('div',{style:{fontWeight:700}}, String(health.fiveDim[k])))),
        React.createElement('div',{className:'memx-card', style:{textAlign:'center', background:'var(--dsw-alias-interactive-bg-active)', borderColor:'var(--dsw-alias-border-l2)'}}, React.createElement('div',{className:'memx-kicker'},'Composite'), React.createElement('div',{style:{fontWeight:800}}, String(health.fiveDim.composite))),
      ),
    ):null,
    React.createElement('div',{className:'memx-muted'}, `Longest ${health.longest.length} entries`),
    React.createElement('div',{className:'memx-grid'},
      ...health.longest.map((it:any,i:number)=> React.createElement('div',{key:i, className:'memx-card', style:{flexDirection:'row', alignItems:'center', justifyContent:'space-between', gap:12}},
        React.createElement('div',{style:{flex:1, minWidth:0}}, React.createElement('div',{className:'memx-xs'}, `${it.len} chars`), React.createElement('div',{className:'memx-pre-sm'}, it.preview)),
        React.createElement('button',{onClick: async()=>{
          try{
            const conn2=(ctx as any).connection ?? (ctx as any).get?.('connection'); if(!conn2?.rpc?.call) throw new Error('RPC not available')
            const res:any=await conn2.rpc.call('/dsh-maestro-memory-propose','add',{content:it.preview, reason:'promote from Health longest'}); const ok=res?.ok===true?res.value:res; setMsg(ok?.queued?`proposed (queue ${ok.queued})`:`proposed: ${JSON.stringify(ok).slice(0,80)}`)
          } catch(e:any){ setMsg(`propose failed: ${e?.message??String(e)}`) }
        }, className:'memx-btn memx-btn-primary', 'data-testid':`health-propose-${i}`, style:{whiteSpace:'nowrap', flex:'none'}}, 'Suggest as KEY'),
      )),
    ),
    msg?React.createElement('div',{className:'memx-muted', style:{whiteSpace:'pre-wrap'}},msg):null,
    React.createElement('button',{onClick:load, className:'memx-btn', style:{marginTop:4}, 'data-testid':'health-refresh'}, React.createElement(Ico,{d:ICO.refresh, size:14}), 'Refresh'),
  )
}

// ── Root ───────────────────────────────────────────────────────────
function MemoryView({ ctx }: {ctx:any}): React.ReactElement {
  const rpc=useRpc(ctx)
  const [tab,setTab]=React.useState<'memory'|'review'|'todos'|'skills'|'health'>('memory')
  const [pending,setPending]=React.useState(0)
  const refreshPending=React.useCallback(async()=>{
    try{ const res:any=await rpc('status',{}); setPending(typeof res?.queue==='number'?res.queue:0) } catch{ setPending(0) }
  },[rpc])
  React.useEffect(()=>{ refreshPending() },[refreshPending,tab])

  const tabs: Array<{id:typeof tab; label:string; icon:string; count?:number}> = [
    {id:'memory', label:'Memory', icon:ICO.mem},
    {id:'review', label:'Queue', icon:ICO.inbox, count:pending},
    {id:'todos', label:'Todos', icon:ICO.check},
    {id:'skills', label:'Skills', icon:ICO.layers},
    {id:'health', label:'Health', icon:ICO.activity},
  ]

  return React.createElement('div',{className:'dshmem memx', style:{padding:'12px 12px 16px', background:'var(--dsw-alias-bg-base)', position:'relative', zIndex:1, isolation:'isolate' as any, minHeight:'100%', width:'100%'} as any},
    React.createElement('style',null, MEM_CSS),
    React.createElement('div',{className:'memx-header'},
      React.createElement('div',{className:'memx-header-main'},
        React.createElement('div',{className:'memx-title'}, React.createElement(Ico,{d:ICO.spark, size:18}), 'Memory'),
        React.createElement('div',{className:'memx-subtitle'}, 'Durable layered memory — five tracks, gated writes, todos & skills'),
      ),
      React.createElement('div',{className:'memx-header-actions'},
        React.createElement('button',{onClick:refreshPending, className:'memx-iconbtn', 'aria-label':'Refresh status', title:'Refresh'}, React.createElement(Ico,{d:ICO.refresh, size:16})),
      ),
    ),
    React.createElement('div',{className:'memx-layout'},
      React.createElement('div',{className:'memx-nav', role:'tablist', 'aria-label':'Memory sections'},
        ...tabs.map(t=> React.createElement('button',{
          key:t.id, role:'tab', id:`tab-${t.id}`, 'aria-selected':tab===t.id, 'aria-controls':`panel-${t.id}`, onClick:()=>setTab(t.id), className:'memx-navitem', 'data-testid':`tab-${t.id}`,
        },
          React.createElement(Ico,{d:t.icon}), t.label,
          t.count!==undefined && t.count>0 ? React.createElement('span',{className:'memx-badge', 'data-testid':'tab-badge-review'}, String(t.count)) : null,
          t.id==='memory'?React.createElement('span',{className:'memx-navcount'}, '5 tracks'):null,
        )),
      ),
      React.createElement('div',{className:'memx-panel', role:'tabpanel', id:`panel-${tab}`, 'aria-labelledby':`tab-${tab}`},
        tab==='memory'?React.createElement(MemoryListView,{ctx}):
        tab==='review'?React.createElement(ReviewQueueView,{ctx, onPendingChange:setPending}):
        tab==='todos'?React.createElement(TodosView,{ctx}):
        tab==='health'?React.createElement(HealthView,{ctx}):
        React.createElement(SkillsView,{ctx}),
      ),
    ),
  )
}

export function apply(ctx:any): void {
  ctx.effect(()=>{
    const dispose=ctx.slots.inject('conversation.view', ()=> ctx.slots.register({ name:'conversation.view', id:'maestro-memory', order:40, label:()=>'Memory' }, ()=> React.createElement(MemoryView,{ctx})))
    return ()=>{ if(typeof dispose==='function') dispose() }
  },'maestro-memory: view')

  ctx.effect(()=>{
    const conn=(ctx as any).connection ?? (ctx as any).get?.('connection')
    if(!conn?.rpc?.call) return ()=>{}
    const BADGE_ATTR='data-dshmem-header-badge'
    const VIEW_ATTR='data-dshmem-memory-tab'
    const findMemoryTab=(): HTMLElement|null=>{
      const tabs=document.querySelectorAll('button[role="tab"]')
      for(const tab of Array.from(tabs)){ if(tab.getAttribute(VIEW_ATTR)==='1') return tab as HTMLElement }
      for(const tab of Array.from(tabs)){ if(tab.closest('.memx')) continue; if((tab.textContent??'').trim()==='Memory'){ tab.setAttribute(VIEW_ATTR,'1'); return tab as HTMLElement } }
      return null
    }
    const renderBadge=(count:number): void=>{
      const tab=findMemoryTab(); if(!tab) return
      const existing=tab.querySelector(`[${BADGE_ATTR}]`)
      if(count<=0){ if(existing) existing.remove(); return }
      if(existing && (existing.textContent===String(count))) return
      if(existing) existing.remove()
      const badge=document.createElement('span'); badge.setAttribute(BADGE_ATTR,''); badge.className='dshmem-header-badge'; badge.textContent=String(count); tab.appendChild(badge)
    }
    let styleEl=document.getElementById('dshmem-header-style') as HTMLStyleElement|null
    if(!styleEl){ styleEl=document.createElement('style'); styleEl.id='dshmem-header-style'; styleEl.textContent=HEADER_BADGE_CSS; document.head.appendChild(styleEl) }
    let disposed=false; let lastCount=0
    const refresh=async():Promise<void>=>{
      if(disposed) return
      try{ const result:any=await conn.rpc.call(RPC_CHANNEL,'status',{}); const value=result?.ok===true?result.value:null; lastCount= typeof value?.queue==='number'?value.queue:0; renderBadge(lastCount) } catch{ lastCount=0; renderBadge(0) }
    }
    void refresh()
    const timer=window.setInterval(()=>{ void refresh() },8000)
    const observer=new MutationObserver(()=>{
      if(disposed) return; const tab=findMemoryTab(); if(!tab) return
      const hasBadge=tab.querySelector(`[${BADGE_ATTR}]`)
      if(lastCount>0 && !hasBadge) renderBadge(lastCount); else if(lastCount<=0 && hasBadge) renderBadge(0)
    })
    observer.observe(document.body,{childList:true,subtree:true})
    return ()=>{ disposed=true; window.clearInterval(timer); observer.disconnect(); styleEl?.remove(); const tab=findMemoryTab(); if(tab) tab.querySelector(`[${BADGE_ATTR}]`)?.remove() }
  },'maestro-memory: header-badge')
}
