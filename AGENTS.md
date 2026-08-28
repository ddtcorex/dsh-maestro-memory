# AGENTS.md — dsh-maestro-memory

> `CLAUDE.md` at the repo root is a symlink to `AGENTS.md`. Claude Code follows the same rule set as Codex CLI. Only edit `AGENTS.md` — never edit `CLAUDE.md` directly or replace the symlink with a copy.

## Purpose

Durable memory + todos + bounded system-prompt snapshot plugin for the DeepSeek Harness (DSH). One Cordis row (`id: maestro-memory`) with a host half (Node) and a client half (browser Memory view / sync UI).

Names by boundary: npm package = `@ddtcorex/dsh-maestro-memory`; Cordis patch row id = `maestro-memory`.

Part of the Maestro Harness suite (installed as a DSH plugin). Originally forked from `csyangwen/dsh-memory-evolve`; maintained standalone at `ddtcorex/dsh-maestro-memory` since 2026-08-26 (the `upstream` remote has been removed).

## Layout

- `src/host/index.ts` — host `apply()`: registers the `memory` + `memory_suggest` + `dtodo` tools, the `memory:snapshot` systemPrompt context (order `snapshotOrder ?? 500`), and the `/dsh-maestro-memory` RPC channel (loopback authority).
- `src/host/memory/store.ts` — `MaestroMemoryStore` over five tracks (`memory`/`user`/`project`/`key`/`daily`): add/list/replace/remove/archive/expand + `snapshot`.
- `src/host/todo/store.ts` — `TodoStore` (four tracks, quadrant/due/status, smart view).
- `src/host/prompt/snapshot.ts` — `renderSnapshot(store, ctx)`: bounded snapshot (USER + MEMORY + KEY only; `daily`/`project` excluded) with session header + end-of-turn discipline note.
- `src/host/storage/` — `layout.ts` (paths), `atomic-store.ts` (append/read/write with directory lock), `legacy-format.ts` (entry parsing, summary/branch tags).
- `src/host/sync/` — git-backed memory sync (`SyncService`, `RealGitAdapter`, merge/conflict resolution).
- `src/host/migration/` — 6-phase staged replacement (`inspect`/`backup`/`adopt`/`verify`, read-only by default, `--apply` to mutate).
- `src/host/review/queue.ts` — gated `memory_suggest` confirmation queue.
- `src/host/skills-browser.ts` — read-only skills list (M6).
- `src/client/index.tsx` — browser half (Memory view, Sync tab, Review queue UI).
- `lib/` — committed build output. Generated; do not hand-edit.
- `scripts/build-client.mjs` — client bundle builder.
- `tests/*.spec.ts` — vitest suites (14 files, 211 tests).

## Development

Run from the repository root:

```sh
pnpm verify   # tsc --noEmit host + client
pnpm test     # vitest run
pnpm build    # tsc host + client && node scripts/build-client.mjs  -> lib/
```

`pnpm build` is the required gate after any source change; `lib/` is committed, so a change is incomplete until the build refreshes it.

## Git workflow

- Default branch `master`. No direct commits to `master` — use `feat/<topic>` / `fix/<topic>` and a PR against `ddtcorex/dsh-maestro-memory`.
- Conventional commits, imperative mood (`feat:`, `fix:`, `docs:`, `chore:`).
- One TDD task = one commit; never commit while `pnpm verify` is red.
- When the base moves, rebase the feature branch onto `origin/master` (single-origin workflow; there is no upstream remote).

## Conventions

- **Five tracks**: `memory` (global), `user`, `project` (per-cwd log), `key` (per-cwd long-term), `daily` (per-day file). `project`/`key` require `cwd`.
- **Entry grammar** lives in `legacy-format.ts` (delimiter `\n§\n`, `[id:xxxxxxxx]`, `[summary:...]`, `[branch:...]`). ID-stripped dedupe on `add`.
- **Atomic writes only** — route mutations through `atomic-store.ts` (`withLockSync` for read-modify-write; `appendEntryAtomicSync` for appends). Never `readFileSync`+`writeFileSync` a memory file directly.
- **Bounded snapshot** — `renderSnapshot` injects USER + MEMORY + KEY (branch-filtered) only; `daily`/`project` are query-only, never auto-injected. Preserve the end-of-turn discipline note verbatim.
- **Gated writes** — the model writes via `memory_suggest` (queue → user approve) and `dtodo`; `memory add` is the explicit path. RPC endpoints are `loopback` authority.
- Keep the host/client split; client bundle injects `['@deepseek-ai/dsh-client-runtime','@deepseek-ai/dsh-client-ui-slots']`.
- Strict TDD with vitest; every deterministic operation is a tool, LLM is reasoning-only.

## Validation

- `pnpm verify` + `pnpm test` green before any success claim.
- Snapshot regression: "keep project/daily logs out of snapshot" must stay green.
- After touching the client bundle: `pnpm build` then verify on live DSH Web (`:3080`), not just curl/grep.

## See Also

- Local architecture audit: `docs/architecture.md`
- The full spec (`dsh-maestro-memory.md`) and sync design live in the Maestro Harness coordination workspace.

- **Always request approval before merge or release:** never merge a PR/MR or publish a release (`git tag`/`pnpm publish`/`gh release`) without an explicit human approval — request review (`gh pr ready` / `gh pr request-review` / ask in chat) and wait for `APPROVED`.
