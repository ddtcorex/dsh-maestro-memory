# COI Scheduling

> Legacy Chinese doc archived as COI-调度.md — see plan for new COI design (M5)

This is an English stub for the COI (Command-line AI) Scheduling module. The original Chinese documentation is preserved as [`docs/COI-调度.zh-legacy.md`](COI-调度.zh-legacy.md) (and still at `docs/COI-调度.md` for reference).

The new COI design will be evaluated for a separate optional plugin after the Maestro core (memory + todos) stabilizes — see `docs/plans/2026-08-24-dsh-maestro-memory-plan.md`. Until then, this stub is the primary English entry point; the Chinese files are kept as `*.zh-legacy.md` so no information is lost.

## Scope (planned, if revived as plugin)

- Unified dispatch for external CLI agents (kimi / codex / grok / hermes / custom), non-blocking background tasks, log streaming, session-layered recovery, memory injection (opt-in).
