# dsh-maestro-memory — Architecture & DSH Seams (M0)

> **Status:** Draft for M0 Boundary audit — validated against live `deepseek-harness` checkout and `dsh-maestro-memory` rebrand (master @ e894212).

## Goal

Prove current DSH seams and tool ownership before any implementation, per `docs/plans/2026-08-24-dsh-maestro-memory-plan.md` M0.

## Validated seams (live checkout)

| Seam | How it is provided | Exact signature (from source) | Notes |
|---|---|---|---|
| **Host tools** | `ctx.tools.register(toolDef)` inside `ctx.effect(() => ..., 'label')` | `lib/index.js:1555 ctx.effect(() => ctx.tools.register(memoryTool(...)), 'maestro-memory: memory tool')` etc. | Disposer via `ctx.effect` return, label for debugging. Tool names: `memory`, `dtodo`, `skill_manage`, `memory_suggest`, `memory_review_status`. No core owner for `memory`/`dtodo`/`skill_manage` — `deepseek-harness/packages/todo/tool-todo` registers `todo_write` (different name), `skill/tool-skill` registers `skill`. |
| **System prompt snapshot** | `ctx.systemPrompt.context({name, order, text})` | `lib/index.js:1541-1550 ctx.effect(() => ctx.systemPrompt.context({ name:'memory:snapshot', order: config.snapshotOrder, text: (ctx)=>renderSnapshot(...) }), '...')` | Order default `500` (config.snapshotOrder). Text is bounded: `USER + global MEMORY + current-project KEY` plus session-id header and end-of-turn discipline prompt (from `lib/i18n.js`). |
| **RPC (package-private)** | Host: `ctx.connection.rpc.handle(channel, handler)` → disposer; Client: `ctx.connection.rpc.call(channel, endpoint, payload, signal)` | Sibling `dsh-maestro-harness/lib/settings-rpc.js:144 const disposeRpc = ctx.connection.rpc.handle(MAESTRO_RPC_CHANNEL, async (endpoint,payload)=>{...})` + `ctx.effect(()=>disposeRpc)`; client `dsh-maestro-harness/client/index.jsx:742 const rpcCall = (endpoint,payload,signal)=>ctx.connection.rpc.call(MAESTRO_RPC_CHANNEL, endpoint,payload,signal)` | Channel for new plugin: `/dsh-maestro-memory`. No HTTP. Verified in `packages/client/connection` and `packages/client/runtime`. |
| **Web UI slots** | Host: `ctx.slots.inject('conversation.view', ()=>ctx.slots.register({name:'conversation.view', id, order, label}, render))` | `src/client/index.ts:1911 disposeMemoryTab = ctx.slots.inject('conversation.view', ()=>ctx.slots.register({ name:'conversation.view', id:'memory-files', order:10, label:()=>... }, (props)=>MemoryTabView(...)))` etc. (orders 10/20/30/120 in legacy) | Slot `conversation.view` exists in `deepseek-harness/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:1096`. New plugin: single entry `{name:'conversation.view', id:'maestro-memory', order:40, label:()=>'Memory'}` with internal Memory/Review/Todos tabs. `label` may be string or function; `order` 40 avoids legacy 10/20/30. Client injects `['slots','locale','conversation','sessions']` (verified `src/client/index.ts:1726 export const inject = ['slots','locale','conversation','sessions']`). |
| **Web server (legacy, to be dropped)** | `ctx.webServer.register({kind:'prefix', path:'/memory-evolve', handler})` via `ctx.inject(['webServer'], ...)` | `legacy/lib/api.js:831 return ctx.webServer.register({ kind:'prefix', path:'/memory-evolve', handler })` | No other profile plugin depends on `/memory-evolve/api` (grep of `dshmarket`, `dsh-better-sidebar` etc. shows 0 hits). New design has no HTTP. |

## Service / event names (new plugin)

- Host services (per plan): `maestroMemory`, `maestroMemoryStore`, `maestroTodoStore`, `maestroMemoryMigration`
- Host events: `maestro-memory/changed`, `maestro-memory/migration-complete` with payload `{domain, target, projectId?, revision}`
- RPC channel: `/dsh-maestro-memory` with endpoints `maestroMemory.status`, `files.list`, `memory.list`, `memory.mutate`, `queue.list`, `queue.decide`, `todo.list`, `todo.mutate`, `migration.inspect/dryRun/run/verify`
- All host registrations via `ctx.effect` + disposer, as validated above.

## Tool ownership (M0 gate)

- Live profile `~/.dsh/profiles/web/package.json` bundles: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `dshmarket`, `@ddtcorex/dsh-maestro-harness`, `@ddtcorex/maestro-skills`, `dsh-find-plugin`, `dsh-better-sidebar`, `@dsh-external/dsh-mobile-nav`, `@deepseek-ai/dsh-subagent-*`
- No core package registers `memory`/`dtodo`/`skill_manage` — verified via `grep -rln "memory|dtodo|skill_manage" deepseek-harness/packages` (only `todo/tool-todo` with `todo_write` and `skill/tool-skill` with `skill`). Collision gate passes today.
- If future DSH core adds an owner for any compat name, M0 gate must stop rollout and owner must choose to configure it off or approve an adapter — do not shadow.

## Disk schema (as implemented, matches live `~/.dsh/memories`)

```
~/.dsh/memories/
  MEMORY.md                 USER.md                 # created lazily, may be absent
  MEMORY-archive.md         USER-archive.md
  SUGGESTIONS.jsonl
  TODOS-life.md             TODOS-work.md           # life/work at root, may be absent until first write
  daily/YYYY-MM-DD.md       daily/YYYY-MM-DD.todo.md
  projects/<sha1(cwd)[:12]>/
    MEMORY.md               KEY.md
    KEY-archive.md          TODOS.md
  .maestro-memory/           # new
    schema.json
    migration-journal.jsonl
    backups/<utc-run-id>/manifest.json
    backups/<utc-run-id>/files/...
  # legacy, preserved in backup manifest but not imported:
  advisor/  pending-skills/  plugin-state.json  search-docs-index.json  coi/
```

- Live root currently has only `SUGGESTIONS.jsonl`, `TODOS-work.md`, `daily/`, `projects/<hash>/MEMORY.md`, plus `advisor/`, `pending-skills/` — `MEMORY.md`/`USER.md` absent until first global write (migration must handle missing optional files, already covered in M3 PR B tests).
- Project hash = `createHash('sha1').update(cwd).digest('hex').slice(0,12)` at `lib/store.js:454`, matches key-memory `sha1(cwd)[:12]`.

## Behavioral prompt contract (must be ported)

Snapshot text (renderSnapshot + i18n) currently injects:
- Session ID / name / alias header (used for `session-db…` matching)
- `End of every turn ... you must: 1. Write daily+project` batch via `memory` entries (daily+project in one call)
- Todos reminder: `dtodo list` at turn end, bounded smart view (max 8)
- Feedback `[Feedback]` line format (sentiment/category/quote/note)
These are part of the compatibility surface — new `prompt/snapshot.ts` must reproduce them or agents silently stop writing logs. Keep English-first, no Chinese carryover.

## Next (M0 remaining)

- Create non-home fixture copies for every legacy memory/todo/archive/queue shape, one project cwd/hash, symlinked skills dir
- Write retained/removed/changed compatibility matrix (this doc is the retained seam table)
- Tiny test plugin that registers/disposes tool, snapshot, RPC, view slot — proves seams (M0 accept)

---
*Generated 2026-08-24 for `dsh-maestro-memory` rebrand. Update when DSH source advances.*
