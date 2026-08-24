# Memory Sync

> Legacy sync docs have been removed — see plan for new sync design (M5)

This is an English stub for the Memory Sync module. All legacy Chinese documentation has been removed per the rebrand (EN-only). The original content is retained in git history (`git log --all -- docs/`) for reference if needed.

The new sync design will be implemented in **Milestone 5** per `docs/plans/2026-08-24-dsh-maestro-memory-plan.md` (staged rebuild, not a 1:1 port).

## Scope (planned)

- Project-scoped sync (KEY, project log, archives, project todos) + optional global tracks, Git-backed, per-project opt-in.
- Local files remain complete offline; sync is "batch and reconcile" via a dedicated branch, no code pollution.
