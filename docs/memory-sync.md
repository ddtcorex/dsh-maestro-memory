# Memory Sync

> Legacy Chinese doc archived as 记忆同步.md — see plan for new sync design (M5)

This is an English stub for the Memory Sync module. The original Chinese documentation is preserved as [`docs/记忆同步.zh-legacy.md`](记忆同步.zh-legacy.md) (and still at `docs/记忆同步.md` for reference).

The new sync design will be implemented in **Milestone 5** per `docs/plans/2026-08-24-dsh-maestro-memory-plan.md` (staged rebuild, not a 1:1 port). Until then, this stub is the primary English entry point; the Chinese files are kept as `*.zh-legacy.md` so no information is lost.

## Scope (planned)

- Project-scoped sync (KEY, project log, archives, project todos) + optional global tracks, Git-backed, per-project opt-in.
- Local files remain complete offline; sync is "batch and reconcile" via a dedicated branch, no code pollution.
