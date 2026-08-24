# M5 Git Sync — Design (DRAFT, awaiting approval)

> **Status:** DRAFT — design only. **Do not implement until this document is approved.**
> **Owner:** `dsh-maestro-memory` (`@ddtcorex/dsh-maestro-memory`)
> **Milestone:** M5 — Optional Git sync after 30 stable days (see `docs/plans/2026-08-24-dsh-maestro-memory-plan.md`)
> **Location of this design:** `dsh-maestro-memory/docs/sync-design.md` (this file)
> **Approval gate:** This design must be reviewed and explicitly approved before any `src/host/sync/**` code, RPC endpoint, or UI is added. Approval is per-section (see § Approval checklist). Implementation PRs must link to the approved commit of this file.

This design resolves the six approval dimensions called out in the M5 gate: **privacy, identity, credentials, conflict UX, entry IDs, and todo scope**, and satisfies the three hard invariants: **opt-in, no network when disabled, explicit push, conflict never drops either version**.

---

## 1  Goals / non-goals

### Goals

- Let a user reconcile **project-scoped** durable memory across 2–3 machines with their own Git remote, without weakening local truth.
- Keep local files complete and usable offline — sync is "batch and reconcile", not live replication.
- Reuse the user's existing Git identity and transport; add no cloud service, no telemetry, no database rewrite.

### Non-goals (M5)

- No global `MEMORY.md`/`USER.md` sync in phase 1 (see § Todo scope for sequencing).
- No daily logs, no `SUGGESTIONS.jsonl`, no legacy `advisor`/`coi` state, no skill files.
- No daemon, scheduler, background fetch, or watcher. No auto-push/auto-pull.
- No new HTTP endpoint. All sync moves through Git + the existing package-private RPC `/dsh-maestro-memory`.
- No change to the live `deepseek-harness` source. No `~/.dsh/memories` location migration.

---

## 2  Privacy — opt-in and data boundary

### 2.1  Opt-in, per project, off by default

Sync is **disabled by default for every project hash**. Enabling is an explicit, per-`cwd` action. There is no global "enable sync" flag that silently opts in all projects.

Enabling requires **two** explicit steps (both recorded):

1. User runs the sync tool/RPC `sync.enable` with `{ cwd, remoteUrl, branch? }` — or the Memory UI's Sync tab "Enable sync for this project".
2. User confirms the privacy notice in that UI/RPC (see §2.3). A headless `sync.enable` without confirmation is rejected.

Disabling is `sync.disable { cwd }` — removes the project's sync config and deletes any cached remote refs under `.maestro-memory/sync/<hash>/`. It does not delete local memory files.

### 2.2  No network when disabled — implementation guarantee

When a project hash has no sync config (`<root>/.maestro-memory/sync/<hash>/config.json` absent or `enabled !== true`):

- The plugin imports **no Git transport code** on the hot path. The `sync/*` module is lazy-loaded only inside `sync.enable/push/pull/status` handlers; the default boot path (`src/host/index.ts` apply) registers the `sync.*` RPC endpoints but the handlers return `disabled` without spawning a child process or importing `simple-git`/`isomorphic-git`.
- No child process (`git fetch/push/clone`) is spawned.
- No DNS, no TCP, no file read of `~/.ssh` beyond what Git itself would do when explicitly invoked — and it is not invoked.
- No periodic timer or file watcher triggers Git.

Verification: a disabled-project `sync.status` call returns `{ enabled:false, lastSync:null }` without network. Integration tests assert that the handler's Git adapter is not constructed when `enabled===false` (mock the spawn boundary and assert zero calls).

### 2.3  What leaves the machine & what never does

**May leave the machine only after explicit `sync.push` (see §7) and only for enabled projects:**

- The four project-scoped files listed in §3 (KEY, MEMORY, KEY-archive, TODOS) serialized **exactly as stored** (same `§` delimiter, same entry headers). No in-memory augmentation is pushed.
- The Git commit author/committer identity (see §4) and a generated sync commit message. No model prompts, no conversation transcripts, no daily logs, no global memory unless the user later opts that track in (§8).

**Never synced, even when enabled:**

- `USER.md`, `daily/*.md`, `SUGGESTIONS.jsonl`, `TODOS-life.md`/`TODOS-work.md` (phase 1), `.maestro-memory/backups/**`, OS keychain entries, credential helper tokens.

The UI's enable dialog states verbatim:

> "Sync will push this project's KEY, MEMORY, archive, and project todos to the Git remote you specify, on a dedicated branch. Nothing is sent until you press Push. Disable at any time — local files remain untouched."

### 2.4  Private remotes only

The remote URL is user-supplied and may be any Git remote the user already trusts (`git@github.com:you/private.git`, `ssh://`, `https://`, `file://` for air-gapped tests). The plugin does not create a remote, does not default to a public host, and does not log the URL at `info` level (only at `debug` with URL redacted to `***`). The config stores the remote URL verbatim but the `sync.status` RPC redacts it to `remote:***` unless the caller passes `reveal:true` (UI toggle).

### 2.5  Approval dimension — privacy

- [ ] **Privacy approved:** reviewer confirms §2.1–2.4 satisfies the privacy bar (per-project opt-in, disabled=zero network, explicit push boundary, private remote only, never syncs global/daily/queue).

---

## 3  Repository & branch layout

### 3.1  Dedicated branch, per project

Each enabled project gets one remote branch that carries **only** that project's four files, not the whole `~/.dsh/memories` tree. This avoids polluting the project's code history.

- Remote branch naming: `maestro-memory/<hash>` where `<hash> = sha1(cwd)[:12]` — the same hash used for `projects/<hash>/` on disk (§ `storage/layout.ts:projectHash`). Using the same value ties the disk and remote identities without a new mapping table.
- Local cache (not a second copy of memory): `<root>/.maestro-memory/sync/<hash>/` containing `{ config.json, FETCH_HEAD, lastSync.json, conflicts/ }`. The authoritative truth remains `projects/<hash>/KEY.md` etc.; the cache never shadows it.
- Branch history: linear per-file entry commits plus merge commits for conflicts (see §6). The branch is created with `git checkout --orphan` on first push so it shares no history with `main`.

### 3.2  File layout on the branch

At the branch root (relative to the branch, not to the memories root):

```
KEY.md
MEMORY.md
KEY-archive.md
TODOS.md
.meta.json   # { hash, cwd, version:1, pushedAt, entryIds, todoIds, schemaVersion }
```

`.meta.json` is machine-generated at push time for diagnostics; it is not hand-edited. Pushing stores the files byte-identical to their on-disk canonical form (`serializeEntries` / todo header). Fetching reads them back and compares `sha256` before any merge.

### 3.3  No code pollution

The branch contains only the four data files plus `.meta.json`. It never contains source code. The project's main code repo can be the same remote (different branch) or a different remote — both are supported because the sync remote URL is independent of the project's `origin`.

---

## 4  Identity

### 4.1  Git author/committer

Sync commits reuse the user's existing Git identity, in priority order:

1. `config.user.name` / `config.user.email` from `sync.config.overrideIdentity` if the user set it (stored per-hash in `config.json`).
2. Otherwise `git config user.name` / `user.email` from the environment where `git` is spawned (same as `git commit` would use).
3. Fallback to `maestro-memory <hash>@local` only if Git has no identity — and the `sync.status` UI surfaces "Git identity not set" as a warning, not a silent default.

No new identity is invented per machine. The commit message identifies the machine for traceability without requiring a new identity namespace:

```
maestro-memory sync: <hash> <shortSha>  —  <cwd basename>  —  <ISO8601>
Machine: <os.hostname()>  Key: <entryCount>  Todos: <todoCount>
```

### 4.2  Machine as metadata, not as identity

A stable `machineId = sha1(hostname + homedir)[:8]` is stored in `.maestro-memory/sync/machine.json` (local only, never pushed) and included in `.meta.json.pushedBy.machineId` for conflict UX ("edited on lap-01 vs desk-02"). It is not used for auth; it is diagnostic.

### 4.3  Approval dimension — identity

- [ ] **Identity approved:** reviewer confirms §4.1–4.2 — no new external identity provider, Git identity reuse with explicit override, machineId is local-only diagnostic.

---

## 5  Credentials

### 5.1  Reuse, never store

The plugin **does not store, mint, or log credentials**. Every `git fetch/push` is spawned as:

```
git -c credential.helper=<user's helper> fetch <remote> <branch>
git -c credential.helper=<user's helper> push <remote> <branch>
```

- For SSH remotes (`git@...`, `ssh://`), authentication uses the user's `ssh-agent` / `~/.ssh/config` as `git` would normally. The plugin never reads `~/.ssh/id_*`.
- For HTTPS remotes, Git's credential helper (`osxkeychain`, `manager-core`, `store`, or `gh auth`) supplies the token. The plugin passes through `GIT_ASKPASS` / `GITHUB_TOKEN` env only if the parent process already has them — it never prompts for a PAT nor writes one to `config.json`.
- `GIT_TERMINAL_PROMPT=0` is set for all spawned Git so a headless session never hangs on a password prompt; failure surfaces as `auth failed — configure git credential helper for <remote>`.

### 5.2  No secret logging, no config echo

- Spawned command lines are logged at `debug` with URL redacted (`git push *** maestro-memory/<hash>`).
- `config.json` stores only `{ enabled, remoteUrl, branch, overrideIdentity? }`. It never stores tokens, SSH keys, or helper state.
- The RPC `sync.status` never returns credentials; `sync.config` redacts `remoteUrl` unless `reveal:true`.

### 5.3  Approval dimension — credentials

- [ ] **Credentials approved:** reviewer confirms §5.1–5.2 — no credential storage, SSH-agent + credential-helper pass-through only, no secret logging, `GIT_TERMINAL_PROMPT=0`.

---

## 6  Entry IDs, merge model, and the "never drops" invariant

### 6.1  Entry identity = `[id:8hex]` (memory) / `[id:8hex]` (todos)

- **Memory entries:** every `KEY.md`/`MEMORY.md` entry that participates in sync carries a `[id:xxxxxxxx]` prefix (8 lowercase hex). This is already generated for `key` entries with a `summary` (§ `memory/store.ts:ensureId`) and is now **required for all synced project entries**. At first `sync.enable` (adoption), any synced project entry missing an id is assigned one atomically (local write, same `withLockSync`/`writeAtomicSync` guarantees) and backed up via the existing `.bak` mechanism. The id is stable thereafter — `replace` preserves it (§ `memory/store.ts:384`).
- **Todo entries:** already carry `[id:xxxxxxxx]` per `legacy-format.ts:stampTodoLine`. Sync reuses that id unchanged.

IDs are compared case-insensitively and after `stripEntryId` for duplicate detection, but **merge is by exact id**.

### 6.2  Duplicate detection (local)

Before merge, `isDuplicate(entries, candidate)` (§ `atomic-store.ts:110`) is used: two entries with the same body but different ids are still duplicates after `stripEntryId`. This prevents a re-add on one machine from creating a phantom duplicate after sync.

### 6.3  Merge rule — union, never last-writer-wins

Sync merge is **set union by id**, not 3-way text merge. For each track independently:

```
localIds  = { id | entry in local  file }
remoteIds = { id | entry in remote branch file }
baseIds   = { id | entry in lastSync .meta.json.entryIds }  // or ∅ on first sync
```

- `addedLocal  = localIds  - baseIds`
- `addedRemote = remoteIds - baseIds`
- `deletedLocal  = baseIds - localIds`  (entry removed locally since last sync)
- `deletedRemote = baseIds - remoteIds`
- `modifiedBoth  = { id | contentHash(local[id]) != contentHash(remote[id]) }`  (same id, different body)

Result written to disk:

- Every id in `addedLocal ∪ addedRemote` is present (union).
- Every id in `deletedLocal ∪ deletedRemote` is absent **only if** the other side also deleted it; if one side deleted and the other modified, that id becomes a **conflict** (see §6.4) — the delete is not applied.
- `modifiedBoth` ids are **not** auto-resolved — each becomes a conflict.

This rule guarantees the invariant: **no entry present on either side is silently dropped**. An entry can disappear only if both sides deleted it, or the user explicitly resolves a conflict by choosing "keep local" / "keep remote" / "keep both" (explicit delete).

### 6.4  Conflict — never drops either version

When `modifiedBoth` is non-empty or a delete/modify collision is detected:

1. The local file is **not overwritten**. Instead, the fetch writes the remote version to `<root>/.maestro-memory/sync/<hash>/conflicts/<track>/<id>.remote.md` and the local version stays in place.
2. A conflict record is appended to `<root>/.maestro-memory/sync/<hash>/conflicts.jsonl`:
   ```json
   {"id":"a1b2c3d4","track":"KEY","at":"2026-08-24T...Z","localSha":"...","remoteSha":"...","localEntry":"...","remoteEntry":"...","resolved":false}
   ```
3. A Review-queue entry is created (via `SuggestionQueue`) of kind `sync-conflict` so the existing human-gated queue surfaces it:
   ```json
   {"target":"sync-conflict","content":"KEY a1b2c3d4 conflict: local vs remote — choose","reason":"sync conflict never drops either version","meta":{"hash":"<hash>","track":"KEY","id":"a1b2c3d4"}}
   ```
4. The project file gains a **non-destructive conflict marker file** `projects/<hash>/KEY.md.conflict.<id>` containing both versions separated by `<<<<<<< local` / `=======` / `>>>>>>> remote`, for `git diff` users — but the canonical `KEY.md` retains the local version until resolved.

Resolution is **only** via explicit user action (`sync.resolve { hash, id, choice: 'local'|'remote'|'both' }` or Review UI buttons "Keep local" / "Keep remote" / "Keep both"):

- `local`  → keep local entry, discard remote (recorded as `resolved:local`).
- `remote` → replace local entry with remote entry (atomic write, preserves id).
- `both`   → keep both entries as two distinct ids (remote entry is re-stamped with a new id so both survive; original remote id is aliased in `.meta.json.aliases`).

After any resolution, a new sync commit is created and the conflict record is marked `resolved:true`. There is no "accept theirs silently" path.

### 6.5  Archive handling

`KEY-archive.md` is append-only in the merge: archived entries are unioned by id as well. `archive` is an explicit user action (§ `memory/store.ts:430`) and never auto-archives a conflict.

### 6.6  Approval dimension — entry IDs & conflict

- [ ] **Entry IDs approved:** reviewer confirms §6.1–6.2 — 8-hex stable ids, adoption on enable, duplicate detection via `stripEntryId`.
- [ ] **Conflict approved:** reviewer confirms §6.3–6.5 — union merge, delete/modify → conflict, explicit `local|remote|both` only, never drops either version (covers the "conflict never drops either version" hard invariant).

---

## 7  Operation model — explicit push, no polling

All network moves are explicit. There is **no** background fetch, no interval, no file watcher, no `post-commit` hook.

| Operation | Trigger | Network | Effect |
|---|---|---|---|
| `sync.enable` | User click / `sync.enable` RPC | None (local config + id adoption only) | Writes `config.json`, assigns missing ids, creates orphan branch locally — no fetch/push yet. |
| `sync.status` | UI open / RPC | None when `enabled:false`; when enabled, **no fetch by default** — shows `lastSync` + local vs last-synced diff. Pass `{ fetch:true }` to do a fetch. | Read-only unless `fetch:true`. |
| `sync.fetch` | User "Check remote" button / RPC | `git fetch` | Reads remote branch, compares to local, reports `ahead/behind/conflicts` — does not mutate local memory files. |
| `sync.push` | User "Push" button / RPC | `git fetch` (to check), then `git push` | Fetches first; if `modifiedBoth` non-empty, push is **blocked** until conflicts are resolved. Otherwise writes `.meta.json`, commits, pushes. Requires confirmation when `force` would overwrite. |
| `sync.pull` | User "Pull" button / RPC | `git fetch` then local merge | Fetches + applies union merge (§6.3). Conflicts become records — never auto-applied. |
| `sync.disable` | User action | None | Removes `config.json`, clears `.maestro-memory/sync/<hash>/`. |

Every `fetch`/`push`/`pull` requires `enabled===true`; otherwise the handler returns `{ ok:false, error:'sync disabled for this project' }` without spawning Git.

---

## 8  Todo scope — what syncs and what does not

### Phase 1 (this design, M5)

Only **project-scoped** files sync:

- `projects/<hash>/KEY.md`
- `projects/<hash>/MEMORY.md`
- `projects/<hash>/KEY-archive.md`
- `projects/<hash>/TODOS.md` (project todos — the `project` track of `dtodo`)

This matches the existing project-hash isolation (§ `storage/layout.ts:projectHash`) and the plan's "rebuild only project KEY/MEMORY/archive/todos first".

`TODOS.md` todos merge by the same id-union rule as memory (§6.3): union by `[id:8hex]`, same conflict UX (conflict record + Review queue entry). Todo smart-view ordering is not synced — only the file.

### Explicitly out of scope in phase 1

- `TODOS-life.md`, `TODOS-work.md` (global life/work) — would require a global remote branch and a different privacy decision; deferred.
- `daily/*.todo.md` — daily todos are ephemeral + expiry-sensitive (`past+expired` rules in `todo/store.ts`); cross-machine expiry would diverge; keep local.
- `SUGGESTIONS.jsonl` — the confirmation queue is local to one machine's human approvals; syncing it would auto-approve another machine's suggestions.
- `USER.md` / `MEMORY.md` (global) — global memory is cross-project and may contain user-identifying notes; syncing it needs a separate privacy review; optional phase 2.

### Phase 2 (only after phase 1 is stable and separately approved)

Optional, still per-project opt-in, but for a **global** branch `maestro-memory/global` carrying `MEMORY.md`/`USER.md`/`TODOS-life.md`/`TODOS-work.md`. This requires a second `sync.enableGlobal` with its own privacy notice and is not part of this approval.

### Approval dimension — todo scope

- [ ] **Todo scope approved:** reviewer confirms §8 — phase 1 syncs only `projects/<hash>/TODOS.md`; `life`/`work`/`daily`/global remain local; global sync deferred to a separately approved phase 2.

---

## 9  Conflict UX — host, RPC, and client

### Host / RPC

New package-private RPC channel `/dsh-maestro-memory` endpoints (namespaced, no HTTP):

- `sync.enable  { cwd, remoteUrl, branch? } -> { ok, hash }`  (requires privacy confirm)
- `sync.disable { cwd } -> { ok }`
- `sync.status  { cwd, fetch?:boolean, reveal?:boolean } -> { enabled, branch, lastSync, localAhead, remoteAhead, conflicts[], remoteRedacted }`
- `sync.fetch   { cwd } -> { ok, status, conflicts[] }`  (fetch + compare, no local write)
- `sync.push    { cwd, message?:string } -> { ok, pushed, conflicts[] }`  (blocked when conflicts exist)
- `sync.pull    { cwd } -> { ok, merged, conflicts[] }`  (applies union merge)
- `sync.resolve { cwd, id, choice:'local'|'remote'|'both' } -> { ok }`
- `sync.listConflicts { cwd } -> { conflicts }`

Every endpoint validates `cwd` and `hash`, checks `enabled`, and registers via `ctx.effect` with disposers.

### Client (single `conversation.view` tab)

Extend the existing `Memory` tab (id `maestro-memory`, order 40) with a **Sync** sub-tab (no new slot):

- Header: project hash, remote (redacted), branch, Last sync time, Enabled/Disabled badge.
- Actions: Enable / Disable / Check remote / Pull / Push / Reveal remote. Each destructive action has a confirmation dialog.
- Status panel: "Local-only (no network)" when disabled; "X ahead / Y behind / Z conflicts" when enabled.
- Conflict list: each conflict shows local vs remote entry side-by-side with buttons **Keep local / Keep remote / Keep both** (maps to `sync.resolve`). Conflicts also appear in the existing Review queue (badge count) for users who live there.
- No mutation observer, no portal, no DOM hack; state refreshes after mutation and on `connection/reset` via `ctx.connection.rpc.call`.

No `dtodo` or `memory` tool surface change is required for sync; sync is a separate `sync.*` RPC namespace so model tools cannot trigger network.

---

## 10  Security & isolation details

- Spawned `git` inherits only the minimal env (`PATH`, `HOME`, `SSH_AUTH_SOCK`, `GIT_*` already set). No `NODE_OPTIONS` passthrough.
- Locking: sync operations take the same per-directory lock (`withLockSync` on `projects/<hash>/` and on `.maestro-memory/sync/<hash>/`) so a concurrent `memory.add` and `sync.pull` cannot interleave a partial write. Writes remain atomic via `writeAtomicSync` + reread validation.
- Large files: before push, the branch size is checked (`du` on the four files); if any file exceeds 1 MiB, `sync.push` warns and requires a second confirmation (memory files are small; a 1 MiB guard catches accidental bulk pastes).
- `.maestro-memory/sync/**` is excluded from backup manifests (`scanAllForBackup` already skips `.maestro-memory`) and from migration `inspect` file lists — sync cache is ephemeral.
- No telemetry, no analytics, no error reporting to a third party. Push/fetch errors are returned to the caller and logged at `warn` with redacted URLs.

---

## 11  Failure modes & recovery

| Failure | Behavior | Recovery |
|---|---|---|
| Remote not configured / auth failed | `sync.fetch/push` returns `{ ok:false, error:'auth failed…' }`, no local mutation. `GIT_TERMINAL_PROMPT=0` prevents hang. | User fixes credential helper, retries. |
| Network offline | Same as auth — fetch fails, local files untouched. | Retry when online. |
| Non-fast-forward push (remote moved) | `push` fetches first; if diverged, reports `behind` + `conflicts` and blocks push. | `sync.pull` → resolve conflicts → `sync.push`. No `force` unless user passes `force:true` with confirmation. |
| Corrupt remote branch (non-canonical file) | Fetch succeeds but merge validates canonical form (`isCanonical`); on drift, reports `remote drift` conflict and does not apply. | Resolver keeps local vs remote; remote can be fixed by pushing a canonical version. |
| Missing ids on remote (pre-M5 entries) | Remote entries without ids are assigned new ids on pull, recorded in `aliases` of `.meta.json`, and pushed back on next push. | No data loss; ids converge after one cycle. |
| Local write-block (`write-block.json` present) | Sync operations that would write local files check `isWriteBlocked` and refuse with `write blocked: migration verify mismatch`. | Run `verify` / `rollback` per migration docs first. |

---

## 12  Alternatives considered

| Alternative | Why not (for M5) |
|---|---|
| Sync the entire `~/.dsh/memories` tree on one branch | Mixes private global memory with project memory; violates privacy + would sync daily/queue across machines. Rejected. |
| Use a separate sync service / cloud | Adds vendor, telemetry, and credential storage; contradicts "no cloud service" non-goal. Rejected. |
| Auto-sync on `memory.add` / file watcher | Violates "explicit push" and "no network when disabled" invariants; risks push storms and silent conflicts. Rejected. |
| 3-way text merge (`git merge-file`) on §-delimited text | Would interleave delimiter corruption; id-based set union is safer for entry-granular memory. Rejected for M5. |
| Content-hash as identity (no ids) | Hash changes on every edit, so an edit looks like delete+add; id is stable across edits. Rejected. |

Recommendation remains §3–§9.

---

## 13  Testing plan (for implementation PRs — not this doc)

- Unit: `parseEntries`/`isDuplicate`/`stripEntryId` for memory ids; `parseTodoEntry` for todo ids; `projectHash` stability.
- Unit: merge logic (union, delete/delete vs delete/modify, modifiedBoth) with fixture local/remote/base sets.
- Integration (fixture `file://` remote, no network): `enable` assigns ids; `fetch` reports ahead/behind; `push` creates branch; `pull` merges union; conflict creates `conflicts.jsonl` + Review queue entry; `resolve local|remote|both` clears it; second `push` succeeds. All under `withLockSync`.
- Integration (mocked spawn): when `enabled:false`, spawn boundary is never called (zero network).
- Integration: disabled `status` returns redacted remote; `push` blocked when conflicts exist; `disable` clears config.
- Manual: two-clone `file://` rehearsal (machine A push → machine B pull → both edit same id → fetch shows conflict → resolve both).

No test touches the live `~/.dsh/memories` (fixture roots under `/tmp`).

---

## 14  Approval checklist — the six dimensions plus the three invariants

Each box must be checked by a reviewer before M5 implementation starts. Checking the box means the reviewer approves that section as the spec for the first M5 PR.

- [ ] **Privacy ( §2 )** — per-project opt-in, disabled = zero network, explicit privacy notice, private remote only, never syncs global/daily/queue.
- [ ] **Identity ( §4 )** — Git identity reuse, optional override, diagnostic machineId never pushed as identity.
- [ ] **Credentials ( §5 )** — no storage, SSH-agent + credential-helper pass-through, `GIT_TERMINAL_PROMPT=0`, no secret logging.
- [ ] **Conflict UX ( §6.4 + §9 )** — conflict never drops either version; fetch does not mutate; marker files + `conflicts.jsonl` + Review-queue entry; explicit `local|remote|both` via RPC/UI.
- [ ] **Entry IDs ( §6.1–6.3 )** — 8-hex stable ids, adoption on enable, union merge by id, `stripEntryId` duplicate detection, `both` re-stamps with alias.
- [ ] **Todo scope ( §8 )** — phase 1: `projects/<hash>/TODOS.md` only; `life`/`work`/`daily`/global remain local; global phase 2 requires separate approval.

**Three hard invariants (must remain true in implementation):**

- [ ] **Opt-in** — default disabled for every hash.
- [ ] **No network when disabled** — disabled path spawns no Git, lazy-loads no transport.
- [ ] **Explicit push** — no background fetch/push/watcher/scheduler; every network move has a user action.
- [ ] **Conflict never drops either version** — delete/modify and modify/modify both become conflicts; resolution requires explicit choice.

---

## 15  Open questions (answer before implementation PR 1)

1. Branch naming: `maestro-memory/<hash>` vs `maestro-memory/projects/<hash>` — leaning to the shorter; confirm no collision with user branches (check `git ls-remote` on enable).
2. First-push orphan: confirm `git checkout --orphan` + `git rm -rf .` sequence for a single-branch-per-hash repo.
3. UI wording for the privacy notice — English-first; any Vietnamese mirroring needed?
4. Whether `sync.enable` should also `git ls-remote` to validate auth before writing `config.json` (proposal: yes, with `GIT_TERMINAL_PROMPT=0` and a 5 s timeout, but not required for offline-first `file://` tests).

---

*End of M5 Sync design — DRAFT. No code should be written against it until the boxes in §14 are checked and this file is committed as approved.*
