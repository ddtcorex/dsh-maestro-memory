# dsh-maestro-memory — Durable Memory & Todos for DeepSeek Harness

> **One sentence:** Give the AI in DSH cross-session durable memory and todos — **the more you use it, the more it understands you, and switching sessions never loses context.**

This is the Maestro single-owner replacement for `dsh-memory-evolve`. It preserves your existing `~/.dsh/memories` files in place (in-place adoption, SHA-256 verified backup and rollback) and keeps only the durable core: **layered memory + todos + confirmation queue + bounded snapshot injection**. Everything else (COI, advisor, notify, canvas, etc.) is intentionally out of scope for v1 and will live as separate optional plugins if needed.

- **Package:** `@ddtcorex/dsh-maestro-memory`
- **Plan & architecture:** `docs/plans/2026-08-24-dsh-maestro-memory-plan.md` (source-grounded rebuild; staged replacement, not a 1:1 port)
- **Related docs:** [Changelog](docs/CHANGELOG.en.md) · [Changelog (zh legacy)](docs/CHANGELOG.md)

---

## Quick start (install)

The package ships `cordis.patch.yml` (`dsh.bundle.patch`), so `dsh plugin add` registers the host side automatically — no manual patch needed.

```sh
# 1. Add to the web profile (local link during development)
dsh plugin --profile web add link:/home/kai/Work/htdocs/maestro-harness/dsh-maestro-memory

# 2. Restart dsh web when convenient (skill provider needs a restart to load;
#    never kill the live dsh web process serving a session — ask for a window,
#    see safe-dsh-web-update).
```

> Do NOT manually `insert` this plugin into `~/.dsh/profiles/web/cordis.patch.yml` — the bundle patch already registers it; a duplicate id crashes the loader.

**Changing config** (e.g. per-turn review): override by id in the profile patch (top-level, not insert):

```yaml
- id: maestro-memory
  config:
    reviewEnabled: true
    reviewInterval: 10
```

To temporarily disable: `disabled: true` on the same id. To uninstall: `dsh plugin --profile web remove @ddtcorex/dsh-maestro-memory`.

---

## What v1 ships

- **Five memory tracks:** `memory` (global) / `user` / `project` (`projects/<sha1(cwd)[:12]>/KEY.md`) / `daily` (`daily/YYYY-MM-DD.md`) / `project log` (`projects/<hash>/MEMORY.md`), plus archives and branch-scoped `KEY` entries with progressive disclosure (`[mem-xxxx]` ids + `expand`).
- **Todos:** four tracks `life / work / project / daily` with stable ids, statuses, due/quadrant, bounded smart views.
- **Confirmation queue:** model-proposed `key`/`user` writes go through `SUGGESTIONS.jsonl` and require explicit human approve/edit/reject.
- **Bounded snapshot:** `systemPrompt.context` injects `USER + global MEMORY + current-project KEY` (deterministic, capped); daily/project logs are queryable, not injected. Includes session-id header and end-of-turn write discipline prompt.
- **Tools (compat):** `memory` and `dtodo` (same names as before). `skill_manage` only if the optional skills module is explicitly enabled. Optional compat names: `memory_suggest`, `memory_review_status`, `/memory_review`.
- **UI:** one `conversation.view` tab `maestro-memory` (order 40) with internal Memory / Review queue / Todos tabs. Uses package-private RPC `ctx.connection.rpc.handle('/dsh-maestro-memory', ...)` — no HTTP.

**Intentionally not in v1:** COI / external CLI dispatch, advisor, notify / `de_channel_send` / `de_notify`, local search, prompt library, model registry, bookmarks / mermaid / canvas, DOM hacks. Propose any of those as a separate plugin later.

---

## Migration from dsh-memory-evolve

1. **Preflight** (read-only): inventory, parse, byte report, warnings for malformed JSONL / locks.
2. **Backup**: byte-preserving copy + manifest (`path, bytes, SHA-256, inventory`) under `~/.dsh/memories/.maestro-memory/backups/<utc-run-id>/`.
3. **Adopt**: write `schema.json` + journal only after all required data parses; do not reformat source content.
4. **Verify**: reopen with new stores, compare digest + entry/todo-id inventories; block writes on mismatch.
5. **Cut over**: profile with old plugin removed, new plugin as sole owner; live-read every track before first mutation.
6. **Rollback**: restore files named in the manifest if needed; before any writes rollback is just a profile change.

See the plan's *Migration and rollback* section for the full table.

---

## Development

```sh
pnpm install
npm test          # Vitest (new core) — legacy: node --test 'tests/*.test.js'
npm run build     # tsc + client bundle (CJS factory via esbuild, window.__ModuleLoader__)
```

Every PR: failing test → minimal implementation → focused tests → full build/typecheck → reviewable commit. M0 validates live DSH seams (`tools`, `systemPrompt`, `connection.rpc`, `conversation.view`) before any implementation.

---

## Three principles (kept from the original)

1. **AI proposes, you confirm:** every write that changes AI behavior goes through the queue.
2. **Don't reinvent the wheel:** don't touch what DSH core already does.
3. **Inside vs outside, complementary:** internal sessions for context-heavy work, external agents for heavy one-shots; memory chains them.

*English is the primary language for code, docs and UI. No Chinese is carried over by default.*
