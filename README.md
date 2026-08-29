# dsh-maestro-memory

Durable memory and todos for DeepSeek Harness (DSH) — preserves `~/.dsh/memories` in place.

> Give the AI cross-session durable memory and todos — the more you use it, the more it understands you.

- **Package:** `@ddtcorex/dsh-maestro-memory` (`cordis.patch.yml` id `maestro-memory`)
- **Version:** `1.1.0` · **Changelog:** `CHANGELOG.md`

## Requirements

- Node.js 22+, pnpm 11+
- DSH `deepseek-harness` master

## Install

```sh
pnpm install
pnpm run build   # -> lib/
pnpm test        # 268 tests
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
```

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

## UI & RPC

One `conversation.view` slot (`maestro-memory`, order 40) with tabs **Memory / Review / Todos / Skills / Health**. Health shows `coverage`, `daily last 7d`, `longest` + 5-dim score `S/R/J/C/Safety` (composite `min*0.4+mean*0.6`).

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
