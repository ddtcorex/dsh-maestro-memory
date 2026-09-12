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

/**
 * Does a write to this track discharge the per-turn duty?
 *
 * The slow-moving tracks are deliberately excluded: `memory`/`user` record
 * durable facts rather than "what happened this turn", and `key` goes through
 * the confirmation queue rather than an immediate write.
 */
export function isGuardedTrack(target: unknown): boolean {
  return typeof target === 'string' && (WRITE_GUARD_TRACKS as readonly string[]).includes(target)
}

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
 * What the agent's newest turn actually was, read from its session log.
 *
 * `toolCalls` is what separates work from conversation: a turn that dispatched
 * no tool merely answered a question, so no per-turn memory is owed and the
 * watchdog must stay silent. Counting those turns would push the model to write
 * filler entries — exactly what the discipline note forbids ("never write
 * entries containing only 'Idle' or placeholders").
 */
export interface TurnFacts {
  /** The turn was opened by a direct human prompt. */
  human: boolean
  /** How many tool calls the turn dispatched. */
  toolCalls: number
}

/**
 * Read the newest turn's origin and tool activity.
 *
 * `agent/turn-stopping` also ends turns started by a goal-continuation round
 * (`source.kind === 'goal'`) or an injected context batch (`'plugin'`, e.g.
 * wake/followup notices). Those carry no per-turn write duty, so counting them
 * would fire the watchdog on work the human never asked for. An untagged
 * `user/message` (older hosts) counts as human, matching the documented default.
 */
export function readTurnFacts(agent: any): TurnFacts {
  const events: readonly any[] = agent?.session?.ownEvents?.() ?? agent?.session?.events ?? []
  let startIndex = -1
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === 'turn/start') {
      startIndex = i
      break
    }
  }
  if (startIndex < 0) return { human: false, toolCalls: 0 }
  let human = false
  let sawPrompt = false
  let toolCalls = 0
  for (let i = startIndex + 1; i < events.length; i += 1) {
    const event = events[i]
    if (event?.type === 'turn/start') break // defensive: a new turn began
    if (event?.type === 'tool/call') {
      toolCalls += 1
      continue
    }
    if (!sawPrompt && event?.type === 'user/message') {
      sawPrompt = true
      const kind = event.data?.source?.kind
      human = kind === undefined || kind === 'user'
    }
  }
  return { human, toolCalls }
}

/** Was the agent's newest turn opened by a direct human prompt? */
export function lastTurnWasMessage(agent: any): boolean {
  return readTurnFacts(agent).human
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
      const facts = readTurnFacts(agent)
      if (!facts.human) return
      // A turn that dispatched no tool only answered a question — there is
      // nothing to report, so no debt accrues and no filler entry is invited.
      if (facts.toolCalls === 0) return
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
