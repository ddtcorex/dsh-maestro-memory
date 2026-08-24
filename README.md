# dsh-maestro-memory

## Purpose

Durable, user-governed memory and todos for DeepSeek Harness (DSH) that preserves your existing `~/.dsh/memories` files in place.

> **One sentence:** Give the AI in DSH cross-session durable memory and todos — the more you use it, the more it understands you, and switching sessions never loses context.

- **Package:** `@ddtcorex/dsh-maestro-memory` (`cordis.patch.yml` id `maestro-memory`)
- **Plan:** `docs/plans/2026-08-24-dsh-maestro-memory-plan.md` (source-grounded staged replacement, not a 1:1 port)
- **Architecture:** `docs/architecture.md` (M0 boundary audit: tools, systemPrompt, connection.rpc, conversation.view)
- **Changelog:** `docs/CHANGELOG.md`

Reference workflows: [`dsh-maestro-harness/AGENTS.md`](../dsh-maestro-harness/AGENTS.md) and [`dsh-maestro-harness/CLAUDE.md`](../dsh-maestro-harness/CLAUDE.md) — same Superpowers + Git + security conventions apply here.

## Workflow: Superpowers skills are mandatory

Every change to this repository MUST follow the Superpowers skill workflow, in order:

1. **brainstorming** — explore intent, requirements, and design before writing any code; record the outcome in `docs/superpowers/specs/` (`YYYY-MM-DD-<topic>-design.md`).
2. **writing-plans** — turn an approved spec into a task-by-task plan with exact test and implementation sketches in `docs/superpowers/plans/` (`YYYY-MM-DD-<topic>.md`).
3. **executing-plans** — implement task by task with strict TDD: write the failing test first, verify RED, implement, verify GREEN, then commit that task as its own commit before starting the next.

Do not skip ahead to implementation, batch multiple tasks into one commit, or commit while a task's tests are red. Trivial mechanical fixes may go straight to a commit but still need tests when behavior changes.

## Git workflow

- Never commit to `master` directly; batch related work on a feature branch (`feat/...`, `fix/...`). One TDD task = one commit while executing a plan.
- Conventional commit subjects, imperative mood.
- Push the branch and open an MR when the batch is green; rebase instead of merging master into the branch when the base moves.
- `origin` is `git@github.com:ddtcorex/dsh-maestro-memory.git` (private, default branch `master`).

## Layout

- `src/host/` — Cordis host plugin (`storage/legacy-format.ts`, `storage/layout.ts`, `storage/atomic-store.ts`, `memory/store.ts`, `todo/store.ts`, `review/queue.ts`, `migration/service.ts`, `prompt/snapshot.ts`, `rpc/server.ts`, `index.ts` with `maestroMemory`/`maestroMemoryStore`/`maestroTodoStore`/`maestroMemoryMigration` services and `maestro-memory/changed` events).
- `src/client/` — DSH client bundle (`conversation.view` id `maestro-memory` order 40, internal Memory/Review/Todos tabs, package-private RPC `/dsh-maestro-memory`).
- `tests/` — Vitest specs for every host behavior (`legacy-format.spec.ts`, `storage.spec.ts`, `atomic-store.spec.ts`, `memory-m2.spec.ts`, `todo-m3.spec.ts`, `migration.spec.ts`, etc.).
- `docs/architecture.md` — seam table + disk schema + prompt contract; `README.md` is the operator guide.
- `scripts/migrate.mjs` — migration CLI (`--root`, `--dry-run`/`--apply`/`--verify`).

Build outputs in `lib/` (`lib/client.js` via `scripts/build-client.mjs`) are generated — never edit by hand.

## Development

Run from the repository root:

```sh
pnpm install
npm test          # Vitest (9 files, 148 tests)
npm run verify    # tsc --noEmit (host + client)
npm run build     # tsc + client bundle (CJS factory, window.__ModuleLoader__)
node scripts/migrate.mjs --root ~/.dsh/memories            # inspect (read-only)
node scripts/migrate.mjs --root /tmp/mem --apply            # backup + adopt
node scripts/migrate.mjs --root /tmp/mem --verify           # verify
```

Run `npm test` after host changes, `npm run verify` after TypeScript changes, `npm run build` after editing `src/client/`. Do not kill/restart the live `dsh web` process serving a session — use `safe-dsh-web-update` with user-approved timing (see `dsh-maestro-harness/AGENTS.md` lessons).

## What v1 ships

- **Five memory tracks:** `memory` (global) / `user` / `project` (`projects/<sha1(cwd)[:12]>/KEY.md`) / `daily` (`daily/YYYY-MM-DD.md`) / `project log` (`projects/<hash>/MEMORY.md`), plus archives and branch-scoped `KEY` entries with progressive disclosure (`[mem-xxxx]` ids + `expand`).
- **Todos:** four tracks `life / work / project / daily` with stable ids, statuses, due/quadrant, bounded smart views (max 8).
- **Confirmation queue:** model-proposed `key`/`user` writes go through `SUGGESTIONS.jsonl` and require explicit human approve/edit/reject.
- **Bounded snapshot:** `systemPrompt.context` injects `USER + global MEMORY + current-project KEY` (deterministic, capped); daily/project logs are queryable, not injected.
- **Tools (compat):** `memory` and `dtodo` (same names as before). `skill_manage` only if the optional skills module is explicitly enabled.
- **UI:** one `conversation.view` tab `maestro-memory` (order 40) with internal Memory / Review queue / Todos tabs. Uses `ctx.connection.rpc.handle('/dsh-maestro-memory', ...)` — no HTTP.

**Intentionally not in v1:** COI / external CLI dispatch, advisor, notify / `de_channel_send`, local search, prompt library, model registry, bookmarks / mermaid / canvas, DOM hacks. Propose any as a separate plugin later.

## Migration

1. **Preflight** (read-only): inventory, parse, byte report, warnings for malformed JSONL / locks.
2. **Backup**: byte-preserving copy + manifest (`path, bytes, SHA-256, inventory`) under `~/.dsh/memories/.maestro-memory/backups/<utc-run-id>/`.
3. **Adopt**: write `schema.json` + journal only after all required data parses; do not reformat source content.
4. **Verify**: reopen with new stores, compare digest + entry/todo-id inventories; block writes on mismatch.
5. **Cut over**: profile with old plugin removed, new plugin as sole owner; live-read every track before first mutation.
6. **Rollback**: restore files named in the manifest if needed; before any writes rollback is just a profile change.

## Security

- Never print, commit, or add fixture values for secrets. Use obviously synthetic values in tests and docs.
- No cloud service, database rewrite, telemetry, or sync in v1; M5 sync (Git-backed) is opt-in and disabled means zero network activity.
- Secrets must never be echoed to the client; new secret-bearing fields need masking + constant-time comparison.

## Documentation

Keep current behavior in `README.md` and `docs/architecture.md`. Do not add plans, transient investigation logs, or duplicate specifications under `docs/`; capture only durable operator and architecture knowledge. The one exception is Superpowers artifacts: specs under `docs/superpowers/specs/` and plans under `docs/superpowers/plans/` are kept as the design record for each change batch.

---

*English is the primary language for code, docs and UI. No Chinese is carried over.*

*Reference: `dsh-maestro-harness/AGENTS.md` and `dsh-maestro-harness/CLAUDE.md` for full workflow, Git, layout and security conventions.*

---

## References

This project was initially forked from [`csyangwen/dsh-memory-evolve`](https://github.com/csyangwen/dsh-memory-evolve) and has been fully rebranded and rebuilt as `@ddtcorex/dsh-maestro-memory` — EN-only, single-owner core with in-place adoption. No further reference to the original fork appears elsewhere in this codebase.
