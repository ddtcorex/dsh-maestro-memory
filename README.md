# dsh-maestro-memory

Durable memory and todos for DeepSeek Harness (DSH) — preserves `~/.dsh/memories` in place.

> Give the AI cross-session durable memory and todos — the more you use it, the more it understands you.

- **Package:** `@ddtcorex/dsh-maestro-memory` (`cordis.patch.yml` id `maestro-memory`)
- **Version:** `2.0.0` · **Changelog:** `CHANGELOG.md`

## Requirements

- Node.js 22+, pnpm 11+
- DSH `deepseek-harness` master

## Install

```sh
pnpm install
pnpm run build   # -> lib/
pnpm test        # vitest run
```

**DSH profile (operator):**

```sh
dsh plugin --profile web add link:<workspace-root>/packages/dsh-maestro-memory
# production: dsh plugin --profile web add github:ddtcorex/dsh-maestro-memory#<tag-or-sha>
```

`cordis.patch.yml` is shipped with the package — do not duplicate it in the profile.

```yaml
- insert:
    - id: maestro-memory
      name: '@ddtcorex/dsh-maestro-memory'
      config:
        memoryDir: null      # -> ~/.dsh/memories
        snapshotOrder: 500
        autoMemory: { enabled: false, userMessage: true, desensitize: true } # opt-in
        writeGuard: { enabled: false, threshold: 2 }  # per-turn write watchdog, opt-in
```

`writeGuard` is read once at `apply()` time — changing it needs a profile edit and a
host restart. `threshold` counts consecutive *working* human turns with no
`daily`/`project` write; any value below 1 is read as 1.

## Tools

| Tool | Purpose |
|------|---------|
| `memory` | Five tracks `memory`/`user`/`project`/`key`/`daily` + archive/expand. `key` is gated via `memory_suggest`. |
| `maestro_todo` | Durable cross-session todo store (four tracks `life`/`work`/`project`/`daily` with ids, smart view max 8). Named apart from the harness's own in-session task list `todo_write`. |
| `memory_suggest` | Gated proposals to `SUGGESTIONS.jsonl` — requires human approve. |

`memory` sanitizes sensitive fragments (`[Filtered:API key/password/token/ID/phone]`, pure credential → `content filtered`).

## System Prompt Snapshot

`memory:snapshot` (order 500) injects bounded deterministic context:

`USER + MEMORY + KEY (branch-filtered) + Project Context (auto-recall top-4, 600 chars each, cap 1024) + Recent Daily (last 2 days, 512) + header + discipline note`

Caps: `memory 2048 / user 4096 / key 6144 / recentDaily 512 / autoRecall 1024`, plus
per-section entry budgets `memory 8 / user 8 / key 12 / recentDaily 2 / autoRecall 4`.

A cap is hard in **both** dimensions. The newest entry is always kept — compacted
to `head + [summary:…]` when it carries a summary tag. An untagged entry larger
than twice its byte cap is truncated with an explicit `…[truncated]` marker
instead of being kept whole: before that rule, a single 2,293-byte global entry
owned the 2,048-byte section and pushed every other entry out of the prompt.

**Cost reporting.** `renderSnapshotWithStats` (the renderer behind
`memory:snapshot`) reports the bytes, entry count and excluded-entry count of
every section. The host keeps the last 50 renders in memory and returns them as
`cost` on `/dsh-maestro-memory-health`: `samples`, `last`, `medianTotalBytes`,
`maxTotalBytes`, `medianBySection`. Entry text is never retained — byte counts
only.

**Write watchdog.** With `writeGuard.enabled`, the host counts consecutive human
turns in which work happened but no `daily`/`project` entry was written
(`agent/turn-stopping`). Three things must hold for a turn to count:

1. it was opened by a direct human prompt — goal-continuation rounds
   (`source.kind === 'goal'`) and injected context (`'plugin'`, e.g. wake
   notices) carry no per-turn duty;
2. it is not a subagent session;
3. it **dispatched at least one tool call**. A turn that only answered a
   question is conversation, not work, so no debt accrues — otherwise the
   watchdog would push the model to write filler entries, exactly what the
   discipline note forbids.

Once the gap reaches `threshold`, the snapshot gains a
`# ⚠️ Memory Write Backlog` section immediately before the discipline note, and
it stays until a write succeeds.
Only a write that actually recorded something counts — a deduplicated add does
not. The alert text is static (threshold only, never the live count), so one
open gap costs at most two tail snapshots: appear, then disappear.

**Subagent sessions** (`session.header.origin === 'subagent'`) get a restrained
per-achievement cadence instead of the per-turn duty, and never see the backlog
alert. The shared memory context (MEMORY / USER / KEY / Project Context) is
still injected for them.

The rendered snapshot collapses brace runs of two or more to a single brace: DSH interpolates each prompt context and fails the whole turn on a `{{name}}` group with a malformed or unregistered name, so free-form memory prose never reaches it as template syntax.

## UI & RPC

One `conversation.view` slot (`maestro-memory`, order 40) with tabs **Memory / Review / Todos / Skills / Health**. Health shows `coverage`, `daily last 7d`, `longest` + 5-dim score `S/R/J/C/Safety` (composite `min*0.4+mean*0.6`).

The **Memory** tab lists each track read-only and carries a manual add composer:
pick a track, type an entry, press Add. It posts `memory.mutate` with
`action: 'add'`, so it needs no model round-trip; drafts are kept per track and
the button stays disabled while the entry is empty or while `key`/`project` has
no cwd. The model's `key` gate is `exec.agent`-scoped on the host, so it stays in
force — a human writing `key` here is equivalent to approving a queued
suggestion.

RPC: `/dsh-maestro-memory` + loopback `/dsh-maestro-memory-health` + `/dsh-maestro-memory-propose`.

Maintenance endpoints on `/dsh-maestro-memory` (both **preview-first**: `dryRun`
defaults to `true` and an actual write needs `confirm: true`):

| Endpoint | What it does |
| --- | --- |
| `memory.repair` | Splits entries glued without the `§` delimiter, drops exact duplicates and moves a trailing `[summary:…]` to its canonical header position, across every store file. Reports `files / changed / split / deduped / relocated`. |
| `memory.maintenance` | Plans (and optionally applies) the archive of the oldest entries of `memory`/`user`/`key`/`project` beyond `DEFAULT_ARCHIVE_POLICY` (keep-bytes + max-age). Overgrown entries move to the track's `*-archive.md`; they are never dropped. |

Two repair passes also run once at boot, each gated by its own flag file under
`<root>/.maestro/`: `key-repaired-v1` (KEY.md delimiters) and
`delimiter-repaired-v2` (every store file, with the report written to the flag).

## Maintenance

```sh
node scripts/maestro-memory-remediate.mjs --apply --threshold-days 14
node scripts/enforce-rules.mjs --check-memory --threshold 90
```

## Cutover

1. Backup: `node scripts/migrate.mjs --root ~/.dsh/memories --apply`
2. Verify: `node scripts/migrate.mjs --root ~/.dsh/memories --verify` (must be `ok=true`)
3. Swap profile: remove `dsh-memory-evolve`, add `dsh-maestro-memory` as `link:` or pinned SHA.
4. Restart `dsh web` at user-approved window, then live-read each track.

Rollback: `rollback(root, runId)` restores byte-identical files from `backups/<runId>/`.

## Migration CLI

`node scripts/migrate.mjs --root <path> [--inspect|--dry-run|--verify|--apply]`

Default read-only; only `--apply` writes `manifest.json` + `backups/<runId>/files/` + `schema.json`.

## Verification

After `--apply`/`--verify`: `ok=true`, `mismatches=[]`, `manifest.json` byte-identical. Rehearsal suite `tests/m4-rehearsal.spec.ts` covers fixture `link:` profile → backup → verify → rollback.
