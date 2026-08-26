# dsh-maestro-memory — Architecture (M0 seam audit)

> **Canonical umbrella:** `docs/architecture.md` at the workspace root is the authoritative cross-repo map. This file is the **M0 seam audit** for `dsh-maestro-memory` specifically — it records the exact DSH surfaces this plugin owns and how they are injected. The workspace `docs/specs/dsh-maestro-memory.md` (v0.1.0) is the source-of-truth spec; `dsh-maestro-memory/README.md` is the operator guide.

## 1. Package & profile

- **Package:** `@ddtcorex/dsh-maestro-memory` (`cordis.patch.yml` id `maestro-memory`)
- **Install:** `dsh plugin --profile web add link:<workspace-root>/packages/dsh-maestro-memory` (dev) or `github:ddtcorex/dsh-maestro-memory#<sha>` (prod — pin to exact SHA, branch tarballs are stale per `AGENTS.md` pnpm pitfall)
- **Profile rule:** exactly one owner for each compatibility tool (`memory`/`dtodo`/`memory_suggest`); do not keep `dsh-memory-evolve` and `dsh-maestro-memory` in the same profile

## 2. Host — Cordis seams (M0 audit)

All registrations are via `ctx.effect(() => disposer, label)` so `stop`/`update`/`undefine` cleans up. No HTTP route.

| Seam | How we use it | Signature (as shipped) | Notes |
|---|---|---|---|
| `ctx.tools.register` | `memory`, `dtodo`, `memory_suggest`, `memory_review_status` (+ `skill_manage` only when the optional skills module is explicitly enabled) | `ctx.effect(() => ctx.tools.register(defineTool({name, description, parameters, execute})), 'maestro-memory: tool')` | Content output via `CONTENT_OUTPUT` schema `{content:{type:array,required:true}}` |
| `ctx.systemPrompt.context` | Bounded snapshot `USER + global MEMORY + current-project KEY` + session header + discipline note | `{name:'memory:snapshot', order: config.snapshotOrder ?? 500, text:(ctx)=>renderSnapshot(store,{cwd,branch,sessionId,sessionName})}` | `renderSnapshot` pure in `src/host/prompt/snapshot.ts`; `daily`/`project` logs never injected; branch-filtered via `store.list('key',cwd,{branch})` |
| `ctx.connection.rpc.handle` | Package-private RPC `/dsh-maestro-memory` | `conn = ctx.connection ?? ctx.get('connection'); if (!conn?.rpc?.handle) no-op` | Endpoints: `queue.list/decide`, `memory.list/mutate`, `todo.list/mutate`, `status`, `migration.*`, `sync.*`, `skills.list` |
| `ctx.workspaceRegistry` (injected) | Resolve `cwd` for project-hash isolation when `exec.agent.session.header.cwd` is absent | `inject = ['tools','systemPrompt','connection']` (workspaceRegistry available via `ctx.get`) | Hash = `sha1(cwd)[:12]` via `storage/layout.ts:projectHash` |

Compatibility matrix (M0): no core owner for `memory`/`dtodo`/`memory_suggest` was found in `deepseek-harness/packages/todo/tool-todo` (owns only `todo_write`) or `skill/tool-skill` (owns `skill`). If DSH core later claims one of these names, rollout must pause and choose "configure-off in profile" or "narrow adapter" — do not shadow.

## 3. Storage & atomicity

- **Root:** `resolveMemoryRoot(memoryDir ?? join(homedir(),'.dsh','memories'))`
- **Files:** `MEMORY.md`/`USER.md` + `*-archive.md` + `SUGGESTIONS.jsonl` + `TODOS-life.md`/`TODOS-work.md` + `daily/YYYY-MM-DD.md` + `daily/YYYY-MM-DD.todo.md` + `projects/<hash>/{MEMORY.md,KEY.md,KEY-archive.md,TODOS.md}` + `.maestro-memory/{schema.json,migration-journal.jsonl,backups/<runId>/,write-block.json,sync/<hash>/}`
- **Delimiter:** `ENTRY_DELIMITER='\n§\n'` byte-compatible with `dsh-memory-evolve/lib/store.js`; `parseEntries`/`serializeEntries`/`isCanonical` in `storage/{legacy-format,atomic-store}.ts`
- **Atomic write:** per-directory `.maestro.lock` (stale 10s + `kill(pid,0)` liveness, retry 25ms, timeout 5s, reentrancy guard) → validate canonical → dedupe via `stripEntryId`+`isDuplicate` → temp `.<uuid>.tmp` (`wx`,0o600) → `fsync` → `rename` → `fsync` dir → reread validate

## 4. Client

- **Injects:** `dsh-client-connection` + `dsh-client-ui-slots` (+ `locale`/`conversation`/`sessions`)
- **Slot:** single `conversation.view` `{name:'conversation.view', id:'maestro-memory', order:40, label:()=>'Memory'}` with internal tabs **Memory / Review queue / Todos / Skills / Sync**
- **RPC:** `useRpc = (ep,payload)=>conn.rpc.call('/dsh-maestro-memory',ep,payload)`; refresh after mutation and on `connection/reset`; no fetch to `/memory-evolve`, no mutation observer

## 5. File map

```
src/host/
  index.ts                 # apply() — tools, snapshot, RPC
  memory/store.ts          # MaestroMemoryStore — 5 tracks + archive/branch/summary/expand
  todo/store.ts            # TodoStore — 4 tracks + quadrant/due/smart view (limit 8)
  review/queue.ts          # SuggestionQueue — SUGGESTIONS.jsonl gating
  storage/{layout,atomic-store,legacy-format}.ts
  prompt/snapshot.ts       # renderSnapshot() — bounded snapshot + discipline note (M0-M1)
  migration/{service.ts,cli.ts,fixture.ts}
  sync/{service.ts,git.ts,merge.ts,config.ts,layout.ts}  # M5 — opt-in, disabled = zero network
  skills-browser.ts        # M6 — read-only maestro-skills listing
src/client/index.tsx       # Memory view + Review queue + Todos + Skills + Sync
tests/                     # 14 files, 200+ tests at feat/snapshot-discipline-trigger tip
```

## 6. Where to read next

- **Spec (source of truth):** `docs/specs/dsh-maestro-memory.md` (v0.1.0, 13 chapters) and `dsh-maestro-memory/README.md`
- **Plans:** `docs/plans/2026-08-24-dsh-maestro-memory-plan.md` (+ addendum 2026-08-26) and `docs/plans/2026-08-25-snapshot-discipline-trigger-plan.md`
- **Sync design (now APPROVED):** `docs/sync-design.md`
- **Umbrella architecture:** `docs/architecture.md` at the workspace root
