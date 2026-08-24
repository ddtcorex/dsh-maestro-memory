# Changelog

All notable changes to this project are documented in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-24

Initial release of `@ddtcorex/dsh-maestro-memory`, a from-scratch TypeScript
rebrand of `dsh-memory-evolve` that runs as a DeepSeek Harness plugin and
preserves the existing `~/.dsh/memories` files in place.

### Added

- **Memory tool (`memory`)** across five durable tracks: global `memory`,
  `user`, per-project `key` / `project`, and date-stamped `daily`. Entries are
  stored verbatim in the same `§`-delimited layout as the legacy files; archived
  entries split to `*-archive.md`.
- **Todos tool (`dtodo`)** across `life` / `work` / `project` / `daily` with a
  bounded 8-item smart view, category and quadrant fields, and a per-day
  `YYYY-MM-DD.todo.md` file.
- **`memory_suggest` tool** (confirmation-gated): proposals are queued in
  `SUGGESTIONS.jsonl` and only written to memory after explicit user approval.
- **`memory:snapshot` system-prompt context** at configurable `snapshotOrder`
  (default 500): injects session-id header, global + current-project `KEY`,
  the end-of-turn daily/project write discipline, and the todos reminder.
- **In-place adoption migration** (`scripts/migrate.mjs`, RPC
  `migration.*`): read-only `inspect` → `--apply` backs up a SHA-256 manifest
  and adopts `schema.json`; `--verify` compares digests and blocks writes on
  drift via `write-block.json`; `rollback(root, runId)` restores byte-identical
  files.
- **Confirmation-gated review queue** (`queue.*`): review decisions are queued
  and applied via an explicit, user-facing decision flow; the review tool is
  registered dynamically and only when the runtime switch is on.
- **Read-first skills browser** (`skills.list`, host `skills-browser`):
  metadata/origin-only listing of the default maestro-skills checkout, no
  mutation and no body content.
- **Web UI** in a single `conversation.view` slot (`id: maestro-memory`,
  order 40) with Memory / Review / Todos / Skills tabs, DSH-themed controls, and
  package-private RPC over `/dsh-maestro-memory`.
- **M5 Git sync** (opt-in): project-scoped `sync.enable/disable/status/fetch/
  push/pull/resolve/listConflicts`. Disabled means zero network activity; pushes
  are explicit and a conflict never silently drops either version.

### Fixed

- Hard-coded light-then-dark theme styles replaced with `--dsw-alias-*` tokens
  (the active-tab highlight uses `--dsw-alias-interactive-bg-active`, which
  flips correctly on both themes).
- Track/navigation controls made visually distinct and height-consistent so
  switching between memory tracks never reflows the toolbar.
- The memory tool's `date` parameter is now honored for the `daily` track
  (previously declared but unused) with an invalid-date guard.
- Key-track entries always carry an id even without a summary, so
  `expand(id)` targets any key entry.
- Daily memory stamps the local calendar date (matching the todos store) instead
  of UTC, so daily logs land on the same day.
- `skills.list` no longer reads an arbitrary client-supplied directory; it is
  constrained to the resolved default maestro-skills checkout.

### Removed

- All legacy `dsh-memory-evolve` features not carried into the rebrand: COI /
  broadcast, advisor, notify/`de_channel_send`, search, prompt library, model
  registry, bookmarks/mermaid/canvas, and the old `/memory-evolve` HTTP server.

### Notes

- The package is consumed as a DSH plugin via `cordis.patch.yml`
  (`id: maestro-memory`) and is installed with a `link:` dependency or the
  `github:ddtcorex/dsh-maestro-memory#<sha>` form. Live `lib/` is committed so a
  rebuild is only needed after editing `src/`.

[1.0.0]: https://github.com/ddtcorex/dsh-maestro-memory/releases/tag/v1.0.0
