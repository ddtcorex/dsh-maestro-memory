/**
 * write-guard.ts — per-turn memory-write compliance watchdog.
 *
 * The snapshot's end-of-turn discipline note is a fixed hint, and in long
 * sessions a model gradually stops complying with it. Nothing on the program
 * side noticed the omission, so missed daily/project writes were dropped
 * silently. This counter closes that hole the way a review counter closes the
 * "never checks" hole: the program tracks compliance and the snapshot itself
 * escalates until the model writes.
 *
 * Deliberately in-memory only: a host restart clears gaps. The watchdog guards
 * drift inside a running process, not across restarts.
 *
 * Mechanism adapted from an upstream layered-memory plugin's write-gap
 * counter, including its mid-turn timing rule: `noteWrite` marks the turn and
 * the reset happens at `turn-stopping`, never at write time.
 */

/** Tracks whose write discharges the per-turn duty (the progression logs). */
export const WRITE_GUARD_TRACKS = ['daily', 'project'] as const

export interface WriteGapHandle {
  /** Completed consecutive human turns in which this agent wrote no guarded track. */
  gapOf(agent?: unknown): number
  /** Mark the current turn as having written a guarded track. Resets at turn-stopping. */
  noteWrite(agent?: unknown): void
}

interface GapState {
  gap: number
  wroteThisTurn: boolean
}

/**
 * Was the agent's newest turn opened by a direct human prompt?
 *
 * `agent/turn-stopping` also ends turns started by a goal-continuation round
 * (`source.kind === 'goal'`) or an injected context batch (`'plugin'`, e.g.
 * wake/followup notices). Those carry no per-turn write duty, so counting them
 * would fire the watchdog on work the human never asked for. An untagged
 * `user/message` (older hosts) counts as human, matching the documented default.
 */
export function lastTurnWasMessage(agent: any): boolean {
  const events: readonly any[] = agent?.session?.ownEvents?.() ?? agent?.session?.events ?? []
  let startIndex = -1
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === 'turn/start') {
      startIndex = i
      break
    }
  }
  if (startIndex < 0) return false
  for (let i = startIndex + 1; i < events.length; i += 1) {
    const event = events[i]
    if (event?.type === 'turn/start') break // defensive: a new turn began
    if (event?.type === 'user/message') {
      const kind = event.data?.source?.kind
      return kind === undefined || kind === 'user'
    }
  }
  return false
}

/**
 * Install the per-session write-gap counter.
 *
 * @param ctx - a context with `on` and `effect` (Cordis event bus + fiber).
 * @param isEnabled - live switch; while false the counter neither reads nor
 *   accumulates gaps. The snapshot independently re-checks the switch, so both
 *   halves degrade safely on their own.
 */
export function createWriteGapCounter(ctx: any, isEnabled: () => boolean): WriteGapHandle {
  const gaps = new Map<string, GapState>()

  const onTurnStopping = (payload: any): void => {
    // A throwing listener fails the whole turn, so the counter must never be
    // able to throw: it is a pacing aid, not part of the turn's result.
    try {
      const agent = payload?.agent
      if (!agent?.session) return
      // Subagent sessions owe one entry per achievement, not one per turn.
      if (agent.session.header?.origin === 'subagent') return
      if (!isEnabled()) return
      if (!lastTurnWasMessage(agent)) return
      const state = gaps.get(agent.id) ?? { gap: 0, wroteThisTurn: false }
      if (state.wroteThisTurn) {
        state.gap = 0
        state.wroteThisTurn = false
      } else {
        state.gap += 1
      }
      gaps.set(agent.id, state)
    } catch (error) {
      console.error('[maestro-memory write-guard] turn-stopping handler isolated (turn unaffected):', error)
    }
  }

  ctx.effect(() => ctx.on('agent/turn-stopping', onTurnStopping))

  return {
    gapOf: (agent?: unknown): number => {
      const id = (agent as any)?.id
      if (typeof id !== 'string') return 0
      return gaps.get(id)?.gap ?? 0
    },
    noteWrite: (agent?: unknown): void => {
      const id = (agent as any)?.id
      if (typeof id !== 'string') return
      const state = gaps.get(id) ?? { gap: 0, wroteThisTurn: false }
      // Mark only — see the timing note in the module doc comment.
      state.wroteThisTurn = true
      gaps.set(id, state)
    },
  }
}
