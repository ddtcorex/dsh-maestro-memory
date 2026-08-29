# dsh-maestro-memory

## Purpose

Durable, user-governed memory and todos for DeepSeek Harness (DSH) that preserves your existing `~/.dsh/memories` files in place.

> **One sentence:** Give the AI in DSH cross-session durable memory and todos — the more you use it, the more it understands you, and switching sessions never loses context.

- **Package:** `@ddtcorex/dsh-maestro-memory` (`cordis.patch.yml` id `maestro-memory`)
- **Changelog:** `CHANGELOG.md`
- **Version:** `1.0.1`

---

## Requirements

- Node.js 22+, pnpm 11+
- DSH `deepseek-harness` master (for `cordis`, `dsh-client-*` peers)
- Existing `~/.dsh/memories` directory (created lazily if absent)

---

## Install

From the checked-out repo:

```sh
pnpm install                    # install deps (frozen lockfile in CI)
pnpm run build                  # tsc host + tsc client + build-client.mjs -> lib/
pnpm run verify                 # tsc --noEmit host + client (typecheck)
pnpm test                       # full Vitest suite (13 files, 199 tests)
```

Manual verification of the client bundle:

```sh
test -f lib/client.js && head -n 2 lib/client.js | grep -q "ModuleLoader" && echo "bundle ok"
ls -lh lib/client.js lib/index.js
```

### From a DSH profile (operator)

The package is consumed as a DSH plugin via `cordis.patch.yml`. Two install paths:

**Local link (development / recommended for cutover rehearsal):**

```sh
# inside the profile that will own the plugin:
dsh plugin --profile web add link:<workspace-root>/packages/dsh-maestro-memory
# or manually in ~/.dsh/profiles/web/package.json:
# "@ddtcorex/dsh-maestro-memory": "link:<workspace-root>/packages/dsh-maestro-memory"
```

**Git / registry (production after release):**

```sh
dsh plugin --profile web add github:ddtcorex/dsh-maestro-memory#<tag-or-sha>
# pin to an exact commit SHA; branch names reuse stale tarballs (pnpm cache pitfall)
```

After install, rebuild is not needed inside the profile — the host loads `lib/index.js` and the client loads `lib/client.js` via the `dsh.client` manifest. If you edited `src/client/`, rebuild at the checkout first (`pnpm run build`).

---

## Profile Patch

`cordis.patch.yml` is **owned by the package** and applied automatically by `dsh plugin add`. Do not duplicate it in the profile.

```yaml
# dsh-maestro-memory/cordis.patch.yml (shipped with the package)
- insert:
    - id: maestro-memory
      name: '@ddtcorex/dsh-maestro-memory'
      config:
        memoryDir: null        # null -> ~/.dsh/memories
        snapshotOrder: 500     # systemPrompt.context order
```

Profile `~/.dsh/profiles/web/package.json` after a correct install:

```json
{
  "dsh": { "profile": { "bundles": ["@ddtcorex/dsh-maestro-memory"] } },
  "dependencies": {
    "@ddtcorex/dsh-maestro-memory": "link:<workspace-root>/packages/dsh-maestro-memory"
  }
}
```

**Rules:**

- `dependencies` value **must be `link:`**, not a semver. CI and `assertSingleOwner` reject non-link owners.
- `bundles` must list exactly one owner for each compat tool (see below). Do not keep `dsh-memory-evolve` and `dsh-maestro-memory` in the same profile — they compete for `memory`/`dtodo` and for file ownership. The loader crashes on duplicate `id: maestro-memory` if you copy the patch row into the profile manually.
- `memoryDir: null` resolves to `~/.dsh/memories` (`resolveMemoryRoot(null)`). Override only for tests / rehearsal (`--root /tmp/...`).

Verify the profile in a rehearsal (see `src/host/migration/fixture.ts`):

```ts
import { createFixtureProfile, assertSingleOwner } from '@ddtcorex/dsh-maestro-memory/migration/fixture'
await createFixtureProfile({ profileDir: '/tmp/profile', packageDir: '/path/to/dsh-maestro-memory' })
const res = await assertSingleOwner('/tmp/profile')
console.assert(res.ok && res.owners['memory'] === '@ddtcorex/dsh-maestro-memory')
```

---

## Supported Tools

All tools are registered via `ctx.tools.register` inside `ctx.effect(..., 'label')` so they dispose cleanly on unload. No HTTP.

| Tool | Purpose | When visible |
|------|---------|--------------|
| `memory` | CRUD + query for five tracks (`memory`/`user`/`project`/`key`/`daily`) + archive/expand. See `src/host/memory/store.ts`. | Always |
| `dtodo` | Four-track todos (`life`/`work`/`project`/`daily`) with stable 8-hex ids, status/due/quadrant, smart view (max 8), historical daily lookup. | Always |
| `memory_suggest` | **Gated** — model proposes `memory`/`user`/`key`/`todo-*` into `SUGGESTIONS.jsonl`; never writes directly. Requires human approve/edit/reject via Review UI or `queue.decide` RPC. | Always |
| `memory_review_status` | Read-only queue depth / write-block status (used by prompt hint / UI badge). | Always |
| `skill_manage` | Browse / mutate `~/.agents/skills` (optional module). Disabled by default; enable only if the optional skills module is explicitly configured. | Opt-in |

### `memory` — actions and targets

```ts
memory({
  action: 'add'|'list'|'replace'|'remove'|'archive'|'expand',
  target: 'memory'|'user'|'project'|'key'|'daily',   // memory=global, key=per-cwd long-term
  content?: string,    // add: entry body; replace: new body
  match?: string,      // replace/remove/archive: unique substring of existing entry
  filter?: string,     // list: content substring filter
  since?: string, until?: string,  // list: YYYY-MM-DD
  limit?: number, recent?: boolean, branch?: string, archived?: boolean,
  branches?: string,   // add key: csv "main,dev" (empty=all), branch scope
  summary?: string,    // add key: one-line summary for progressive disclosure
  id?: string,         // expand: [mem-xxxx] id
  cwd?: string,        // project/key track working directory (defaults to session cwd)
  date?: string,       // daily track YYYY-MM-DD
})
```

- **Progressive disclosure:** `key` entries are stored with an optional `[summary]` line; `list` without `expand` returns summaries; `expand` with `id` returns full text.
- **Branch scope:** `key` entries may carry `[branch:main]` tags; `list` with `branch` filters to that branch + entries with no branch tag.

### `dtodo` — actions

```ts
dtodo({
  action: 'add'|'list'|'done'|'update'|'remove',
  target?: 'life'|'work'|'project'|'daily',  // add/list filter; add defaults to cwd?project:work
  content?: string,
  id?: string,             // done/update/remove
  due?: string,            // YYYY-MM-DD
  quadrant?: 'q1'|'q2'|'q3'|'q4', // or important/urgent booleans -> quadrant
  cat?: string, status?: 'pending'|'doing'|'done'|'blocked'|'cancelled',
  all?: boolean, past?: boolean, expired?: boolean,  // list: smart-view controls
  cwd?: string, date?: string,
})
```

- **Smart view (default):** when `all !== true` and no filter, `list` returns at most 8 items ordered `overdue -> due today -> current project -> q1/q2 -> rest`. Uses local date, not UTC.
- **History:** `past=true` alone shows only completed history; `past=true AND expired=true` includes expired unfinished daily todos (daily todos expire same day).

### `memory_suggest` (gated)

```ts
memory_suggest({ target: 'memory'|'user'|'key'|'todo-life'|'todo-work'|'todo-project'|'todo-daily', content: string, reason: string })
```

Dedupes by `(target, content)` within the queue (bumps `hits`), appends to `SUGGESTIONS.jsonl`. The model must never write `key`/`user` directly — queue + human click is the only activation path.

---

## System Prompt Snapshot

Registered as `ctx.systemPrompt.context({ name: 'memory:snapshot', order: 500, text: (ctx) => renderSnapshot(cwd, branch) })`.

Injected text is **bounded** and deterministic: `USER + global MEMORY + current-project KEY` (branch-filtered if `session.header.branch` is present) + optional `Recent Daily` (last 2 days, 512B) + header with `sessionId`/`sessionName` and an end-of-turn discipline note (rendered verbatim as `---` + newline + sentence):

> End of every turn you must: 1. Write daily+project via memory entries (daily+project in one call) 2. Check dtodo list (bounded, max 8)
> For important project decisions (convention, incident, infra) use memory_suggest target=key with reason, not memory add.

`project log` (`projects/<hash>/MEMORY.md`) is queryable via `memory` but **not injected**, to keep prompt cost predictable. `daily` is **only** via `Recent Daily` (512B, last 2 days' newest entries) — full daily history remains query-only. New `prompt/snapshot.ts` must reproduce this contract or agents silently stop writing logs.

Each injected section also enforces a **per-track byte cap** — defaults `SNAPSHOT_SECTION_CAPS = { memory: 2048, user: 4096, key: 6144, recentDaily: 512 }` (total 12.5K), overridable per call via `renderSnapshot(store, ctx, { caps })`. Entries are kept newest-first; the oldest overflow is dropped. The newest entry is always kept: if it alone exceeds the cap **and** carries an `[summary:…]` header tag (parsed by `ENTRY_HEAD_RE`), it renders compacted to `head + [summary:…]`; untagged oversize entries stay whole rather than vanishing.

**Gated `key`:** `memory add` with `target=key` via tool (`exec.agent` present) is now **gated** — it returns `key is gated — use memory_suggest target=key with reason` and requires the confirmation queue. Direct `store.add('key', ...)` from CLI/scripts (`maestro-memory-remediate.mjs`, tests) still works.

---

## UI & RPC

- **UI:** exactly one `conversation.view` slot `{ name:'conversation.view', id:'maestro-memory', order:40, label:()=>'Memory' }` with internal tabs **Memory / Review queue / Todos / Skills / Health**. Health shows `project coverage` (with summary %), `daily last 7d`, `longest` 5 entries with **Suggest as KEY** button (→ `memory_suggest` queue), and `Discipline` metric (avg calls/session). Uses package-private RPC, no HTTP, no DOM hacks. Client injects `['slots','sessions','connection']`.
- **RPC channels:** `/dsh-maestro-memory` (`ctx.connection.rpc.handle` host, `ctx.connection.rpc.call` client). Endpoints: `queue.list`, `queue.decide` (`approve`/`reject`/`archive` with optional `edits`/`targets` + `cwd`), `memory.list`, `todo.list`, `todo.mutate`, `migration.inspect`/`dryRun`/`run`/`verify`, `status` (`{ queue, blocked }`). `migration.run` via RPC requires `payload.apply === true`. **Plus loopback-only:** `/dsh-maestro-memory-health` (`get` → `{project:{total,withSummary,coverage}, daily:{counts[7]}, longest[5]}`) and `/dsh-maestro-memory-propose` (`add` → `enqueueSuggestion` for `key`, used by Health button).

---

## Maintenance

Weekly keep `project` from re-growing (after `remediate` 100%):

```sh
node scripts/maestro-memory-remediate.mjs --apply --threshold-days 14
node scripts/enforce-rules.mjs --check-memory --threshold 90  # still PASS
```

---

## Cutover

**Principle:** staged single-owner replacement — never run `dsh-memory-evolve` and `dsh-maestro-memory` in the same profile. The new internals, services, RPC methods, and slot ids use a Maestro namespace; compatibility is limited to agent-facing tool names and legacy file grammar.

**Operator steps (production):**

1. **Preflight** on a copy, not live home (see Migration). Keep the live profile untouched until verification passes.
2. **Backup** the live `~/.dsh/memories` via `node scripts/migrate.mjs --root ~/.dsh/memories --apply` — this is the only write; it creates `manifest.json` + byte-identical `files/` under `.maestro-memory/backups/<utc-run-id>/` + `schema.json` + `journal`.
3. **Verify** (`--verify`) — must be `ok=true`, `mismatches=[]`. If not, writes are blocked (`write-block.json`) — resolve before continuing.
4. **Profile swap:** remove `dsh-memory-evolve` from `bundles`/`dependencies`, add `@ddtcorex/dsh-maestro-memory` as `link:` (or pinned git SHA). Ensure exactly one owner per compat tool (`memory`, `dtodo`).
5. **Reload profile:** restart `dsh web` at a user-approved window (ask first — do not kill the live `dsh web` process mid-session; it holds both :3000 and :3080). After restart, live-read every track (`memory` list for each target, `dtodo` list) before first mutation.
6. **One write** against live data, then `verify` again.

**Before any writes, rollback is just a profile change** (remove Maestro, restore old bundle). After writes, restore files from the manifest.

For a disposable rehearsal, use `src/host/migration/fixture.ts` (`createFixtureProfile`, `createCopiedMemoryRoot`, `assertSingleOwner`) — see `tests/m4-rehearsal.spec.ts` and the `Migration rehearsal` CI job. Never touch `~/.dsh/memories` in tests.

---

## Migration

CLI: `node scripts/migrate.mjs --root <path> [--inspect|--dry-run|--verify|--apply] [--run-id <id>]`

Default is **read-only**. The only write is `--apply`.

| Command | Effect | Side effects |
|---------|--------|--------------|
| `--inspect` (default) | Inventory, parse, byte count, SHA-256, warnings for malformed JSONL / locks / non-canonical files | None |
| `--dry-run` | Same as inspect, explicitly read-only | None |
| `--apply` | **Backup + adopt:** byte-preserving copy of every file (excluding `.maestro-memory`) into `backups/<utc-run-id>/files/` + `manifest.json` (`path, bytes, sha256, inventory`) + `schema.json` + `migration-journal.jsonl` entry. Only after all required data parses; source content is never reformatted. | Writes `manifest`, `files/`, `schema.json`, `journal` |
| `--verify` | Reopen with new stores, compare digest (`bytes`, `sha256`) + inventory (`memoryEntries`, `todoIds`, `queueValid`) against manifest. On mismatch, writes `.maestro-memory/write-block.json` and blocks mutations; on success clears the block. | Writes `write-block.json` on failure; clears on success |

**Disk layout:**

```
~/.dsh/memories/
  MEMORY.md                 USER.md                 # may be absent until first global write
  MEMORY-archive.md         USER-archive.md
  SUGGESTIONS.jsonl
  TODOS-life.md             TODOS-work.md
  daily/YYYY-MM-DD.md       daily/YYYY-MM-DD.todo.md
  projects/<sha1(cwd)[:12]>/
    MEMORY.md               KEY.md
    KEY-archive.md          TODOS.md
  .maestro-memory/
    schema.json
    migration-journal.jsonl
    write-block.json        # present only when verify failed
    backups/<utc-run-id>/
      manifest.json         # { files:[{path,relative,bytes,sha256,kind,...}], inventory, runId, at }
      files/...             # byte-identical copies
```

**Warnings (non-fatal, reported in `inspect`/`dryRun`/`verify`):**

- `non-canonical` — file does not round-trip through `§` parse/serialize (drift); mutation is refused until canonicalized.
- `malformed todo` — entry missing timestamp/id in a todo file.
- `malformed queue` — JSONL line in `SUGGESTIONS.jsonl` that does not parse as `{target, content}`.

**Write-block:** `migration/service.ts:isWriteBlocked(root)` checks `.maestro-memory/write-block.json`. When blocked, `memory`/`dtodo` mutations return an error until `verify` passes or `rollback` clears it.

**Examples:**

```sh
node scripts/migrate.mjs --root ~/.dsh/memories            # inspect (read-only)
node scripts/migrate.mjs --root /tmp/mem --dry-run         # dry-run
node scripts/migrate.mjs --root /tmp/mem --apply           # backup + adopt
node scripts/migrate.mjs --root /tmp/mem --verify          # verify (latest manifest)
node scripts/migrate.mjs --root /tmp/mem --verify --run-id 20260824T151230.425Z
```

---

## Verification

1. After `inspect`/`dryRun`, confirm `ok=true`, expected `memoryEntries`/`todoIdsCount`/`queueValid`, and review `warnings`.
2. After `--apply`, confirm `manifest.json` exists, each `files/<relative>` copy is byte-identical (`sha256` matches), and `~/.dsh/memories` files are unchanged (no reformatting).
3. After `--verify`, confirm `ok=true`, `mismatches=[]`. If `ok=false`, check `mismatches` (`digest mismatch`, `byte count mismatch`, `todo ID set mismatch`, `inventory mismatch`) and `.maestro-memory/write-block.json`. No mutation should proceed while blocked.
4. After profile reload, live-read via tools/RPC (`memory` list for `memory`/`user`/`key`/`daily`/`project`, `dtodo` list for `life`/`work`/`project`/`daily`) and compare to pre-cutover inventory.

The rehearsal suite (`tests/m4-rehearsal.spec.ts`) exercises the full sequence against a copied schema: fixture profile (`link:`) → one-owner proof → dry-run (no `.maestro-memory`) → backup (byte-preserving) → verify → profile reload (`apply`/`ctx.effect`) → live reads → one write → second verify (fails) → rollback (byte-identical) → verify (passes) → live home untouched.

---

## Rollback

Rollback restores files **byte-identical** from a backup manifest. It is exercised and tested in `tests/m4-rehearsal.spec.ts`.

**When to rollback:**

- Before any writes: no rollback needed — just revert the profile change (remove Maestro bundle, restore old plugin).
- After a failed `verify` or a bad write: restore from the backup that `verify` reports.

**How (CLI / service API):**

```ts
import { rollback } from './src/host/migration/service.ts'
// restore latest (schema.json runId or newest backup)
await rollback('/tmp/memories')
// or specific run
await rollback('/tmp/memories', '20260824T151230.425Z')
```

Or via the `migration` RPC (host) if exposed. The service:

- Copies each `manifest.files[].relative` from `backups/<runId>/files/` to its original `path`, verifying `sha256` after copy.
- If a file was absent at backup time (`exists:false` in manifest) but appeared later, it is removed.
- Clears `write-block.json` on completion and appends a `rollback` entry to `migration-journal.jsonl`.
- Returns `{ ok, runId, manifestPath, restored, errors }` (`restored` = count of files restored/removed).

**After rollback:**

- `verify` must pass (`ok=true`, no mismatches).
- A new write must succeed (the write-block is cleared).

**Retention:** keep `~/.dsh/memories/.maestro-memory/backups/` for at least 90 days after cutover (per plan). Do not delete the manifest for the adopted run.

---

## Removed Features (intentionally not in v1)

Source-grounded inventory. Propose any as a separate plugin later.

| Source subsystem | Verdict | Rationale |
|------------------|---------|-----------|
| **Cross-device Git memory sync** (`lib/sync/*`) | **KEEP as optional module (M5)** | Large conflict-resolution product; must not delay local-data reliability. Disabled = zero network/Git activity. |
| **Skills management/browser** (`lib/skills.js`, `lib/skills-manager.js`) | **KEEP as optional module (M6)** | Mutates `~/.agents/skills`; Maestro already owns skills in `maestro-skills`. Core stays read-only. |
| **COI / external CLI dispatch, scheduler, broadcast, ws coordinator, stats, attachments, session orchestration** (`lib/coi/*`, `lib/session-orch.js`) | **DROP** | Independent orchestration platform; profile already has DSH Codex/Claude subagent bundles. |
| **Advisor** (`lib/advisor/*`) | **REDESIGN** (separate opt-in plugin) | Full reviewer runtime with model calls and panel — not memory. |
| **Notify / channel send / session images** (`lib/notify.js`) | **DROP** | IM/web delivery via global integration registry (`de_channel_send`, `de_notify`); unrelated to durable memory. |
| **Local / docs / Codex search** (`lib/search-docs.js`, `lib/search/*`) | **DROP** | Host file scans / shell-out expands authority without being needed for memory. |
| **Prompt injection library** (`lib/prompts.js`) | **DROP** | Reusable guidance belongs in `maestro-skills`. |
| **Model registry / settings** (`lib/models.js`) | **DROP** | Overlays DSH model config; `lib/index.js` already injects DSH settings/llm. |
| **Bookmarks, Mermaid, canvas, UI settings, aliases, update checker, i18n** (`lib/{bookmarks,mermaid,canvas,ui-settings,aliases,update,i18n}.js`) | **REDESIGN** | Independent features; propose individually if needed. |
| **Client/WebUI broad tabs** (`src/client/index.ts` family) | **REDESIGN** | Legacy mounts many tabs/actions + HTTP API; v1 has one slot + package-private RPC. |
| **HTTP API** (`lib/api.js` `/memory-evolve` prefix, `ctx.webServer`) | **DROP** | No `webServer` registration; only `ctx.connection.rpc.handle('/dsh-maestro-memory', …)`. |

**Preserved in backup but not imported:** `advisor/`, `pending-skills/`, `plugin-state.json`, `search-docs-index.json`, `coi/` (copied byte-identical into `files/` and listed in `manifest.json`, never parsed as memory state).

---

## Workflow: Superpowers skills are mandatory

Every change to this repository MUST follow the Superpowers skill workflow, in order:

1. **brainstorming** — explore intent, requirements, and design before any code; record the outcome in `docs/superpowers/specs/` (`YYYY-MM-DD-<topic>-design.md`).
2. **writing-plans** — turn an approved spec into a task-by-task plan with exact test and implementation sketches in `docs/superpowers/plans/` (`YYYY-MM-DD-<topic>.md`).
3. **executing-plans** — implement task by task with strict TDD: write the failing test first, verify RED, implement, verify GREEN, then commit that task as its own commit before starting the next.

Do not skip ahead to implementation, batch multiple tasks into one commit, or commit while a task's tests are red. Trivial mechanical fixes may go straight to a commit but still need tests when behavior changes.

---

## Git Workflow

- Never commit to `master` directly; batch related work on a feature branch (`feat/...`, `fix/...`). One TDD task = one commit while executing a plan.
- Conventional commit subjects, imperative mood.
- Push the branch and open an MR when the batch is green; rebase instead of merging master into the branch when the base moves.
- `origin` is `git@github.com:ddtcorex/dsh-maestro-memory.git` (private, default branch `master`).

---

## Layout

- `src/host/` — Cordis host plugin (`storage/legacy-format.ts`, `storage/layout.ts`, `storage/atomic-store.ts`, `memory/store.ts`, `todo/store.ts`, `review/queue.ts`, `migration/service.ts`, `prompt/snapshot.ts`, `index.ts`).
- `src/client/` — DSH client bundle (`src/client/index.tsx` → `lib/client.js` via `scripts/build-client.mjs`, `conversation.view` id `maestro-memory` order 40, internal Memory/Review/Todos tabs, RPC `/dsh-maestro-memory`).
- `tests/` — Vitest specs (`legacy-format.spec.ts`, `storage.spec.ts`, `atomic-store.spec.ts`, `memory-m2.spec.ts`, `todo-m3.spec.ts`, `migration.spec.ts`, `m4-rehearsal.spec.ts`, etc.).
- `scripts/migrate.mjs` — migration CLI (`--root`, `--apply`/`--dry-run`/`--verify`).

Build outputs in `lib/` (`lib/client.js` via `scripts/build-client.mjs`) are generated — never edit by hand.

---

## Development

```sh
pnpm install
pnpm test                       # full suite (13 files, 199 tests)
pnpm run verify                 # tsc --noEmit host + client (typecheck)
pnpm run build                  # tsc host + tsc client + bundle client.js
pnpm exec vitest run tests/legacy-format.spec.ts tests/storage.spec.ts tests/atomic-store.spec.ts  # unit
pnpm exec vitest run tests/memory-m2.spec.ts tests/todo-m3.spec.ts tests/suggestion-queue.spec.ts tests/rpc-queue.spec.ts  # integration
pnpm exec vitest run tests/migration.spec.ts                                                        # migration
pnpm exec vitest run tests/m4-rehearsal.spec.ts                                                     # rehearsal (fixture profile + rollback)
node scripts/migrate.mjs --root ~/.dsh/memories            # inspect (read-only)
node scripts/migrate.mjs --root /tmp/mem --apply           # backup + adopt
node scripts/migrate.mjs --root /tmp/mem --verify          # verify
```

Run `pnpm test` after host changes, `pnpm run verify` after TypeScript changes, `pnpm run build` after editing `src/client/`. Do not kill/restart the live `dsh web` process serving a session — ask for a convenient restart window.

### CI

`.github/workflows/ci.yml` runs on `push` to `master`/`main` and on every PR:

| Job step | Command | What it proves |
|----------|---------|----------------|
| Install | `pnpm install --frozen-lockfile` | Reproducible deps |
| Build | `pnpm run build` | Host + client compile |
| Typecheck | `pnpm run verify` | `tsc --noEmit` host + client |
| Unit | `vitest run tests/legacy-format.spec.ts tests/storage.spec.ts tests/atomic-store.spec.ts` | Pure delimiter / path / atomic-store |
| Integration | `vitest run tests/memory-m2.spec.ts tests/todo-m3.spec.ts tests/suggestion-queue.spec.ts tests/rpc-queue.spec.ts tests/smoke.spec.ts` | Stores + queue + RPC |
| Migration | `vitest run tests/migration.spec.ts` | inspect/dryRun/run/verify, backup manifest, write-block |
| Rehearsal | `vitest run tests/m4-rehearsal.spec.ts` | Fixture `link:` profile, one-owner proof, copied-schema cutover + rollback, live home untouched |
| Client | `test -f lib/client.js && grep ModuleLoader lib/client.js` | Bundle exists + header |
| Full | `pnpm test` | Entire suite (13 files, 199 tests) |

---

## Security

- Never print, commit, or add fixture values for secrets. Use obviously synthetic values in tests and docs.
- No cloud service, database rewrite, telemetry, or sync in v1; M5 sync (Git-backed) is opt-in and disabled means zero network activity.
- Secrets must never be echoed to the client; new secret-bearing fields need masking + constant-time comparison.
- File permissions: memory files inherit host umask; `SUGGESTIONS.jsonl` is append-only; `write-block.json` is local-only.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `tool "memory" has multiple owners` in `assertSingleOwner` | Both `dsh-memory-evolve` and `dsh-maestro-memory` in `bundles` | Remove the old plugin from the profile; keep exactly one owner per compat tool |
| `profile cordis.patch.yml must not duplicate id maestro-memory` | Profile patch duplicates the package's `cordis.patch.yml` row | Delete the row from the profile patch; the package provides it |
| `verify failed: digest mismatch` / `write-block.json` exists | File changed after backup (hand-edit, concurrent writer) | Inspect `write-block.json` mismatches, then `rollback(root, runId)` or resolve drift and `verify` again |
| `non-canonical` warning | File contains non-`§`-canonical content (hand-edit) | Back up manually, then normalize via a single `replace` edit through the tool (creates canonical serialization) |
| `mismatched todo IDs` after verify | Todo file edited outside the store | Roll back or re-run `inspect` and compare inventories |
| DSH Web UI shows no Memory tab | `lib/client.js` not built or bundle header missing | `pnpm run build` at the checkout, then restart `dsh web` (user-approved window) and hard-refresh the browser |

---

## Documentation

Keep current behavior in `README.md`. Do not add plans, transient investigation logs, or duplicate specifications under `docs/`; capture only durable operator and architecture knowledge. The one exception is Superpowers artifacts: specs under `docs/superpowers/specs/` and plans under `docs/superpowers/plans/` are kept as the design record for each change batch.

---

## References

- `src/host/migration/service.ts` — inspect/dryRun/run/verify/rollback implementation
- `src/host/migration/fixture.ts` — fixture profile + copied-schema helpers for rehearsal
- `tests/m4-rehearsal.spec.ts` — end-to-end rehearsal (profile → backup → verify → reload → write → rollback)
- `scripts/migrate.mjs` — operations CLI (read-only by default, `--apply` to write)
- `.github/workflows/ci.yml` — build / typecheck / unit / integration / migration / client / full
