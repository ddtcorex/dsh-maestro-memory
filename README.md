# dsh-maestro-memory

Durable memory and todos for DeepSeek Harness (DSH) — preserves `~/.dsh/memories` in place.

> Give the AI cross-session durable memory and todos — the more you use it, the more it understands you.

- **Package:** `@ddtcorex/dsh-maestro-memory` (`cordis.patch.yml` id `maestro-memory`)
- **Version:** `1.3.0` · **Changelog:** `CHANGELOG.md`

## Requirements

- Node.js 22+, pnpm 11+
- DSH `deepseek-harness` master

## Install

```sh
pnpm install
pnpm run build   # -> lib/
pnpm test        # 330 tests
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
host restart. `threshold` counts consecutive human turns with no `daily`/`project`
write; any value below 1 is read as 1.

## Tools

| Tool | Purpose |
|------|---------|
| `memory` | Five tracks `memory`/`user`/`project`/`key`/`daily` + archive/expand. `key` is gated via `memory_suggest`. |
| `dtodo` | Four tracks `life`/`work`/`project`/`daily` with ids, smart view (max 8). |
| `memory_suggest` | Gated proposals to `SUGGESTIONS.jsonl` — requires human approve. |

`memory` sanitizes sensitive fragments (`[Filtered:API key/password/token/ID/phone]`, pure credential → `content filtered`).

## System Prompt Snapshot

`memory:snapshot` (order 500) injects bounded deterministic context:

`USER + MEMORY + KEY (branch-filtered) + Project Context (auto-recall top-4, 600 chars each, cap 1024) + Recent Daily (last 2 days, 512) + header + discipline note`

Caps: `memory 2048 / user 4096 / key 6144 / recentDaily 512 / autoRecall 1024`.

**Write watchdog.** With `writeGuard.enabled`, the host counts consecutive human
turns in which no `daily`/`project` entry was written (`agent/turn-stopping`,
subagent-exempt, goal-continuation and injected turns excluded). Once the gap
reaches `threshold`, the snapshot gains a `# ⚠️ Memory Write Backlog` section
immediately before the discipline note, and it stays until a write succeeds.
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
